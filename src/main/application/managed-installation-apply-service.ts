import { randomUUID } from 'node:crypto';
import type { ManagedInstallationPlan } from '../../domain/managed-installation-plan';
import type { ObservedInstallation } from '../../shared/domain';
import { type DeploymentResult, ManagedInstallationDeployer } from '../deployment/managed-installation-deployer';
import { LocalStateStore, type AppliedInstallationChange, type ApplyRecord } from '../storage/local-state-store';

export interface ManagedInstallationApplyResult {
  appliedOperationCount: number;
  backupReferences: string[];
}

interface RemovedInstallation {
  targetDirectory: string;
  backupDirectory: string;
}

/** Executes a confirmed, single-Agent plan and records only successful state. */
export class ManagedInstallationApplyService {
  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly deployer: ManagedInstallationDeployer
  ) {}

  async apply(plan: ManagedInstallationPlan): Promise<ManagedInstallationApplyResult> {
    const deployments: DeploymentResult[] = [];
    const removals: RemovedInstallation[] = [];
    const installationsToSave: ObservedInstallation[] = [];
    const previousInstallationsByPath = new Map(
      this.stateStore.listObservedInstallations()
        .filter((installation) => installation.agent === plan.agent)
        .map((installation) => [installation.path, installation])
    );

    try {
      for (const operation of plan.operations) {
        if (operation.kind === 'deploy') {
          const deployed = await this.deployer.deploy({
            sourceDirectory: operation.sourceDirectory,
            targetDirectory: operation.targetDirectory,
            expectedTargetHash: operation.expectedTargetHash
          });
          deployments.push(deployed);
          installationsToSave.push({
            agent: plan.agent,
            skillId: operation.skillId,
            path: operation.targetDirectory,
            contentHash: deployed.sourceHash,
            enabled: true,
            managed: true
          });
          continue;
        }

        const backupDirectory = await this.deployer.remove(
          operation.targetDirectory,
          operation.expectedTargetHash,
          operation.expectedSourceDirectory
        );
        removals.push({ targetDirectory: operation.targetDirectory, backupDirectory });
      }

      const backupReferences = [
        ...deployments.map((deployment) => deployment.backupDirectory),
        ...removals.map((removal) => removal.backupDirectory)
      ].filter((path): path is string => Boolean(path));
      const record: ApplyRecord = {
        id: randomUUID(),
        agent: plan.agent,
        createdAt: new Date().toISOString(),
        summary: `${plan.agent}: ${plan.operations.length} 项托管 Installation 变更`,
        result: 'succeeded',
        backupReference: backupReferences.join(',') || undefined,
        changes: toAppliedChanges(deployments, removals, installationsToSave, previousInstallationsByPath)
      };
      this.stateStore.commitAgentApply(
        plan.agent,
        installationsToSave,
        removals.map((removal) => removal.targetDirectory),
        record
      );

      return {
        appliedOperationCount: plan.operations.length,
        backupReferences
      };
    } catch (error) {
      await this.rollback(deployments, removals);
      const detail = error instanceof Error ? error.message : 'Unknown application error.';
      throw new Error(`Agent apply rolled back: ${detail}`);
    }
  }

  private async rollback(
    deployments: readonly DeploymentResult[],
    removals: readonly RemovedInstallation[]
  ): Promise<void> {
    for (const deployment of [...deployments].reverse()) {
      await this.deployer.rollback(deployment);
    }
    for (const removal of [...removals].reverse()) {
      await this.deployer.restoreRemoved(removal.targetDirectory, removal.backupDirectory);
    }
  }
}

function toAppliedChanges(
  deployments: readonly DeploymentResult[],
  removals: readonly RemovedInstallation[],
  installations: readonly ObservedInstallation[],
  previousByPath: ReadonlyMap<string, ObservedInstallation>
): AppliedInstallationChange[] {
  const installationsByPath = new Map(installations.map((installation) => [installation.path, installation]));
  return [
    ...deployments.map((deployment) => ({
      kind: 'deploy' as const,
      targetDirectory: deployment.targetDirectory,
      expectedCurrentHash: deployment.sourceHash,
      ...(deployment.backupDirectory ? { backupDirectory: deployment.backupDirectory } : {}),
      ...(previousByPath.get(deployment.targetDirectory) ? { previousInstallation: previousByPath.get(deployment.targetDirectory) } : {}),
      resultingInstallation: installationsByPath.get(deployment.targetDirectory)!
    })),
    ...removals.map((removal) => ({
      kind: 'remove' as const,
      targetDirectory: removal.targetDirectory,
      backupDirectory: removal.backupDirectory,
      ...(previousByPath.get(removal.targetDirectory) ? { previousInstallation: previousByPath.get(removal.targetDirectory) } : {})
    }))
  ];
}
