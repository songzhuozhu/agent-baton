import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, rename, rm, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';

export type DeploymentMode = 'symlink' | 'copy';

export class ManagedDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedDeploymentError';
  }
}

export interface DeploymentRequest {
  sourceDirectory: string;
  targetDirectory: string;
  /** null means target must not exist at confirmation time. */
  expectedTargetHash: string | null;
  preferredMode?: DeploymentMode;
}

export interface DeploymentResult {
  targetDirectory: string;
  sourceHash: string;
  mode: DeploymentMode;
  backupDirectory?: string;
}

export interface UndoDeploymentRequest {
  targetDirectory: string;
  expectedCurrentHash: string;
  backupDirectory?: string;
}

/**
 * Deploys only canonical managed content to one known Agent root. The caller
 * must still obtain user confirmation through an Apply Plan before invoking it.
 */
export class ManagedInstallationDeployer {
  constructor(
    private readonly backupRoot: string,
    private readonly allowedTargetRoots: readonly string[]
  ) {}

  async deploy(request: DeploymentRequest): Promise<DeploymentResult> {
    this.assertAllowedTarget(request.targetDirectory);
    const source = await inspectSkillDirectory(request.sourceDirectory);
    const actualTargetHash = await inspectContentHashOrMissing(request.targetDirectory);
    if (actualTargetHash !== request.expectedTargetHash) {
      throw new ManagedDeploymentError(
        `Installation changed since planning: ${request.targetDirectory} (expected ${request.expectedTargetHash ?? 'missing'}, got ${actualTargetHash ?? 'missing'}).`
      );
    }

    const backupDirectory = await this.backUpTargetIfPresent(request.targetDirectory);
    try {
      const mode = await deployDirectory(
        source.canonicalPath,
        request.targetDirectory,
        request.preferredMode
      );
      return {
        targetDirectory: request.targetDirectory,
        sourceHash: source.contentHash,
        mode,
        backupDirectory
      };
    } catch (error) {
      await this.restoreTarget(request.targetDirectory, backupDirectory);
      const detail = error instanceof Error ? error.message : 'Unknown deployment failure.';
      throw new ManagedDeploymentError(`Deployment rolled back: ${detail}`);
    }
  }

  async remove(targetDirectory: string, expectedTargetHash: string): Promise<string> {
    this.assertAllowedTarget(targetDirectory);
    const actualTargetHash = await inspectContentHashOrMissing(targetDirectory);
    if (actualTargetHash !== expectedTargetHash) {
      throw new ManagedDeploymentError(`Installation changed since planning: ${targetDirectory}`);
    }
    const backupDirectory = await this.backUpTargetIfPresent(targetDirectory);
    if (!backupDirectory) {
      throw new ManagedDeploymentError(`Installation does not exist: ${targetDirectory}`);
    }
    return backupDirectory;
  }

  async rollback(result: DeploymentResult): Promise<void> {
    this.assertAllowedTarget(result.targetDirectory);
    await this.restoreTarget(result.targetDirectory, result.backupDirectory);
  }

  async restoreRemoved(targetDirectory: string, backupDirectory: string): Promise<void> {
    this.assertAllowedTarget(targetDirectory);
    await this.restoreTarget(targetDirectory, backupDirectory);
  }

  async assertCanUndoDeployment(request: UndoDeploymentRequest): Promise<void> {
    this.assertAllowedTarget(request.targetDirectory);
    const currentHash = await inspectContentHashOrMissing(request.targetDirectory);
    if (currentHash !== request.expectedCurrentHash) {
      throw new ManagedDeploymentError(`Installation changed after apply: ${request.targetDirectory}`);
    }
    if (request.backupDirectory && !(await lstat(request.backupDirectory).catch(() => undefined))) {
      throw new ManagedDeploymentError(`Installation backup is no longer available: ${request.targetDirectory}`);
    }
  }

  async assertCanUndoRemoval(targetDirectory: string, backupDirectory: string): Promise<void> {
    this.assertAllowedTarget(targetDirectory);
    if (await lstat(targetDirectory).catch(() => undefined)) {
      throw new ManagedDeploymentError(`Installation changed after apply: ${targetDirectory}`);
    }
    if (!(await lstat(backupDirectory).catch(() => undefined))) {
      throw new ManagedDeploymentError(`Removed Installation backup is no longer available: ${targetDirectory}`);
    }
  }

  async undoDeployment(request: UndoDeploymentRequest): Promise<void> {
    await this.assertCanUndoDeployment(request);
    await this.restoreTarget(request.targetDirectory, request.backupDirectory);
  }

  async undoRemoval(targetDirectory: string, backupDirectory: string): Promise<void> {
    await this.assertCanUndoRemoval(targetDirectory, backupDirectory);
    await this.restoreTarget(targetDirectory, backupDirectory);
  }

  private async backUpTargetIfPresent(targetDirectory: string): Promise<string | undefined> {
    const targetStat = await lstat(targetDirectory).catch(() => undefined);
    if (!targetStat) {
      return undefined;
    }

    const backupDirectory = join(this.backupRoot, randomUUID(), 'installation');
    await mkdir(dirname(backupDirectory), { recursive: true });
    await rename(targetDirectory, backupDirectory);
    return backupDirectory;
  }

  private async restoreTarget(targetDirectory: string, backupDirectory?: string): Promise<void> {
    await rm(targetDirectory, { recursive: true, force: true });
    if (backupDirectory && (await lstat(backupDirectory).catch(() => undefined))) {
      await mkdir(dirname(targetDirectory), { recursive: true });
      await rename(backupDirectory, targetDirectory);
    }
  }

  private assertAllowedTarget(targetDirectory: string): void {
    if (!isAbsolute(targetDirectory)) {
      throw new ManagedDeploymentError(`Installation target must be absolute: ${targetDirectory}`);
    }
    if (!this.allowedTargetRoots.some((root) => isContainedBy(root, targetDirectory))) {
      throw new ManagedDeploymentError(`Installation target escapes allowed roots: ${targetDirectory}`);
    }
  }
}

async function deployDirectory(
  sourceDirectory: string,
  targetDirectory: string,
  preferredMode: DeploymentMode | undefined
): Promise<DeploymentMode> {
  await mkdir(dirname(targetDirectory), { recursive: true });
  const temporaryTarget = join(dirname(targetDirectory), `.${randomUUID()}.agent-baton-install`);
  const mode = preferredMode ?? (process.platform === 'win32' ? 'copy' : 'symlink');

  try {
    if (mode === 'symlink') {
      await symlink(sourceDirectory, temporaryTarget, process.platform === 'win32' ? 'junction' : 'dir');
    } else {
      await cp(sourceDirectory, temporaryTarget, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true
      });
    }
    await rename(temporaryTarget, targetDirectory);
    return mode;
  } finally {
    await rm(temporaryTarget, { recursive: true, force: true });
  }
}

async function inspectContentHashOrMissing(directory: string): Promise<string | null> {
  const directoryStat = await lstat(directory).catch(() => undefined);
  if (!directoryStat) {
    return null;
  }
  return (await inspectSkillDirectory(directory)).contentHash;
}

function isContainedBy(rootDirectory: string, candidatePath: string): boolean {
  const root = resolve(rootDirectory);
  const candidate = resolve(candidatePath);
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
