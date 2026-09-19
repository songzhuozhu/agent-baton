import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { ManagedSkillDeletionService } from './managed-skill-deletion-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ManagedSkillDeletionService', () => {
  it('requires a preview, removes every reference, creates a sync tombstone, and restores inside 30 days', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-delete-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\n');
    const library = new ManagedLibrary(join(workspace, 'library'));
    await library.adopt('skill-a', source);
    const store = new LocalStateStore(':memory:');
    store.saveSkill({ id: 'skill-a', name: 'design', originalDescription: '', tags: [], syncPolicy: 'sync-allowed', source: { kind: 'local' } });
    store.saveGroup({ id: 'group-a', name: 'Personal', participatesInSync: true, skillIds: ['skill-a'] });
    store.saveDesiredAgentState({ agent: 'codex', activeGroupIds: ['group-a'], overrides: { 'skill-a': 'force-disable' } });
    const service = new ManagedSkillDeletionService(store, library);
    const now = new Date('2026-08-09T00:00:00.000Z');

    const preview = service.preview('skill-a', now);
    expect(preview).toMatchObject({ affectedGroupIds: ['group-a'], affectedOverrides: [{ agent: 'codex', override: 'force-disable' }] });
    await service.confirm(preview.id, now);

    expect(store.listSkills()).toEqual([]);
    expect(store.listGroups()[0].skillIds).toEqual([]);
    expect(store.listDesiredAgentStates()[0].overrides).toEqual({});
    expect(store.listSkillTombstones()).toEqual([{ id: 'skill-a', deletedAt: now.toISOString(), syncAllowed: true }]);

    await service.restore('skill-a', new Date('2026-08-10T00:00:00.000Z'));
    expect(store.listSkills()).toHaveLength(1);
    expect(store.listGroups()[0].skillIds).toEqual(['skill-a']);
    expect(store.listDesiredAgentStates()[0].overrides).toEqual({ 'skill-a': 'force-disable' });
    expect(store.listSkillTombstones()).toEqual([]);
    store.close();
  });

  it('does not make a Local Only deletion portable', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-delete-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: private\n---\n');
    const library = new ManagedLibrary(join(workspace, 'library'));
    await library.adopt('skill-private', source);
    const store = new LocalStateStore(':memory:');
    store.saveSkill({ id: 'skill-private', name: 'private', originalDescription: '', tags: [], syncPolicy: 'local-only', source: { kind: 'local' } });
    const service = new ManagedSkillDeletionService(store, library);
    const preview = service.preview('skill-private');

    await service.confirm(preview.id);

    expect(store.listSkillTombstones()).toEqual([expect.objectContaining({ id: 'skill-private', syncAllowed: false })]);
    store.close();
  });

  it('keeps the original recovery path usable after a database restore failure', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-delete-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: recoverable\n---\n');
    const library = new ManagedLibrary(join(workspace, 'library'));
    await library.adopt('skill-a', source);
    const store = new LocalStateStore(':memory:');
    store.saveSkill({ id: 'skill-a', name: 'recoverable', originalDescription: '', tags: [], syncPolicy: 'local-only', source: { kind: 'local' } });
    const service = new ManagedSkillDeletionService(store, library);
    const deletedAt = new Date('2026-08-09T00:00:00.000Z');
    try {
      await service.confirm(service.preview('skill-a', deletedAt).id, deletedAt);
      const originalRecovery = store.getSkillDeletionRecovery('skill-a');
      const failure = vi.spyOn(store, 'restoreDeletedManagedSkill').mockImplementationOnce(() => {
        throw new Error('database temporarily unavailable');
      });

      await expect(service.restore('skill-a', new Date('2026-08-10T00:00:00.000Z'))).rejects.toThrow('database temporarily unavailable');
      expect(store.getSkillDeletionRecovery('skill-a')).toEqual(originalRecovery);
      expect(store.listSkills()).toEqual([]);
      failure.mockRestore();

      await expect(service.restore('skill-a', new Date('2026-08-11T00:00:00.000Z'))).resolves.toBeUndefined();
      expect(store.listSkills()).toMatchObject([{ id: 'skill-a' }]);
      expect(store.getSkillDeletionRecovery('skill-a')).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
