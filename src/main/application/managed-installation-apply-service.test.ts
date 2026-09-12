import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManagedInstallationPlan } from '../../domain/managed-installation-plan';
import { ManagedInstallationDeployer } from '../deployment/managed-installation-deployer';
import { LocalStateStore } from '../storage/local-state-store';
import { ManagedInstallationApplyService } from './managed-installation-apply-service';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ManagedInstallationApplyService', () => {
  it('applies a confirmed deploy plan and stores an observed managed Installation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-apply-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'library', 'design');
    const targetRoot = join(workspace, 'agent-skills');
    const target = join(targetRoot, 'design-skill');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: design\n---\ncanonical');
    const store = new LocalStateStore(':memory:');
    const deployer = new ManagedInstallationDeployer(join(workspace, 'backups'), [targetRoot]);
    const service = new ManagedInstallationApplyService(store, deployer);
    const plan: ManagedInstallationPlan = {
      agent: 'codex',
      blockedExternalInstallationPaths: [],
      operations: [
        {
          kind: 'deploy',
          skillId: 'skill-1',
          sourceDirectory: source,
          targetDirectory: target,
          expectedTargetHash: null
        }
      ]
    };

    try {
      await expect(service.apply(plan)).resolves.toMatchObject({ appliedOperationCount: 1 });
      await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toContain('canonical');
      expect(store.listObservedInstallations()).toEqual([
        expect.objectContaining({ agent: 'codex', skillId: 'skill-1', path: target, managed: true })
      ]);
      expect(store.listApplyRecords()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('rolls back earlier Installation changes when a later plan operation detects drift', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-apply-'));
    temporaryDirectories.push(workspace);
    const firstSource = join(workspace, 'library', 'first');
    const secondSource = join(workspace, 'library', 'second');
    const targetRoot = join(workspace, 'agent-skills');
    const firstTarget = join(targetRoot, 'first');
    const secondTarget = join(targetRoot, 'second');
    await mkdir(firstSource, { recursive: true });
    await mkdir(secondSource, { recursive: true });
    await mkdir(secondTarget, { recursive: true });
    await writeFile(join(firstSource, 'SKILL.md'), '---\nname: first\ndescription: first\n---\ncanonical');
    await writeFile(join(secondSource, 'SKILL.md'), '---\nname: second\ndescription: second\n---\ncanonical');
    await writeFile(join(secondTarget, 'SKILL.md'), '---\nname: second\ndescription: second\n---\nbefore');
    const plannedSecondHash = (await inspectSkillDirectory(secondTarget)).contentHash;
    await writeFile(join(secondTarget, 'SKILL.md'), '---\nname: second\ndescription: second\n---\nexternal');
    const store = new LocalStateStore(':memory:');
    const service = new ManagedInstallationApplyService(
      store,
      new ManagedInstallationDeployer(join(workspace, 'backups'), [targetRoot])
    );

    try {
      await expect(
        service.apply({
          agent: 'codex',
          blockedExternalInstallationPaths: [],
          operations: [
            {
              kind: 'deploy',
              skillId: 'first',
              sourceDirectory: firstSource,
              targetDirectory: firstTarget,
              expectedTargetHash: null
            },
            {
              kind: 'deploy',
              skillId: 'second',
              sourceDirectory: secondSource,
              targetDirectory: secondTarget,
              expectedTargetHash: plannedSecondHash
            }
          ]
        })
      ).rejects.toThrow('Agent apply rolled back');
      await expect(readFile(join(secondTarget, 'SKILL.md'), 'utf8')).resolves.toContain('external');
      await expect(readFile(join(firstTarget, 'SKILL.md'), 'utf8')).rejects.toThrow();
      expect(store.listObservedInstallations()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
