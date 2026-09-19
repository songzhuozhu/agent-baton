import { basename, join } from 'node:path';
import type { AgentKind, ManagedSkill, ObservedInstallation } from '../shared/domain';

export type ManagedInstallationOperation =
  | {
      kind: 'deploy';
      skillId: string;
      sourceDirectory: string;
      targetDirectory: string;
      expectedTargetHash: string | null;
    }
  | {
      kind: 'remove';
      skillId: string;
      targetDirectory: string;
      expectedTargetHash: string;
      /** Original canonical location, including after its Skill moves to trash. */
      expectedSourceDirectory?: string;
    };

export interface ManagedSkillContent {
  skill: ManagedSkill;
  contentDirectory: string;
  contentHash: string;
}

export interface ManagedInstallationPlan {
  agent: AgentKind;
  operations: ManagedInstallationOperation[];
  blockedExternalInstallationPaths: string[];
}

export interface BuildManagedInstallationPlanInput {
  agent: AgentKind;
  effectiveSkillIds: readonly string[];
  managedSkills: readonly ManagedSkillContent[];
  observedInstallations: readonly ObservedInstallation[];
  targetRoot: string;
}

/**
 * Plans only AgentBaton-owned Installation changes. Discovered external Skills
 * are intentionally reported as blocked rather than deleted or overwritten.
 */
export function buildManagedInstallationPlan(
  input: BuildManagedInstallationPlanInput
): ManagedInstallationPlan {
  const managedById = new Map(input.managedSkills.map((item) => [item.skill.id, item]));
  const desiredIds = new Set(input.effectiveSkillIds);
  const currentManagedBySkillId = new Map(
    input.observedInstallations
      .filter((installation) => installation.agent === input.agent && installation.managed && installation.skillId)
      .map((installation) => [installation.skillId!, installation])
  );

  const operations: ManagedInstallationOperation[] = [];
  for (const skillId of [...desiredIds].sort()) {
    const managedSkill = managedById.get(skillId);
    if (!managedSkill) {
      continue;
    }

    const current = currentManagedBySkillId.get(skillId);
    const targetDirectory = current?.path ?? managedInstallationTarget(input.targetRoot, managedSkill.skill);
    if (!current || !current.enabled || current.contentHash !== managedSkill.contentHash) {
      operations.push({
        kind: 'deploy',
        skillId,
        sourceDirectory: managedSkill.contentDirectory,
        targetDirectory,
        expectedTargetHash: current?.contentHash ?? null
      });
    }
  }

  for (const [skillId, installation] of currentManagedBySkillId) {
    if (!desiredIds.has(skillId)) {
      operations.push({
        kind: 'remove',
        skillId,
        targetDirectory: installation.path,
        expectedTargetHash: installation.contentHash
      });
    }
  }

  const blockedExternalInstallationPaths = input.observedInstallations
    .filter((installation) => installation.agent === input.agent && !installation.managed)
    .map((installation) => installation.path)
    .sort();

  return {
    agent: input.agent,
    operations: operations.sort(compareOperations),
    blockedExternalInstallationPaths
  };
}

export function managedInstallationTarget(targetRoot: string, skill: ManagedSkill): string {
  const slug = skill.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
  return join(targetRoot, `${slug}-${skill.id.slice(0, 8)}`);
}

function compareOperations(left: ManagedInstallationOperation, right: ManagedInstallationOperation): number {
  return `${left.kind}:${basename(left.targetDirectory)}`.localeCompare(
    `${right.kind}:${basename(right.targetDirectory)}`
  );
}
