import type { AgentKind, CompatibilityStatus } from '../../shared/domain';
import type { InspectedSkillDirectory, RiskItem } from '../skills/skill-file-inspector';

export type AgentAvailability =
  | 'detected'
  | 'not-detected'
  | 'unsupported-platform'
  | 'read-only';

export interface AgentDetection {
  agent: AgentKind;
  availability: AgentAvailability;
  detail: string;
}

export interface DiscoveredSkillInstallation {
  agent: AgentKind;
  scope: 'user';
  sourcePath: string;
  canonicalPath: string;
  skillName: string;
  originalDescription: string;
  contentHash: string;
  risks: RiskItem[];
}

export interface DiscoveryIssue {
  sourcePath: string;
  detail: string;
}

export interface AgentDiscoveryResult {
  installations: DiscoveredSkillInstallation[];
  issues: DiscoveryIssue[];
}

export interface CompatibilityAssessment {
  status: CompatibilityStatus;
  detail: string;
}

export type AgentReloadBehavior = 'requires-restart' | 'hot-reload' | 'unknown';

/**
 * The shared seam for Agent-specific detection and read-only discovery. Writing
 * belongs to an Apply Plan and FileTransaction, never to discovery.
 */
export interface AgentAdapter {
  readonly agent: AgentKind;
  detect(): Promise<AgentDetection>;
  discoverUserSkills(): Promise<AgentDiscoveryResult>;
  assessSkill(): Promise<CompatibilityAssessment>;
  managedSkillRoot(): string | undefined;
  reloadBehavior?(): AgentReloadBehavior;
}

export function toDiscoveredInstallation(
  agent: AgentKind,
  inspected: InspectedSkillDirectory
): DiscoveredSkillInstallation {
  return {
    agent,
    scope: 'user',
    sourcePath: inspected.sourcePath,
    canonicalPath: inspected.canonicalPath,
    skillName: inspected.name,
    originalDescription: inspected.originalDescription,
    contentHash: inspected.contentHash,
    risks: inspected.risks
  };
}
