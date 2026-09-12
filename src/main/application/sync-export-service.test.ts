import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncRepository } from '../../sync/sync-repository';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SyncExportService } from './sync-export-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SyncExportService', () => {
  it('exports only Sync Allowed content reachable from a selected group', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-export-'));
    temporaryDirectories.push(workspace);
    const library = new ManagedLibrary(join(workspace, 'library'));
    const state = new LocalStateStore(':memory:');
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: Original\n---\n');
    await library.adopt('design', source);
    await library.adopt('private', source);
    state.saveSkill({ id: 'design', name: 'design', originalDescription: 'Original', tags: ['design'], syncPolicy: 'sync-allowed', source: { kind: 'local' } });
    state.saveSkill({ id: 'private', name: 'private', originalDescription: 'Original', tags: ['private'], syncPolicy: 'local-only', source: { kind: 'local' } });
    state.saveGroup({ id: 'personal', name: 'Personal', participatesInSync: true, skillIds: ['design', 'private'] });
    state.saveDesiredAgentState({ agent: 'codex', activeGroupIds: ['personal'], overrides: { private: 'force-enable' } });
    state.saveSkillTombstone({ id: 'removed-public', deletedAt: '2026-08-09T00:00:00.000Z', syncAllowed: true });
    state.saveSkillTombstone({ id: 'removed-private', deletedAt: '2026-08-09T00:00:00.000Z', syncAllowed: false });
    const service = new SyncExportService(state, library);

    const preview = await service.preview();
    expect(preview).toMatchObject({ portableSkillCount: 1, localOnlySkillCount: 1, groupCount: 1, tombstoneCount: 1 });

    const repositoryRoot = join(workspace, 'repository');
    await service.write(new SyncRepository(repositoryRoot));

    await expect(readFile(join(repositoryRoot, 'agent-baton', 'skills', 'design', 'content', 'SKILL.md'), 'utf8')).resolves.toContain('name: design');
    await expect(readFile(join(repositoryRoot, 'agent-baton', 'skills', 'private', 'metadata.json'), 'utf8')).rejects.toThrow();
    const stateJson = await readFile(join(repositoryRoot, 'agent-baton', 'agent-states', 'codex.json'), 'utf8');
    expect(stateJson).not.toContain('private');
    await expect(readFile(join(repositoryRoot, 'agent-baton', 'tombstones', 'removed-public.json'), 'utf8')).resolves.toContain('removed-public');
    await expect(readFile(join(repositoryRoot, 'agent-baton', 'tombstones', 'removed-private.json'), 'utf8')).rejects.toThrow();
    state.close();
  });
});
