import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class FileTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTransactionError';
  }
}

export interface PlannedFileWrite {
  path: string;
  content: string | Uint8Array;
  /** null means the target must not exist; a hash means it must be unchanged. */
  expectedHash: string | null;
}

export interface FileTransactionResult {
  id: string;
  backupDirectory: string;
  changedPaths: string[];
}

interface OriginalFileState {
  path: string;
  existed: boolean;
  backupPath?: string;
}

/**
 * A per-Agent file transaction. It validates all targets before mutation, keeps
 * durable file backups, and restores files changed in this transaction on an
 * error. It intentionally does not claim multi-Agent global atomicity.
 */
export class FileTransaction {
  constructor(
    private readonly backupRoot: string,
    private readonly allowedRoots: readonly string[]
  ) {
    if (allowedRoots.length === 0) {
      throw new FileTransactionError('At least one allowed root is required.');
    }
  }

  async execute(writes: readonly PlannedFileWrite[]): Promise<FileTransactionResult> {
    if (writes.length === 0) {
      throw new FileTransactionError('A transaction requires at least one planned write.');
    }

    const transactionId = randomUUID();
    const backupDirectory = join(this.backupRoot, transactionId);
    const uniqueWrites = deduplicateWrites(writes);
    uniqueWrites.forEach((write) => this.assertAllowed(write.path));
    await Promise.all(uniqueWrites.map((write) => verifyExpectedHash(write)));

    const originalStates = await this.backUpOriginals(uniqueWrites, backupDirectory);
    const changedPaths: string[] = [];

    try {
      for (const write of uniqueWrites) {
        await writeAtomically(write.path, write.content);
        changedPaths.push(write.path);
      }

      return { id: transactionId, backupDirectory, changedPaths };
    } catch (error) {
      await this.restoreChangedFiles(originalStates, changedPaths);
      const detail = error instanceof Error ? error.message : 'Unknown file write error.';
      throw new FileTransactionError(`Transaction rolled back: ${detail}`);
    }
  }

  private async backUpOriginals(
    writes: readonly PlannedFileWrite[],
    backupDirectory: string
  ): Promise<OriginalFileState[]> {
    await mkdir(backupDirectory, { recursive: true });
    const states: OriginalFileState[] = [];

    for (const [index, write] of writes.entries()) {
      const fileStat = await stat(write.path).catch(() => undefined);
      if (!fileStat) {
        states.push({ path: write.path, existed: false });
        continue;
      }
      if (!fileStat.isFile()) {
        throw new FileTransactionError(`Planned target is not a regular file: ${write.path}`);
      }

      const backupPath = join(backupDirectory, `${index}.backup`);
      await copyFile(write.path, backupPath);
      states.push({ path: write.path, existed: true, backupPath });
    }

    await writeFile(
      join(backupDirectory, 'manifest.json'),
      `${JSON.stringify(states, null, 2)}\n`,
      'utf8'
    );
    return states;
  }

  private async restoreChangedFiles(
    states: readonly OriginalFileState[],
    changedPaths: readonly string[]
  ): Promise<void> {
    const changed = new Set(changedPaths);
    for (const state of [...states].reverse()) {
      if (!changed.has(state.path)) {
        continue;
      }

      if (state.existed && state.backupPath) {
        await copyFile(state.backupPath, state.path);
      } else {
        await rm(state.path, { force: true });
      }
    }
  }

  private assertAllowed(candidatePath: string): void {
    if (!isAbsolute(candidatePath)) {
      throw new FileTransactionError(`Planned target must be absolute: ${candidatePath}`);
    }
    if (!this.allowedRoots.some((root) => isContainedBy(root, candidatePath))) {
      throw new FileTransactionError(`Planned target escapes allowed roots: ${candidatePath}`);
    }
  }
}

function deduplicateWrites(writes: readonly PlannedFileWrite[]): PlannedFileWrite[] {
  const paths = new Set<string>();
  for (const write of writes) {
    if (paths.has(write.path)) {
      throw new FileTransactionError(`Apply Plan contains duplicate target: ${write.path}`);
    }
    paths.add(write.path);
  }
  return [...writes];
}

async function verifyExpectedHash(write: PlannedFileWrite): Promise<void> {
  const actualHash = await hashFileOrMissing(write.path);
  if (actualHash !== write.expectedHash) {
    throw new FileTransactionError(
      `Target changed since planning: ${write.path} (expected ${write.expectedHash ?? 'missing'}, got ${actualHash ?? 'missing'}).`
    );
  }
}

async function writeAtomically(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${randomUUID()}.agent-baton.tmp`);
  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function hashFileOrMissing(path: string): Promise<string | null> {
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat) {
    return null;
  }
  if (!fileStat.isFile()) {
    throw new FileTransactionError(`Expected a regular file: ${path}`);
  }
  const content = await readFile(path);
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function isContainedBy(rootDirectory: string, candidatePath: string): boolean {
  const root = resolve(rootDirectory);
  const candidate = resolve(candidatePath);
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
