import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectSkillDirectory, SkillInspectionError } from './skill-file-inspector';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createSkillDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-baton-skill-'));
  tempDirectories.push(directory);
  await writeFile(
    join(directory, 'SKILL.md'),
    '---\nname: ui-polish\ndescription: "界面美化流程"\n---\n\n# UI polish\n'
  );
  return directory;
}

describe('inspectSkillDirectory', () => {
  it('reads metadata and reports risky files without executing them', async () => {
    const directory = await createSkillDirectory();
    const scriptPath = join(directory, 'scripts', 'setup.sh');
    await mkdir(join(directory, 'scripts'));
    await writeFile(scriptPath, '#!/bin/sh\necho should-not-run\n');
    await chmod(scriptPath, 0o755);
    await writeFile(join(directory, 'asset.bin'), Buffer.from([0, 1, 2]));
    await symlink('scripts/setup.sh', join(directory, 'setup-link'));

    const result = await inspectSkillDirectory(directory);

    expect(result.name).toBe('ui-polish');
    expect(result.originalDescription).toBe('界面美化流程');
    expect(result.contentHash).toMatch(/^sha256:/);
    expect(result.files.map((file) => file.relativePath)).toEqual(expect.arrayContaining(['asset.bin', 'SKILL.md', 'scripts/setup.sh', 'setup-link']));
    expect(result.risks).toEqual([
      { kind: 'binary-file', relativePath: 'asset.bin' },
      // Windows does not expose POSIX executable permission bits.
      ...(process.platform === 'win32' ? [] : [{ kind: 'executable-file', relativePath: 'scripts/setup.sh' }]),
      { kind: 'script-file', relativePath: 'scripts/setup.sh' },
      { kind: 'symlink', relativePath: 'setup-link', detail: join('scripts', 'setup.sh') }
    ]);
  });

  it('requires a regular SKILL.md file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-baton-skill-'));
    tempDirectories.push(directory);

    await expect(inspectSkillDirectory(directory)).rejects.toBeInstanceOf(SkillInspectionError);
  });
});
