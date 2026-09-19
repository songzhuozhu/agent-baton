import type { DashboardSnapshot } from '../shared/ipc';
import type { AgentAdapter, AgentAvailability } from './adapters/agent-adapter';
import { createBuiltInAgentAdapters } from './adapters/agent-registry';
import type { SkillControlService } from './application/skill-control-service';
import type { LocalStateStore } from './storage/local-state-store';

const DISPLAY_NAMES = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  trae: 'TRAE',
  opencode: 'OpenCode'
} as const;

export async function loadDashboard(
  adapters: readonly AgentAdapter[] = createBuiltInAgentAdapters(),
  skillControl?: SkillControlService,
  stateStore?: LocalStateStore
): Promise<DashboardSnapshot> {
  const observedInstallations = stateStore?.listObservedInstallations() ?? [];
  const agents = await Promise.all(
    adapters.map(async (adapter) => {
      const [detection, discovery] = await Promise.all([
        adapter.detect(),
        adapter.discoverUserSkills()
      ]);
      const currentEnabledCount = new Set(
        discovery.installations.map((installation) => installation.canonicalPath)
      ).size;
      const skillView = skillControl?.getAgentSkillView(adapter.agent);
      const hasExplicitDesiredState = skillControl?.hasExplicitDesiredState(adapter.agent) ?? false;
      const managedByPath = new Map(
        observedInstallations
          .filter((installation) => installation.agent === adapter.agent && installation.managed && installation.skillId)
          .map((installation) => [installation.path, installation])
      );
      const currentManagedIds = new Set<string>();
      const desiredPaths = new Set<string>();
      const discoveredManagedPaths = new Map<string, string>();
      for (const installation of discovery.installations) {
        const managed = managedByPath.get(installation.sourcePath);
        if (managed?.skillId) {
          if (managed.enabled) currentManagedIds.add(managed.skillId);
          discoveredManagedPaths.set(managed.skillId, installation.canonicalPath);
        } else {
          // External installations survive applying the managed selection.
          desiredPaths.add(installation.canonicalPath);
        }
      }
      const desiredIds = new Set(skillView?.effectiveSkillIds ?? []);
      for (const skillId of desiredIds) {
        desiredPaths.add(discoveredManagedPaths.get(skillId) ?? `managed:${skillId}`);
      }
      const hasPendingChanges = hasExplicitDesiredState && (
        currentManagedIds.size !== desiredIds.size ||
        [...desiredIds].some((skillId) => !currentManagedIds.has(skillId)) ||
        [...discoveredManagedPaths.keys()].some((skillId) => !desiredIds.has(skillId))
      );

      return {
        id: adapter.agent,
        name: DISPLAY_NAMES[adapter.agent],
        status: toDashboardStatus(detection.availability),
        currentEnabledCount,
        // Until the user has explicitly created a Desired Agent State, observed
        // state is the baseline; discovery alone must not create a pending apply.
        desiredEnabledCount: hasExplicitDesiredState
          ? desiredPaths.size
          : currentEnabledCount,
        hasPendingChanges,
        restartRequired: stateStore?.isAgentRestartRequired(adapter.agent) ?? false
      };
    })
  );

  return {
    pendingApplyCount: agents.filter(
      (agent) => agent.hasPendingChanges
    ).length,
    pendingSyncCount: 0,
    upstreamUpdateCount: 0,
    agents
  };
}

function toDashboardStatus(
  availability: AgentAvailability
): 'detected' | 'not-detected' | 'read-only' | 'unsupported-platform' {
  if (availability === 'unsupported-platform') {
    return 'unsupported-platform';
  }
  if (availability === 'read-only') {
    return 'read-only';
  }
  return availability;
}
