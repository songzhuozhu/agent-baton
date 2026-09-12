import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
