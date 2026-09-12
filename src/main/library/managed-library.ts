import { chmod, copyFile, lstat, mkdir, readlink, readdir, realpath, rename, rm, stat, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectSkillDirectory, type InspectedSkillDirectory } from '../skills/skill-file-inspector';

export class ManagedLibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedLibraryError';
  }
}

export interface AdoptedSkill {
  skillId: string;
  contentDirectory: string;
  inspection: InspectedSkillDirectory;
}

export interface TrashedSkill {
  skillId: string;
  trashedAt: string;
  trashDirectory: string;
}

export interface ReplacedSkillContent {
  skillId: string;
  backupDirectory: string;
  inspection: InspectedSkillDirectory;
}

/**
 * Owns canonical copies of explicitly adopted Skills. It never mutates a
 * discovered source directory and rejects links that would escape the source
 * tree during an adoption copy.
 */
export class ManagedLibrary {
  constructor(private readonly rootDirectory: string) {}

  contentDirectory(skillId: string): string {
    return join(this.skillDirectory(skillId), 'content');
  }

  async adopt(skillId: string, sourceDirectory: string): Promise<AdoptedSkill> {
    assertSafeSkillId(skillId);
    const inspection = await inspectSkillDirectory(sourceDirectory);
    const destination = this.contentDirectory(skillId);
    if (await pathExists(destination)) {
      throw new ManagedLibraryError(`Skill ${skillId} is already managed.`);
    }

    const skillDirectory = this.skillDirectory(skillId);
    const temporaryDirectory = join(this.rootDirectory, '.staging', `${skillId}-${randomUUID()}`);
    const temporaryContentDirectory = join(temporaryDirectory, 'content');
    await mkdir(dirname(temporaryDirectory), { recursive: true });

    try {
      await copySafeDirectory(inspection.canonicalPath, temporaryContentDirectory, inspection.canonicalPath);
      await mkdir(dirname(skillDirectory), { recursive: true });
      await rename(temporaryDirectory, skillDirectory);
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }

    return { skillId, contentDirectory: destination, inspection };
  }

  async trash(skillId: string, now = new Date()): Promise<TrashedSkill> {
    assertSafeSkillId(skillId);
    const sourceDirectory = this.skillDirectory(skillId);
    if (!(await pathExists(sourceDirectory))) {
      throw new ManagedLibraryError(`Skill ${skillId} is not managed.`);
    }

    const trashedAt = now.toISOString();
    const trashDirectory = join(this.rootDirectory, 'trash', `${skillId}-${now.getTime()}`);
    await mkdir(dirname(trashDirectory), { recursive: true });
    await rename(sourceDirectory, trashDirectory);
    return { skillId, trashedAt, trashDirectory };
  }

  async restore(skillId: string, trashDirectory: string): Promise<string> {
    assertSafeSkillId(skillId);
    const destination = this.skillDirectory(skillId);
    if (!(await pathExists(trashDirectory))) {
      throw new ManagedLibraryError('Trash entry no longer exists.');
    }
    if (await pathExists(destination)) {
      throw new ManagedLibraryError(`Skill ${skillId} is already managed.`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await rename(trashDirectory, destination);
    return this.contentDirectory(skillId);
  }

  /** Copies a canonical Skill for a portable export without trusting links. */
  async exportContent(skillId: string, targetDirectory: string): Promise<void> {
    assertSafeSkillId(skillId);
    const sourceDirectory = this.contentDirectory(skillId);
    if (!(await pathExists(sourceDirectory))) {
      throw new ManagedLibraryError(`Skill ${skillId} is not managed.`);
    }
    await copySafeDirectory(sourceDirectory, targetDirectory, sourceDirectory);
  }

  /**
   * Replaces canonical content only from a previously staged candidate. The
   * old version remains locally recoverable instead of being overwritten.
   */
  async replaceContent(skillId: string, candidateDirectory: string, now = new Date()): Promise<ReplacedSkillContent> {
    assertSafeSkillId(skillId);
    const currentContent = this.contentDirectory(skillId);
    if (!(await pathExists(currentContent))) {
      throw new ManagedLibraryError(`Skill ${skillId} is not managed.`);
    }
    const inspection = await inspectSkillDirectory(candidateDirectory);
    const stagedContent = join(this.rootDirectory, '.staging', `${skillId}-replacement-${randomUUID()}`, 'content');
    const backupDirectory = join(this.rootDirectory, 'versions', `${skillId}-${now.getTime()}`);
    await mkdir(dirname(stagedContent), { recursive: true });

    try {
      await copySafeDirectory(inspection.canonicalPath, stagedContent, inspection.canonicalPath);
      await mkdir(dirname(backupDirectory), { recursive: true });
      await rename(currentContent, backupDirectory);
      try {
        await rename(stagedContent, currentContent);
      } catch (error) {
        await rename(backupDirectory, currentContent);
        throw error;
      }
    } finally {
      await rm(dirname(stagedContent), { recursive: true, force: true });
    }

    return { skillId, backupDirectory, inspection };
  }

  private skillDirectory(skillId: string): string {
    return join(this.rootDirectory, 'skills', skillId);
  }
}

async function copySafeDirectory(
  sourceDirectory: string,
  destinationDirectory: string,
  sourceRoot: string
): Promise<void> {
  await mkdir(destinationDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);
    const sourceStat = await lstat(sourcePath);

    if (sourceStat.isDirectory()) {
      await copySafeDirectory(sourcePath, destinationPath, sourceRoot);
      continue;
    }

    if (sourceStat.isFile()) {
      await copyFile(sourcePath, destinationPath);
      const fileStat = await stat(sourcePath);
      await chmod(destinationPath, fileStat.mode & 0o777);
      continue;
    }

    if (sourceStat.isSymbolicLink()) {
      await copySafeSymlink(sourcePath, destinationPath, sourceRoot);
      continue;
    }

    throw new ManagedLibraryError(`Unsupported special file: ${sourcePath}`);
  }
}

async function copySafeSymlink(
  sourcePath: string,
  destinationPath: string,
  sourceRoot: string
): Promise<void> {
  const target = await readlink(sourcePath);
  if (isAbsolute(target)) {
    throw new ManagedLibraryError(`Absolute symlink is not allowed: ${sourcePath}`);
  }

  const resolvedTarget = resolve(dirname(sourcePath), target);
  if (!isContainedBy(sourceRoot, resolvedTarget)) {
    throw new ManagedLibraryError(`Symlink escapes the Skill directory: ${sourcePath}`);
  }

  const canonicalTarget = await realpath(resolvedTarget).catch(() => undefined);
  if (!canonicalTarget || !isContainedBy(sourceRoot, canonicalTarget)) {
    throw new ManagedLibraryError(`Symlink target cannot be safely resolved: ${sourcePath}`);
  }

  await symlink(target, destinationPath);
}

function isContainedBy(rootDirectory: string, candidatePath: string): boolean {
  const root = resolve(rootDirectory);
  const candidate = resolve(candidatePath);
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function assertSafeSkillId(skillId: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(skillId)) {
    throw new ManagedLibraryError('Skill ID must contain only letters, numbers, and hyphens.');
  }
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true).catch(() => false);
}

export function defaultManagedLibraryRoot(appDataDirectory: string): string {
  return join(appDataDirectory, 'managed-library');
}
