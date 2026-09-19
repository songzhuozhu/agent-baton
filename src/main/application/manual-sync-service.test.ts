import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemGitCommandExecutor } from '../git/git-worktree';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SyncExportService } from './sync-export-service';
import { ManualSyncService } from './manual-sync-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return new SystemGitCommandExecutor().run(args, cwd);
}

describe('ManualSyncService', () => {
  it('fetches, previews, then commits and pushes only portable state after confirmation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-manual-sync-'));
    temporaryDirectories.push(workspace);
    const bareRemote = join(workspace, 'remote.git');
    const checkout = join(workspace, 'checkout');
    await git(workspace, 'init', '--bare', bareRemote);
    await git(workspace, 'clone', bareRemote, checkout);
    await git(checkout, 'config', 'user.name', 'AgentBaton Test');
    await git(checkout, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(checkout, 'README.md'), 'sync repo');
    await git(checkout, 'add', 'README.md');
    await git(checkout, 'commit', '-m', 'initial');
    await git(checkout, 'push', '-u', 'origin', 'HEAD');
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\n');
    const store = new LocalStateStore(':memory:');
    const library = new ManagedLibrary(join(workspace, 'library'));
    const adopted = await library.adopt('skill-a', source);
    store.saveSkill({ id: 'skill-a', name: adopted.inspection.name, originalDescription: '', tags: [], syncPolicy: 'sync-allowed', source: { kind: 'local' } });
    store.saveGroup({ id: 'group-a', name: 'Personal', participatesInSync: true, skillIds: ['skill-a'] });
    store.saveDesiredAgentState({ agent: 'codex', activeGroupIds: ['group-a'], overrides: {} });
    const service = new ManualSyncService(new SyncExportService(store, library));

    const preview = await service.preview(checkout, new Date('2026-08-09T00:00:00.000Z'));
    expect(preview).toMatchObject({ portableSkillCount: 1, remoteRelation: 'up-to-date' });
    const result = await service.confirm(preview.id, new Date('2026-08-09T00:01:00.000Z'));

    expect(result.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await git(bareRemote, 'log', '--oneline')).toContain('sync: update AgentBaton state');
    expect(await git(checkout, 'status', '--porcelain=v1')).toBe('');
    expect(store.getSyncBaseline(checkout)).toMatchObject({ skills: [{ metadata: { id: 'skill-a' } }] });
    store.close();
  });

  it('never overwrites an existing portable working-tree change without reconciliation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-manual-sync-'));
    temporaryDirectories.push(workspace);
    const bareRemote = join(workspace, 'remote.git');
    const checkout = join(workspace, 'checkout');
    await git(workspace, 'init', '--bare', bareRemote);
    await git(workspace, 'clone', bareRemote, checkout);
    await git(checkout, 'config', 'user.name', 'AgentBaton Test');
    await git(checkout, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(checkout, 'README.md'), 'sync repo');
    await git(checkout, 'add', 'README.md');
    await git(checkout, 'commit', '-m', 'initial');
    await git(checkout, 'push', '-u', 'origin', 'HEAD');
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\n');
    const store = new LocalStateStore(':memory:');
    const library = new ManagedLibrary(join(workspace, 'library'));
    const adopted = await library.adopt('skill-a', source);
    store.saveSkill({ id: 'skill-a', name: adopted.inspection.name, originalDescription: '', tags: [], syncPolicy: 'sync-allowed', source: { kind: 'local' } });
    store.saveGroup({ id: 'group-a', name: 'Personal', participatesInSync: true, skillIds: ['skill-a'] });
    const service = new ManualSyncService(new SyncExportService(store, library));
    const first = await service.preview(checkout);
    await service.confirm(first.id);
    await writeFile(join(checkout, 'agent-baton', 'groups', 'manual-edit.json'), JSON.stringify({
      id: 'manual-edit', name: 'Manual edit', participatesInSync: true, skillIds: [], schemaVersion: 1
    }));

    const preview = await service.preview(checkout);
    expect(preview).toMatchObject({ reconciliationRequired: true });
    expect(preview.existingPortableChanges).toContain('agent-baton/groups/manual-edit.json');
    await expect(service.confirm(preview.id)).rejects.toThrow('必须先解决');
    await expect(readFile(join(checkout, 'agent-baton', 'groups', 'manual-edit.json'), 'utf8')).resolves.toContain('Manual edit');
    store.close();
  });
});
