import type {
  DesiredAgentState,
  EffectiveSkillSet,
  ManagedSkill,
  SkillGroup,
  SkillId
} from '../shared/domain';

export interface ResolveEffectiveSkillSetInput {
  skills: readonly ManagedSkill[];
  groups: readonly SkillGroup[];
  desiredState: DesiredAgentState;
}

/**
 * Resolves portable user intent without inspecting the filesystem or an Agent.
 * Force-disable always wins over group membership and force-enable.
 */
export function resolveEffectiveSkillSet(
  input: ResolveEffectiveSkillSetInput
): EffectiveSkillSet {
  const knownSkills = new Set(input.skills.map((skill) => skill.id));
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const effectiveIds = new Set<SkillId>();
  const unknownGroupIds = new Set<string>();
  const unknownSkillIds = new Set<string>();

  for (const groupId of input.desiredState.activeGroupIds) {
    const group = groupsById.get(groupId);
    if (!group) {
      unknownGroupIds.add(groupId);
      continue;
    }

    for (const skillId of group.skillIds) {
      if (!knownSkills.has(skillId)) {
        unknownSkillIds.add(skillId);
        continue;
      }
      effectiveIds.add(skillId);
    }
  }

  for (const [skillId, override] of Object.entries(input.desiredState.overrides)) {
    if (!knownSkills.has(skillId)) {
      unknownSkillIds.add(skillId);
      continue;
    }

    if (override === 'force-enable') {
      effectiveIds.add(skillId);
    }
  }

  for (const [skillId, override] of Object.entries(input.desiredState.overrides)) {
    if (override === 'force-disable') {
      effectiveIds.delete(skillId);
    }
  }

  return {
    skillIds: [...effectiveIds].sort(),
    unknownGroupIds: [...unknownGroupIds].sort(),
    unknownSkillIds: [...unknownSkillIds].sort()
  };
}
