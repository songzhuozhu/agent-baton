import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { AdoptionPreviewError, AdoptionPreviewService } from './adoption-preview-service';
import { SkillControlService } from './skill-control-service';
import type { StagedUpstreamCandidate, UpstreamFetcher } from '../upstream/upstream-update-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('AdoptionPreviewService', () => {
  it('does not copy a source until its explicit preview ID is confirmed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-adopt-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: design\n---\n');
    const store = new LocalStateStore(':memory:');
    const control = new SkillControlService(store, new ManagedLibrary(join(workspace, 'library')));
    const service = new AdoptionPreviewService(control);

    try {
      await expect(service.confirm('missing', {})).rejects.toBeInstanceOf(AdoptionPreviewError);
      const preview = await service.preview(source, new Date('2026-08-09T00:00:00.000Z'));
      expect(store.listSkills()).toEqual([]);
      await expect(
        service.confirm(preview.id, { tags: ['design'] }, new Date('2026-08-09T00:01:00.000Z'))
      ).resolves.toMatchObject({ name: 'design', syncPolicy: 'local-only', tags: ['design'] });
      expect(store.listSkills()).toHaveLength(1);
      await expect(service.confirm(preview.id, {})).rejects.toBeInstanceOf(AdoptionPreviewError);
    } finally {
      store.close();
    }
  });

  it('only suggests possible duplicates and never merges them automatically', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-adopt-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: design\n---\n');
    const store = new LocalStateStore(':memory:');
    const control = new SkillControlService(store, new ManagedLibrary(join(workspace, 'library')));
    const service = new AdoptionPreviewService(control);

    try {
      const first = await service.preview(source);
      await service.confirm(first.id, {});
      const second = await service.preview(source);

      expect(second.possibleDuplicates).toEqual([
        expect.objectContaining({ name: 'design', reason: 'same-content' })
      ]);
      expect(store.listSkills()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('rejects source changes after preview instead of adopting unreviewed content', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-adopt-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\nReviewed content');
    const store = new LocalStateStore(':memory:');
    const control = new SkillControlService(store, new ManagedLibrary(join(workspace, 'library')));
    const service = new AdoptionPreviewService(control);
    try {
      const preview = await service.preview(source);
      await writeFile(join(source, 'unexpected.sh'), 'echo unreviewed');

      await expect(service.confirm(preview.id, {})).rejects.toThrow('内容已变化');
      expect(store.listSkills()).toEqual([]);
      await expect(service.confirm(preview.id, {})).rejects.toThrow('不存在或已被使用');
    } finally {
      store.close();
    }
  });

  it('stages an upstream source and persists its immutable update baseline only after confirmation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-adopt-'));
    temporaryDirectories.push(workspace);
    const candidateDirectory = join(workspace, 'candidate');
    await mkdir(candidateDirectory);
    await writeFile(join(candidateDirectory, 'SKILL.md'), '---\nname: design\ndescription: upstream\n---\n');
    const store = new LocalStateStore(':memory:');
    const control = new SkillControlService(store, new ManagedLibrary(join(workspace, 'library')));
    let cleaned = false;
    const fetcher: UpstreamFetcher = {
      resolveHead: async () => 'unused',
      stage: async (): Promise<StagedUpstreamCandidate> => ({
        commit: 'a'.repeat(40),
        skillDirectory: candidateDirectory,
        cleanup: async () => { cleaned = true; }
      })
    };
    const service = new AdoptionPreviewService(control, fetcher);

    try {
      const preview = await service.previewUpstream('https://github.com/example/skills.git', 'design');
      expect(preview).toMatchObject({ sourceKind: 'upstream', upstream: { baselineCommit: 'a'.repeat(40) } });
      expect(store.listSkills()).toEqual([]);
      const skill = await service.confirm(preview.id, {});

      expect(skill.source).toMatchObject({ kind: 'upstream', repositoryUrl: 'https://github.com/example/skills.git', relativePath: 'design' });
      expect(cleaned).toBe(true);
    } finally {
      store.close();
    }
  });
});
