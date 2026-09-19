import { cp, lstat, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortableSnapshot } from '../../shared/domain';
import { SyncRepository } from '../../sync/sync-repository';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SyncRestoreService } from './sync-restore-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const snapshot: PortableSnapshot = {
  skills: [{ skill: { id: 'skill-a', name: 'design', originalDescription: 'ignored', tags: ['design'], syncPolicy: 'sync-allowed', source: { kind: 'local' } } }],
  groups: [{ group: { id: 'group-a', name: 'Personal', participatesInSync: true, skillIds: ['skill-a'] } }],
  agentStates: [{ state: { agent: 'codex', activeGroupIds: ['group-a'], overrides: {} } }]
};

async function createRestoreFixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-restore-'));
  temporaryDirectories.push(workspace);
  const source = join(workspace, 'source');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: Remote source\n---\n');
  const remote = new SyncRepository(join(workspace, 'repository'));
  await remote.write({
    snapshot,
    tombstones: [{ entity: 'skill', id: 'removed-remote', schemaVersion: 1, deletedAt: '2026-08-09T00:00:00.000Z' }],
    copyContent: async (_id, destination) => cp(source, destination, { recursive: true })
  });
  const store = new LocalStateStore(':memory:');
  const library = new ManagedLibrary(join(workspace, 'new-library'));
  return { remote, store, library, service: new SyncRestoreService(store, library) };
}

describe('SyncRestoreService', () => {
  it('restores desired state and canonical content without installing any Agent files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-restore-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: Remote source\n---\n');
    const remote = new SyncRepository(join(workspace, 'repository'));
    await remote.write({ snapshot, copyContent: async (_id, destination) => cp(source, destination, { recursive: true }) });
    const store = new LocalStateStore(':memory:');
    const service = new SyncRestoreService(store, new ManagedLibrary(join(workspace, 'new-library')));

    const preview = await service.preview(remote);
    expect(preview).toMatchObject({ incomingSkillCount: 1, incomingGroupCount: 1, incomingAgentStateCount: 1, conflicts: [] });
    await service.confirm(preview.id);

    expect(store.listSkills()).toMatchObject([{ id: 'skill-a', originalDescription: 'Remote source', syncPolicy: 'sync-allowed' }]);
    expect(store.listGroups()).toEqual([{ id: 'group-a', name: 'Personal', participatesInSync: true, skillIds: ['skill-a'] }]);
    expect(store.listDesiredAgentStates()).toEqual([{ agent: 'codex', activeGroupIds: ['group-a'], overrides: {} }]);
    expect(store.listObservedInstallations()).toEqual([]);
    expect(store.getSyncBaseline(remote.rootDirectory())).toMatchObject({
      skills: [{ metadata: { id: 'skill-a' } }],
      groups: [{ id: 'group-a' }]
    });
    store.close();
  });

  it('blocks confirmation when existing local intent would be overwritten', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-restore-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\n');
    const remote = new SyncRepository(join(workspace, 'repository'));
    await remote.write({ snapshot, copyContent: async (_id, destination) => cp(source, destination, { recursive: true }) });
    const store = new LocalStateStore(':memory:');
    store.saveSkill({ id: 'skill-a', name: 'local', originalDescription: '', tags: [], syncPolicy: 'sync-allowed', source: { kind: 'local' } });
    const service = new SyncRestoreService(store, new ManagedLibrary(join(workspace, 'new-library')));

    const preview = await service.preview(remote);
    expect(preview.conflicts).toContain('Skill ID 已存在：skill-a');
    await expect(service.confirm(preview.id)).rejects.toThrow('必须先解决');
    store.close();
  });

  it.each(['saveGroup', 'saveSyncBaseline'] as const)('rolls back every imported entity when %s fails', async (failurePoint) => {
    const { remote, store, library, service } = await createRestoreFixture();
    const originalBaseline = { skills: [], groups: [], agentStates: [], tombstones: [] };
    store.saveSyncBaseline(remote.rootDirectory(), originalBaseline);
    store.saveGroup({ id: 'local-group', name: 'Keep me', participatesInSync: false, skillIds: [] });
    try {
      const preview = await service.preview(remote);
      vi.spyOn(store, failurePoint).mockImplementationOnce(() => { throw new Error('database write failed'); });

      await expect(service.confirm(preview.id)).rejects.toThrow('database write failed');
      expect(store.listSkills()).toEqual([]);
      expect(store.listGroups()).toEqual([{ id: 'local-group', name: 'Keep me', participatesInSync: false, skillIds: [] }]);
      expect(store.listDesiredAgentStates()).toEqual([]);
      expect(store.listSkillTombstones()).toEqual([]);
      expect(store.getSyncBaseline(remote.rootDirectory())).toEqual(originalBaseline);
      await expect(lstat(library.contentDirectory('skill-a'))).rejects.toMatchObject({ code: 'ENOENT' });

      await service.confirm((await service.preview(remote)).id);
      expect(store.listSkills()).toHaveLength(1);
      expect(store.listSkillTombstones()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it.each(['before-confirm', 'during-copy'] as const)('preserves local intent created %s instead of overwriting it', async (when) => {
    const { remote, store, library, service } = await createRestoreFixture();
    const localState = { agent: 'codex' as const, activeGroupIds: [], overrides: { 'local-skill': 'force-disable' as const } };
    try {
      const preview = await service.preview(remote);
      if (when === 'before-confirm') {
        store.saveDesiredAgentState(localState);
      } else {
        const adopt = library.adopt.bind(library);
        vi.spyOn(library, 'adopt').mockImplementationOnce(async (...args) => {
          const result = await adopt(...args);
          store.saveDesiredAgentState(localState);
          return result;
        });
      }

      await expect(service.confirm(preview.id)).rejects.toThrow('冲突');
      expect(store.listDesiredAgentStates()).toEqual([localState]);
      expect(store.listSkills()).toEqual([]);
      expect(store.listGroups()).toEqual([]);
      expect(store.getSyncBaseline(remote.rootDirectory())).toBeUndefined();
      await expect(lstat(library.contentDirectory('skill-a'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      store.close();
    }
  });

  it('validates the baseline before copying any content into the managed library', async () => {
    const { remote, store, library, service } = await createRestoreFixture();
    try {
      const preview = await service.preview(remote);
      const incoming = await remote.read();
      await rm(incoming!.skills[0].contentDirectory, { recursive: true });
      const adopt = vi.spyOn(library, 'adopt');

      await expect(service.confirm(preview.id)).rejects.toThrow();
      expect(adopt).not.toHaveBeenCalled();
      expect(store.listSkills()).toEqual([]);
      expect(store.getSyncBaseline(remote.rootDirectory())).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it('rejects content that changes while it is being imported', async () => {
    const { remote, store, library, service } = await createRestoreFixture();
    try {
      const preview = await service.preview(remote);
      const adopt = library.adopt.bind(library);
      vi.spyOn(library, 'adopt').mockImplementationOnce(async (skillId, directory) => {
        await writeFile(join(directory, 'SKILL.md'), '---\nname: changed\n---\nUnexpected content');
        return adopt(skillId, directory);
      });

      await expect(service.confirm(preview.id)).rejects.toThrow('内容在恢复期间发生变化');
      expect(store.listSkills()).toEqual([]);
      expect(store.getSyncBaseline(remote.rootDirectory())).toBeUndefined();
      await expect(lstat(library.contentDirectory('skill-a'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      store.close();
    }
  });

  it('preserves a local deletion instead of restoring the incoming Skill over its tombstone', async () => {
    const { remote, store, service } = await createRestoreFixture();
    const tombstone = { id: 'skill-a', deletedAt: '2026-09-01T00:00:00.000Z', syncAllowed: true };
    try {
      const preview = await service.preview(remote);
      store.saveSkillTombstone(tombstone);

      await expect(service.confirm(preview.id)).rejects.toThrow('冲突');
      expect(store.listSkills()).toEqual([]);
      expect(store.listSkillTombstones()).toEqual([tombstone]);
    } finally {
      store.close();
    }
  });
});
