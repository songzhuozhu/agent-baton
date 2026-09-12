import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SkillControlService } from '../application/skill-control-service';
import { UpstreamUpdateService, type StagedUpstreamCandidate, type UpstreamFetcher } from './upstream-update-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

class FakeFetcher implements UpstreamFetcher {
  stageCalls = 0;
  constructor(private readonly candidateDirectory: string) {}

  async resolveHead(): Promise<string> {
    return 'next-commit';
  }

  async stage(): Promise<StagedUpstreamCandidate> {
    this.stageCalls += 1;
    return { commit: 'next-commit', skillDirectory: this.candidateDirectory, cleanup: async () => undefined };
  }
}

describe('UpstreamUpdateService', () => {
  it('stages a diff, updates canonical content only after confirmation, and keeps a backup', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-upstream-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    const candidate = join(workspace, 'candidate');
    await mkdir(source, { recursive: true });
    await mkdir(candidate, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: Before\n---\nold');
    await writeFile(join(candidate, 'SKILL.md'), '---\nname: design\ndescription: After\n---\nnew');
    await writeFile(join(candidate, 'guide.md'), 'new guide');
    const sourceInspection = await inspectSkillDirectory(source);
    const store = new LocalStateStore(':memory:');
    const library = new ManagedLibrary(join(workspace, 'library'));
    const control = new SkillControlService(store, library);
    const skill = await control.adoptSkill({
      sourceDirectory: source,
      source: { kind: 'upstream', repositoryUrl: 'https://github.com/example/skills.git', relativePath: 'design', baselineCommit: 'base-commit', contentHash: sourceInspection.contentHash }
    });
    const service = new UpstreamUpdateService(store, library, control, new FakeFetcher(candidate));

    expect(await service.check(skill.id)).toMatchObject({ kind: 'update-available', remoteCommit: 'next-commit' });
    const preview = await service.previewUpdate(skill.id, new Date('2026-08-09T00:00:00.000Z'));
    expect(preview.changedFiles).toEqual(expect.arrayContaining([
      { path: 'SKILL.md', change: 'modified' },
      { path: 'guide.md', change: 'added' }
    ]));
    const updated = await service.confirmUpdate(preview.id, new Date('2026-08-09T00:01:00.000Z'));

    await expect(readFile(join(library.contentDirectory(skill.id), 'SKILL.md'), 'utf8')).resolves.toContain('After');
    await expect(readFile(join(updated.backupDirectory, 'SKILL.md'), 'utf8')).resolves.toContain('Before');
    expect(control.listSkills()[0].source).toMatchObject({ kind: 'upstream', baselineCommit: 'next-commit' });
    store.close();
  });

  it('marks locally changed canonical content as forked and blocks direct updates', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-upstream-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\nbase');
    const sourceInspection = await inspectSkillDirectory(source);
    const store = new LocalStateStore(':memory:');
    const library = new ManagedLibrary(join(workspace, 'library'));
    const control = new SkillControlService(store, library);
    const skill = await control.adoptSkill({
      sourceDirectory: source,
      source: { kind: 'upstream', repositoryUrl: 'https://github.com/example/skills.git', relativePath: 'design', baselineCommit: 'base-commit', contentHash: sourceInspection.contentHash }
    });
    await writeFile(join(library.contentDirectory(skill.id), 'SKILL.md'), '---\nname: design\n---\nlocal fork');
    const fetcher = new FakeFetcher(source);
    const service = new UpstreamUpdateService(store, library, control, fetcher);

    expect(await service.check(skill.id)).toMatchObject({ kind: 'forked' });
    await expect(service.previewUpdate(skill.id)).rejects.toThrow('已分叉');
    expect(fetcher.stageCalls).toBe(0);
    store.close();
  });

  it('allows an explicitly previewed fork discard while keeping a recoverable backup', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-upstream-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    const candidate = join(workspace, 'candidate');
    await mkdir(source, { recursive: true });
    await mkdir(candidate, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\nbase');
    await writeFile(join(candidate, 'SKILL.md'), '---\nname: design\n---\nremote update');
    const sourceInspection = await inspectSkillDirectory(source);
    const store = new LocalStateStore(':memory:');
    const library = new ManagedLibrary(join(workspace, 'library'));
    const control = new SkillControlService(store, library);
    const skill = await control.adoptSkill({
      sourceDirectory: source,
      source: { kind: 'upstream', repositoryUrl: 'https://github.com/example/skills.git', relativePath: 'design', baselineCommit: 'base-commit', contentHash: sourceInspection.contentHash }
    });
    await writeFile(join(library.contentDirectory(skill.id), 'SKILL.md'), '---\nname: design\n---\nlocal fork');
    const service = new UpstreamUpdateService(store, library, control, new FakeFetcher(candidate));

    const preview = await service.previewDiscardLocalForkAndUpdate(skill.id);
    expect(preview).toMatchObject({ discardLocalFork: true, remoteCommit: 'next-commit' });
    const result = await service.confirmUpdate(preview.id);

    await expect(readFile(join(result.backupDirectory, 'SKILL.md'), 'utf8')).resolves.toContain('local fork');
    await expect(readFile(join(library.contentDirectory(skill.id), 'SKILL.md'), 'utf8')).resolves.toContain('remote update');
    store.close();
  });
});
