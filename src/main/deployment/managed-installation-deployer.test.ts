import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';
import {
  ManagedDeploymentError,
  ManagedInstallationDeployer
} from './managed-installation-deployer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createSkillDirectory(parent: string, name: string, content: string): Promise<string> {
  const directory = join(parent, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n${content}`);
  return directory;
}

describe('ManagedInstallationDeployer', () => {
  it('deploys a managed copy with an explicit copy fallback', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-deploy-'));
    temporaryDirectories.push(workspace);
    const source = await createSkillDirectory(workspace, 'source', 'canonical');
    const targetRoot = join(workspace, 'agent-skills');
    const target = join(targetRoot, 'design');
    const deployer = new ManagedInstallationDeployer(join(workspace, 'backups'), [targetRoot]);

    const result = await deployer.deploy({
      sourceDirectory: source,
      targetDirectory: target,
      expectedTargetHash: null,
      preferredMode: 'copy'
    });

    expect(result.mode).toBe('copy');
    await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toContain('canonical');
    expect((await lstat(target)).isSymbolicLink()).toBe(false);
  });

  it('refuses to replace an installation that drifted after planning', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-deploy-'));
    temporaryDirectories.push(workspace);
    const source = await createSkillDirectory(workspace, 'source', 'canonical');
    const targetRoot = join(workspace, 'agent-skills');
    const target = await createSkillDirectory(targetRoot, 'design', 'external');
    const plannedHash = (await inspectSkillDirectory(target)).contentHash;
    await writeFile(join(target, 'SKILL.md'), '---\nname: design\ndescription: design\n---\nexternal changed');
    const deployer = new ManagedInstallationDeployer(join(workspace, 'backups'), [targetRoot]);

    await expect(
      deployer.deploy({ sourceDirectory: source, targetDirectory: target, expectedTargetHash: plannedHash })
    ).rejects.toBeInstanceOf(ManagedDeploymentError);
    await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toContain('external changed');
  });

  it('restores the previous installation when a completed deployment is rolled back', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-deploy-'));
    temporaryDirectories.push(workspace);
    const source = await createSkillDirectory(workspace, 'source', 'canonical');
    const targetRoot = join(workspace, 'agent-skills');
    const target = await createSkillDirectory(targetRoot, 'design', 'before');
    const deployer = new ManagedInstallationDeployer(join(workspace, 'backups'), [targetRoot]);
    const result = await deployer.deploy({
      sourceDirectory: source,
      targetDirectory: target,
      expectedTargetHash: (await inspectSkillDirectory(target)).contentHash,
      preferredMode: 'copy'
    });

    await deployer.rollback(result);

    await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toContain('before');
  });
});
