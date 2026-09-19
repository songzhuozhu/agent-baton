import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverUserSkillRoots } from './directory-skill-discovery';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('discoverUserSkillRoots', () => {
  it('reports an unreadable root and continues discovering healthy roots while ignoring missing roots', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-discovery-'));
    temporaryDirectories.push(workspace);
    const invalidRoot = join(workspace, 'a-file');
    const healthyRoot = join(workspace, 'b-skills');
    const skillDirectory = join(healthyRoot, 'design');
    await writeFile(invalidRoot, 'not a directory');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: design\ndescription: 设计协作\n---\n');

    await expect(discoverUserSkillRoots('codex', [invalidRoot, healthyRoot, join(workspace, 'missing')])).resolves.toEqual({
      installations: [expect.objectContaining({ sourcePath: skillDirectory, skillName: 'design', agent: 'codex' })],
      issues: [{ sourcePath: invalidRoot, detail: expect.stringContaining('无法读取 Skill 根目录：') }]
    });
  });
});
