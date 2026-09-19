import { randomUUID } from 'node:crypto';
import { resolveEffectiveSkillSet } from '../../domain/effective-skill-set';
import {
  buildManagedInstallationPlan,
  type ManagedInstallationPlan
} from '../../domain/managed-installation-plan';
import type {
  AgentKind,
  DesiredAgentState,
  ManagedSkill,
  SkillGroup,
  SkillOverride,
  SkillSource,
  SyncPolicy
} from '../../shared/domain';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import type { AgentAdapter } from '../adapters/agent-adapter';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';

export class SkillControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillControlError';
  }
}

export interface AdoptSkillInput {
  sourceDirectory: string;
  source?: SkillSource;
  tags?: string[];
  userDescription?: string;
  syncPolicy?: SyncPolicy;
}

export interface AgentSkillView {
  desiredState: DesiredAgentState;
  effectiveSkillIds: string[];
  unknownGroupIds: string[];
  unknownSkillIds: string[];
}

export interface PossibleDuplicateSkill {
  skillId: string;
  name: string;
  reason: 'same-content' | 'same-name';
}

/**
 * Application-level Module for user intent. It is the only caller that joins
 * canonical content ownership, device state and pure domain calculations.
 */
export class SkillControlService {
  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly managedLibrary: ManagedLibrary
  ) {}

  async adoptSkill(input: AdoptSkillInput): Promise<ManagedSkill> {
    const skillId = randomUUID();
    const adopted = await this.managedLibrary.adopt(skillId, input.sourceDirectory);
    const skill: ManagedSkill = {
      id: skillId,
      name: adopted.inspection.name,
      originalDescription: adopted.inspection.originalDescription,
      userDescription: input.userDescription?.trim() || undefined,
      tags: normalizeTags(input.tags ?? []),
      // Security invariant: an explicit user action is required before any
      // Skill becomes portable.
      syncPolicy: input.syncPolicy ?? 'local-only',
      source: input.source ?? { kind: 'local' }
    };
    this.stateStore.saveSkill(skill);
    return skill;
  }

  listSkills(): ManagedSkill[] {
    return this.stateStore.listSkills();
  }

  listGroups(): SkillGroup[] {
    return this.stateStore.listGroups();
  }

  /**
   * A conservative hint only. Stable IDs remain authoritative: a matching
   * name or content hash never causes automatic merging or deletion.
   */
  async findPossibleDuplicates(candidate: { name: string; contentHash: string }): Promise<PossibleDuplicateSkill[]> {
    const skills = this.stateStore.listSkills();
    const matches = await Promise.all(skills.map(async (skill) => {
      const inspection = await inspectSkillDirectory(this.managedLibrary.contentDirectory(skill.id));
      if (inspection.contentHash === candidate.contentHash) {
        return { skillId: skill.id, name: skill.name, reason: 'same-content' as const };
      }
      if (skill.name.trim().toLocaleLowerCase() === candidate.name.trim().toLocaleLowerCase()) {
        return { skillId: skill.id, name: skill.name, reason: 'same-name' as const };
      }
      return undefined;
    }));
    return matches.filter((match): match is PossibleDuplicateSkill => Boolean(match))
      .sort((left, right) => left.skillId.localeCompare(right.skillId));
  }

  updateSkillMetadata(
    skillId: string,
    input: Pick<AdoptSkillInput, 'tags' | 'userDescription' | 'syncPolicy'>
  ): ManagedSkill {
    const existing = this.requireSkill(skillId);
    const updated: ManagedSkill = {
      ...existing,
      tags: input.tags === undefined ? existing.tags : normalizeTags(input.tags),
      userDescription:
        input.userDescription === undefined
          ? existing.userDescription
          : input.userDescription.trim() || undefined,
      syncPolicy: input.syncPolicy ?? existing.syncPolicy
    };
    this.stateStore.saveSkill(updated);
    return updated;
  }

  applyConfirmedUpstreamUpdate(
    skillId: string,
    originalDescription: string,
    source: Extract<SkillSource, { kind: 'upstream' }>
  ): ManagedSkill {
    const existing = this.requireSkill(skillId);
    const updated: ManagedSkill = {
      ...existing,
      originalDescription,
      source
    };
    this.stateStore.saveSkill(updated);
    return updated;
  }

  createGroup(name: string): SkillGroup {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new SkillControlError('Skill Group name is required.');
    }

    const group: SkillGroup = {
      id: randomUUID(),
      name: normalizedName,
      participatesInSync: false,
      skillIds: []
    };
    this.stateStore.saveGroup(group);
    return group;
  }

  addSkillToGroup(groupId: string, skillId: string): SkillGroup {
    this.requireSkill(skillId);
    const group = this.requireGroup(groupId);
    const updated: SkillGroup = {
      ...group,
      skillIds: [...new Set([...group.skillIds, skillId])].sort()
    };
    this.stateStore.saveGroup(updated);
    return updated;
  }

  setGroupSyncParticipation(groupId: string, participatesInSync: boolean): SkillGroup {
    const group = this.requireGroup(groupId);
    const updated = { ...group, participatesInSync };
    this.stateStore.saveGroup(updated);
    return updated;
  }

  renameGroup(groupId: string, name: string): SkillGroup {
    const normalizedName = name.trim();
    if (!normalizedName) throw new SkillControlError('Skill Group name is required.');
    const updated = { ...this.requireGroup(groupId), name: normalizedName };
    this.stateStore.saveGroup(updated);
    return updated;
  }

  removeSkillFromGroup(groupId: string, skillId: string): SkillGroup {
    const group = this.requireGroup(groupId);
    const updated = { ...group, skillIds: group.skillIds.filter((candidate) => candidate !== skillId) };
    this.stateStore.saveGroup(updated);
    return updated;
  }

  setSkillOverride(agent: AgentKind, skillId: string, override?: SkillOverride): DesiredAgentState {
    this.requireSkill(skillId);
    const state = this.getDesiredState(agent);
    const overrides = { ...state.overrides };
    if (override) {
      overrides[skillId] = override;
    } else {
      delete overrides[skillId];
    }
    const updated = { ...state, overrides };
    this.stateStore.saveDesiredAgentState(updated);
    return updated;
  }

  setActiveGroups(agent: AgentKind, groupIds: readonly string[]): DesiredAgentState {
    const uniqueGroupIds = [...new Set(groupIds)].sort();
    uniqueGroupIds.forEach((groupId) => this.requireGroup(groupId));
    const updated: DesiredAgentState = {
      ...this.getDesiredState(agent),
      activeGroupIds: uniqueGroupIds
    };
    this.stateStore.saveDesiredAgentState(updated);
    return updated;
  }

  setActiveGroupsForAgents(agents: readonly AgentKind[], groupIds: readonly string[]): DesiredAgentState[] {
    const uniqueAgents = [...new Set(agents)].sort() as AgentKind[];
    const uniqueGroupIds = [...new Set(groupIds)].sort();
    uniqueGroupIds.forEach((groupId) => this.requireGroup(groupId));
    const states = uniqueAgents.map((agent) => ({ ...this.getDesiredState(agent), activeGroupIds: uniqueGroupIds }));
    this.stateStore.saveDesiredAgentStates(states);
    return states;
  }

  getAgentSkillView(agent: AgentKind): AgentSkillView {
    const desiredState = this.getDesiredState(agent);
    const effective = resolveEffectiveSkillSet({
      skills: this.stateStore.listSkills(),
      groups: this.stateStore.listGroups(),
      desiredState
    });
    return {
      desiredState,
      effectiveSkillIds: effective.skillIds,
      unknownGroupIds: effective.unknownGroupIds,
      unknownSkillIds: effective.unknownSkillIds
    };
  }

  async previewManagedInstallationPlan(adapter: AgentAdapter): Promise<ManagedInstallationPlan> {
    const targetRoot = adapter.managedSkillRoot();
    if (!targetRoot) {
      throw new SkillControlError(`${adapter.agent} 没有可安全写入的用户级 Skill 根目录。`);
    }

    const skillView = this.getAgentSkillView(adapter.agent);
    const managedSkills = await Promise.all(
      this.stateStore.listSkills().map(async (skill) => {
        const contentDirectory = this.managedLibrary.contentDirectory(skill.id);
        const inspection = await inspectSkillDirectory(contentDirectory);
        return { skill, contentDirectory, contentHash: inspection.contentHash };
      })
    );
    const plan = buildManagedInstallationPlan({
      agent: adapter.agent,
      effectiveSkillIds: skillView.effectiveSkillIds,
      managedSkills,
      observedInstallations: this.stateStore.listObservedInstallations(),
      targetRoot
    });
    plan.operations = await Promise.all(plan.operations.map(async (operation) => operation.kind === 'remove'
      ? { ...operation, expectedSourceDirectory: await this.managedLibrary.canonicalContentDirectory(operation.skillId) }
      : operation));
    return plan;
  }

  hasExplicitDesiredState(agent: AgentKind): boolean {
    return this.stateStore.listDesiredAgentStates().some((state) => state.agent === agent);
  }

  private getDesiredState(agent: AgentKind): DesiredAgentState {
    return (
      this.stateStore.listDesiredAgentStates().find((state) => state.agent === agent) ?? {
        agent,
        activeGroupIds: [],
        overrides: {}
      }
    );
  }

  private requireSkill(skillId: string): ManagedSkill {
    const skill = this.stateStore.listSkills().find((candidate) => candidate.id === skillId);
    if (!skill) {
      throw new SkillControlError(`Managed Skill not found: ${skillId}`);
    }
    return skill;
  }

  private requireGroup(groupId: string): SkillGroup {
    const group = this.stateStore.listGroups().find((candidate) => candidate.id === groupId);
    if (!group) {
      throw new SkillControlError(`Skill Group not found: ${groupId}`);
    }
    return group;
  }
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}
