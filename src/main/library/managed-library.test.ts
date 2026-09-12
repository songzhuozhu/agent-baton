import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagedLibrary, ManagedLibraryError } from './managed-library';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createSkillSource(parent: string): Promise<string> {
  const source = join(parent, 'source');
  await mkdir(join(source, 'scripts'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: demo\ndescription: demo\n---\n');
  await writeFile(join(source, 'scripts', 'help.txt'), 'help');
  return source;
}

describe('ManagedLibrary', () => {
  it('adopts a canonical copy and leaves the discovered source intact', async () => {
    const workspace = await createTemporaryDirectory('agent-baton-library-');
    const source = await createSkillSource(workspace);
    const library = new ManagedLibrary(join(workspace, 'library'));

    const adopted = await library.adopt('skill-1', source);

    await expect(readFile(join(adopted.contentDirectory, 'SKILL.md'), 'utf8')).resolves.toContain('name: demo');
    await expect(readFile(join(source, 'scripts', 'help.txt'), 'utf8')).resolves.toBe('help');
    await expect(library.adopt('skill-1', source)).rejects.toBeInstanceOf(ManagedLibraryError);
  });

  it('refuses a source symlink that escapes the Skill root', async () => {
    const workspace = await createTemporaryDirectory('agent-baton-library-');
    const source = await createSkillSource(workspace);
    const outside = join(workspace, 'private.txt');
    await writeFile(outside, 'do not copy');
    await symlink('../../private.txt', join(source, 'scripts', 'outside-link'));
    const library = new ManagedLibrary(join(workspace, 'library'));

    await expect(library.adopt('skill-2', source)).rejects.toThrow('Symlink escapes the Skill directory');
  });

  it('moves deleted managed content to trash and can restore it', async () => {
    const workspace = await createTemporaryDirectory('agent-baton-library-');
    const source = await createSkillSource(workspace);
    const library = new ManagedLibrary(join(workspace, 'library'));
    await library.adopt('skill-3', source);

    const trashed = await library.trash('skill-3', new Date('2026-08-09T00:00:00.000Z'));
    const restoredDirectory = await library.restore('skill-3', trashed.trashDirectory);

    await expect(readFile(join(restoredDirectory, 'SKILL.md'), 'utf8')).resolves.toContain('name: demo');
  });

  it('exports only a validated canonical content tree', async () => {
    const workspace = await createTemporaryDirectory('agent-baton-library-');
    const source = await createSkillSource(workspace);
    const library = new ManagedLibrary(join(workspace, 'library'));
    await library.adopt('skill-4', source);
    const destination = join(workspace, 'sync-content');

    await library.exportContent('skill-4', destination);

    await expect(readFile(join(destination, 'SKILL.md'), 'utf8')).resolves.toContain('name: demo');
  });

  it('replaces canonical content from staging and retains a local version backup', async () => {
    const workspace = await createTemporaryDirectory('agent-baton-library-');
    const source = await createSkillSource(workspace);
    const candidate = join(workspace, 'candidate');
    await mkdir(candidate, { recursive: true });
    await writeFile(join(candidate, 'SKILL.md'), '---\nname: updated\ndescription: newer\n---\n');
    const library = new ManagedLibrary(join(workspace, 'library'));
    await library.adopt('skill-5', source);

    const replaced = await library.replaceContent('skill-5', candidate, new Date('2026-08-09T00:00:00.000Z'));

    await expect(readFile(join(library.contentDirectory('skill-5'), 'SKILL.md'), 'utf8')).resolves.toContain('name: updated');
    await expect(readFile(join(replaced.backupDirectory, 'SKILL.md'), 'utf8')).resolves.toContain('name: demo');
  });
});
