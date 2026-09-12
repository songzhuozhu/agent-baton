import type {
  DesiredAgentState,
  ManagedSkill,
  PortableSnapshot,
  SkillGroup,
  SkillId
} from '../shared/domain';

export interface SelectPortableSnapshotInput {
  skills: readonly ManagedSkill[];
  groups: readonly SkillGroup[];
  desiredStates: readonly DesiredAgentState[];
}

/**
 * Produces the only data that may leave the device. A Local Only skill is
 * excluded even when a selected group or override references it.
 */
export function selectPortableSnapshot(
  input: SelectPortableSnapshotInput
): PortableSnapshot {
  const skillsById = new Map(input.skills.map((skill) => [skill.id, skill]));
  const syncGroups = input.groups.filter((group) => group.participatesInSync);
  const referencedBySyncGroup = new Set<SkillId>(
    syncGroups.flatMap((group) => group.skillIds)
  );
  const includedSkillIds = new Set(
    [...referencedBySyncGroup].filter(
      (skillId) => skillsById.get(skillId)?.syncPolicy === 'sync-allowed'
    )
  );

  const groups = syncGroups
    .map((group) => ({
      group: {
        ...group,
        skillIds: [...new Set(group.skillIds)]
          .filter((skillId) => includedSkillIds.has(skillId))
          .sort()
      }
    }))
    .sort((left, right) => left.group.id.localeCompare(right.group.id));

  const skills = [...includedSkillIds]
    .sort()
    .map((skillId) => ({ skill: skillsById.get(skillId)! }));

  const syncGroupIds = new Set(groups.map(({ group }) => group.id));
  const agentStates = input.desiredStates
    .map((state) => ({
      state: {
        ...state,
        activeGroupIds: [...new Set(state.activeGroupIds)]
          .filter((groupId) => syncGroupIds.has(groupId))
          .sort(),
        overrides: Object.fromEntries(
          Object.entries(state.overrides)
            .filter(([skillId]) => includedSkillIds.has(skillId))
            .sort(([left], [right]) => left.localeCompare(right))
        )
      }
    }))
    .sort((left, right) => left.state.agent.localeCompare(right.state.agent));

  return { skills, groups, agentStates };
}
