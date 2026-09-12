import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAdapter } from './codex-adapter';

const temporaryHomes: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'agent-baton-codex-home-'));
  temporaryHomes.push(home);
  return home;
}

describe('CodexAdapter', () => {
  it('discovers only valid user-level Skill directories and reports invalid candidates', async () => {
    const home = await createHome();
    const validDirectory = join(home, '.agents', 'skills', 'design');
    const invalidDirectory = join(home, '.agents', 'skills', 'missing-skill-file');
    await mkdir(validDirectory, { recursive: true });
    await mkdir(invalidDirectory, { recursive: true });
    await writeFile(
      join(validDirectory, 'SKILL.md'),
      '---\nname: design\ndescription: 设计协作\n---\n'
    );

    const adapter = new CodexAdapter(home);

    await expect(adapter.detect()).resolves.toMatchObject({ availability: 'detected' });
    await expect(adapter.discoverUserSkills()).resolves.toEqual({
      installations: [
        expect.objectContaining({
          agent: 'codex',
          scope: 'user',
          skillName: 'design',
          originalDescription: '设计协作',
          sourcePath: validDirectory
        })
      ],
      issues: [
        {
          sourcePath: invalidDirectory,
          detail: 'Skill directory must contain a regular SKILL.md file.'
        }
      ]
    });
  });

  it('does not create folders while checking for Codex', async () => {
    const home = await createHome();
    const adapter = new CodexAdapter(home);

    await expect(adapter.detect()).resolves.toMatchObject({ availability: 'not-detected' });
    await expect(adapter.discoverUserSkills()).resolves.toEqual({ installations: [], issues: [] });
  });
});
