import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverCustomSkills } from './custom-skill-discovery';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('discoverCustomSkills', () => {
  it('scans only the explicitly selected custom root and its direct Skill children', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-baton-custom-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'design'), { recursive: true });
    await writeFile(join(root, 'design', 'SKILL.md'), '---\nname: design\n---\n');

    await expect(discoverCustomSkills([{ path: root, kind: 'custom' }])).resolves.toMatchObject({
      installations: [{ scope: 'custom', skillName: 'design' }]
    });
  });

  it('scans known project-local roots but does not write to them', async () => {
    const project = await mkdtemp(join(tmpdir(), 'agent-baton-project-'));
    temporaryDirectories.push(project);
    await mkdir(join(project, '.agents', 'skills', 'work'), { recursive: true });
    await writeFile(join(project, '.agents', 'skills', 'work', 'SKILL.md'), '---\nname: work\n---\n');

    await expect(discoverCustomSkills([{ path: project, kind: 'project' }])).resolves.toMatchObject({
      installations: [{ scope: 'project', skillName: 'work' }]
    });
  });
});
