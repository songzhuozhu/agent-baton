export interface DashboardAgentSummary {
  id: string;
  name: string;
  status: 'detected' | 'not-detected' | 'read-only' | 'unsupported-platform';
  currentEnabledCount: number;
  desiredEnabledCount: number;
  hasPendingChanges?: boolean;
  restartRequired: boolean;
}

export interface DashboardSnapshot {
  agents: DashboardAgentSummary[];
  pendingApplyCount: number;
  pendingSyncCount: number;
  upstreamUpdateCount: number;
}

export interface LibrarySnapshot {
  skills: ManagedSkill[];
  groups: SkillGroup[];
  discovered: DiscoveredSkillDto[];
  customScanRoots: Array<{ path: string; kind: 'custom' | 'project' }>;
  customDiscovered: CustomDiscoveredSkillDto[];
}

export interface DiscoveredSkillDto {
  agent: AgentKind;
  sourcePath: string;
  canonicalPath: string;
  skillName: string;
  originalDescription: string;
  contentHash: string;
  risks: Array<{ kind: string; relativePath: string; detail?: string }>;
}

export interface CustomDiscoveredSkillDto {
  scope: 'custom' | 'project';
  sourcePath: string;
  canonicalPath: string;
  skillName: string;
  originalDescription: string;
  contentHash: string;
  risks: Array<{ kind: string; relativePath: string; detail?: string }>;
}

export interface AgentSkillViewDto {
  desiredState: DesiredAgentState;
  effectiveSkillIds: string[];
  unknownGroupIds: string[];
  unknownSkillIds: string[];
}

export interface AdoptionPreviewDto {
  id: string;
  sourceDirectory: string;
  name: string;
  originalDescription: string;
  contentHash: string;
  risks: Array<{ kind: string; relativePath: string; detail?: string }>;
  possibleDuplicates: Array<{ skillId: string; name: string; reason: 'same-content' | 'same-name' }>;
  sourceKind: 'local' | 'upstream';
  upstream?: { repositoryUrl: string; relativePath: string; baselineCommit: string };
  expiresAt: string;
}

export interface PreviewedApplyPlanDto {
  id: string;
  createdAt: string;
  expiresAt: string;
  plan: ManagedInstallationPlan;
}

export interface BatchApplyPreviewDto {
  id: string;
  createdAt: string;
  expiresAt: string;
  plans: PreviewedApplyPlanDto[];
  failures: Array<{ agent: AgentKind; detail: string }>;
}

export interface PreviewedApplyUndoDto {
  id: string;
  agent: AgentKind;
  createdAt: string;
  expiresAt: string;
  operationCount: number;
  summary: string;
}

export interface BatchApplyResultDto {
  results: Array<
    | { agent: AgentKind; status: 'succeeded'; appliedOperationCount: number }
    | { agent: AgentKind; status: 'failed'; detail: string }
  >;
}

export interface DeleteManagedSkillPreviewDto {
  id: string;
  skill: ManagedSkill;
  affectedGroupIds: string[];
  affectedOverrides: Array<{ agent: AgentKind; override: SkillOverride }>;
  managedInstallationCount: number;
  expiresAt: string;
}

export type UpstreamStatusDto =
  | { kind: 'not-upstream' }
  | { kind: 'current'; checkedAt: string }
  | { kind: 'update-available'; checkedAt: string; remoteCommit: string }
  | { kind: 'forked'; checkedAt: string }
  | { kind: 'unavailable'; checkedAt: string; detail: string };

export interface UpstreamUpdatePreviewDto {
  id: string;
  skillId: string;
  remoteCommit: string;
  changedFiles: Array<{ path: string; change: 'added' | 'removed' | 'modified' }>;
  risks: number;
  discardLocalFork: boolean;
  expiresAt: string;
}

export interface DiagnosticBundlePreviewDto {
  files: string[];
  exclusions: string[];
}

export interface LocalErrorLogDto {
  id: string;
  createdAt: string;
  message: string;
}

export interface ManualSyncPreviewDto {
  id: string;
  createdAt: string;
  expiresAt: string;
  portableSkillCount: number;
  localOnlySkillCount: number;
  groupCount: number;
  desiredAgentStateCount: number;
  tombstoneCount: number;
  remoteRelation: 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'no-upstream';
  existingPortableChanges: string[];
  reconciliationRequired: boolean;
  conflicts: string[];
}

export interface SyncRestorePreviewDto {
  id: string;
  incomingSkillCount: number;
  incomingGroupCount: number;
  incomingAgentStateCount: number;
  incomingTombstoneCount: number;
  conflicts: string[];
  expiresAt: string;
}

export interface SyncConnectionDto {
  repositoryDirectory: string;
  repositoryUrl: string;
}

export interface DeleteGroupPreviewDto {
  id: string;
  group: SkillGroup;
  affectedAgents: AgentKind[];
  affectedSkillCount: number;
  expiresAt: string;
}

export interface GitHubAuthorizationStartDto {
  id: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: string;
}

export type GitHubAuthorizationPollDto =
  | { status: 'pending'; nextPollAt: string }
  | { status: 'slow-down'; nextPollAt: string }
  | { status: 'denied' | 'expired' | 'authorized' };

export interface SyncPolicyChangePreviewDto {
  id: string;
  skill: ManagedSkill;
  nextPolicy: SyncPolicy;
  affectedSyncGroupIds: string[];
  historyWarning: boolean;
  expiresAt: string;
}

export interface AgentBatonApi {
  dashboard: {
    load(): Promise<DashboardSnapshot>;
  };
  library: {
    load(): Promise<LibrarySnapshot>;
  };
  settings: {
    chooseAndAddScanRoot(kind: 'custom' | 'project'): Promise<{ path: string; kind: 'custom' | 'project' } | null>;
    removeScanRoot(path: string): Promise<void>;
  };
  adoption: {
    chooseAndPreview(): Promise<AdoptionPreviewDto | null>;
    previewPath(path: string): Promise<AdoptionPreviewDto>;
    previewUpstream(repositoryUrl: string, relativePath: string): Promise<AdoptionPreviewDto>;
    confirm(input: {
      previewId: string;
      tags?: string[];
      userDescription?: string;
      syncPolicy?: SyncPolicy;
    }): Promise<ManagedSkill>;
  };
  skills: {
    previewDelete(skillId: string): Promise<DeleteManagedSkillPreviewDto>;
    confirmDelete(previewId: string): Promise<{ expiresAt: string }>;
    restore(skillId: string): Promise<void>;
    previewSyncPolicy(skillId: string, nextPolicy: SyncPolicy): Promise<SyncPolicyChangePreviewDto>;
    confirmSyncPolicy(previewId: string): Promise<ManagedSkill>;
    updateMetadata(skillId: string, input: { tags: string[]; userDescription: string }): Promise<ManagedSkill>;
  };
  upstream: {
    check(skillId: string): Promise<UpstreamStatusDto>;
    previewUpdate(skillId: string): Promise<UpstreamUpdatePreviewDto>;
    previewDiscardLocalForkAndUpdate(skillId: string): Promise<UpstreamUpdatePreviewDto>;
    confirmUpdate(previewId: string): Promise<{ backupDirectory: string }>;
  };
  diagnostics: {
    preview(): Promise<DiagnosticBundlePreviewDto>;
    chooseAndGenerate(): Promise<string | null>;
    recordLocalError(message: string): Promise<void>;
    listLocalErrors(): Promise<LocalErrorLogDto[]>;
    clearLocalErrors(): Promise<void>;
  };
  sync: {
    connection(): Promise<SyncConnectionDto | null>;
    clearConnection(): Promise<void>;
    chooseAndPreviewPush(): Promise<ManualSyncPreviewDto | null>;
    previewSavedPush(): Promise<ManualSyncPreviewDto>;
    confirmPush(previewId: string): Promise<{ commit: string }>;
    chooseAndPreviewRestore(): Promise<SyncRestorePreviewDto | null>;
    cloneAndPreviewRestore(repositoryUrl: string): Promise<SyncRestorePreviewDto | null>;
    confirmRestore(previewId: string): Promise<void>;
  };
  github: {
    startAuthorization(): Promise<GitHubAuthorizationStartDto>;
    pollAuthorization(id: string): Promise<GitHubAuthorizationPollDto>;
    isConnected(): Promise<boolean>;
    disconnect(): Promise<void>;
  };
  groups: {
    create(name: string): Promise<SkillGroup>;
    addSkill(groupId: string, skillId: string): Promise<SkillGroup>;
    removeSkill(groupId: string, skillId: string): Promise<SkillGroup>;
    rename(groupId: string, name: string): Promise<SkillGroup>;
    previewDelete(groupId: string): Promise<DeleteGroupPreviewDto>;
    confirmDelete(previewId: string): Promise<void>;
    setSyncParticipation(groupId: string, participatesInSync: boolean): Promise<SkillGroup>;
  };
  agents: {
    view(agent: AgentKind): Promise<AgentSkillViewDto>;
    setActiveGroups(agent: AgentKind, groupIds: string[]): Promise<DesiredAgentState>;
    setActiveGroupsForAgents(agents: AgentKind[], groupIds: string[]): Promise<DesiredAgentState[]>;
    setSkillOverride(agent: AgentKind, skillId: string, override: SkillOverride | null): Promise<DesiredAgentState>;
    verifyAfterRestart(agent: AgentKind): Promise<void>;
  };
  apply: {
    preview(agent: AgentKind): Promise<PreviewedApplyPlanDto>;
    confirm(planId: string): Promise<{ appliedOperationCount: number; backupReferences: string[] }>;
    previewBatch(agents: AgentKind[]): Promise<BatchApplyPreviewDto>;
    confirmBatch(previewId: string): Promise<BatchApplyResultDto>;
    previewUndo(agent: AgentKind): Promise<PreviewedApplyUndoDto>;
    confirmUndo(previewId: string): Promise<void>;
  };
}
import type {
  AgentKind,
  DesiredAgentState,
  ManagedSkill,
  SkillGroup,
  SkillOverride,
  SyncPolicy
} from './domain';
import type { ManagedInstallationPlan } from '../domain/managed-installation-plan';
