export const AGENT_KINDS = [
  'codex',
  'claude-code',
  'cursor',
  'trae',
  'opencode'
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];
export type SkillId = string;
export type GroupId = string;

export type SyncPolicy = 'local-only' | 'sync-allowed';
export type SkillOverride = 'force-enable' | 'force-disable';
export type CompatibilityStatus =
  | 'compatible'
  | 'compatible-with-warning'
  | 'incompatible'
  | 'unknown';

export interface LocalSkillSource {
  kind: 'local';
}

export interface UpstreamSkillSource {
  kind: 'upstream';
  repositoryUrl: string;
  relativePath: string;
  baselineCommit: string;
  contentHash: string;
}

export type SkillSource = LocalSkillSource | UpstreamSkillSource;

export interface ManagedSkill {
  id: SkillId;
  name: string;
  originalDescription: string;
  userDescription?: string;
  tags: string[];
  syncPolicy: SyncPolicy;
  source: SkillSource;
}

export interface SkillGroup {
  id: GroupId;
  name: string;
  participatesInSync: boolean;
  skillIds: SkillId[];
}

export interface DesiredAgentState {
  agent: AgentKind;
  activeGroupIds: GroupId[];
  overrides: Partial<Record<SkillId, SkillOverride>>;
}

export interface ObservedInstallation {
  skillId?: SkillId;
  agent: AgentKind;
  path: string;
  contentHash: string;
  enabled: boolean;
  managed: boolean;
}

export interface EffectiveSkillSet {
  skillIds: SkillId[];
  unknownGroupIds: GroupId[];
  unknownSkillIds: SkillId[];
}

export interface PortableSkill {
  skill: ManagedSkill;
}

export interface PortableGroup {
  group: SkillGroup;
}

export interface PortableAgentState {
  state: DesiredAgentState;
}

export interface PortableSnapshot {
  skills: PortableSkill[];
  groups: PortableGroup[];
  agentStates: PortableAgentState[];
}
