import { join } from 'node:path';
import { createBuiltInAgentAdapters } from '../adapters/agent-registry';
import { defaultManagedLibraryRoot, ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SkillControlService } from './skill-control-service';
import { ApplyPlanService } from './apply-plan-service';
import { AdoptionPreviewService } from './adoption-preview-service';
import { ManagedSkillDeletionService } from './managed-skill-deletion-service';
import { UpstreamUpdateService } from '../upstream/upstream-update-service';
import { GitUpstreamFetcher } from '../upstream/git-upstream-fetcher';
import { DiagnosticBundleService } from './diagnostic-bundle-service';
import { SyncExportService } from './sync-export-service';
import { SyncRestoreService } from './sync-restore-service';
import { ManualSyncService } from './manual-sync-service';
import { GroupDeletionService } from './group-deletion-service';
import { SyncPolicyChangeService } from './sync-policy-change-service';
import { safeStorage } from 'electron';
import { CredentialVault } from '../security/credential-vault';
import { GitHubDeviceFlow } from '../github/github-device-flow';
import { GitHubAuthorizationService } from '../github/github-authorization-service';
import { BatchApplyService } from './batch-apply-service';

export interface ApplicationRuntime {
  adapters: ReturnType<typeof createBuiltInAgentAdapters>;
  stateStore: LocalStateStore;
  skillControl: SkillControlService;
  applyPlans: ApplyPlanService;
  batchApplies: BatchApplyService;
  adoptions: AdoptionPreviewService;
  deletions: ManagedSkillDeletionService;
  upstreamUpdates: UpstreamUpdateService;
  diagnostics: DiagnosticBundleService;
  syncRestores: SyncRestoreService;
  manualSync: ManualSyncService;
  groupDeletions: GroupDeletionService;
  syncPolicyChanges: SyncPolicyChangeService;
  githubAuthorization: GitHubAuthorizationService;
  close(): void;
}

export function createApplicationRuntime(
  appDataDirectory: string,
  homeDirectory?: string
): ApplicationRuntime {
  const stateStore = new LocalStateStore(join(appDataDirectory, 'agent-baton.sqlite'));
  const managedLibrary = new ManagedLibrary(defaultManagedLibraryRoot(appDataDirectory));
  const adapters = createBuiltInAgentAdapters(homeDirectory);

  const skillControl = new SkillControlService(stateStore, managedLibrary);
  const syncExporter = new SyncExportService(stateStore, managedLibrary);
  const credentials = new CredentialVault(stateStore, safeStorage);
  const applyPlans = new ApplyPlanService(skillControl, stateStore, join(appDataDirectory, 'backups'));
  const githubAuthorization = new GitHubAuthorizationService(
    new GitHubDeviceFlow(process.env.AGENT_BATON_GITHUB_APP_CLIENT_ID),
    credentials
  );
  return {
    adapters,
    stateStore,
    skillControl,
    applyPlans,
    batchApplies: new BatchApplyService(applyPlans),
    adoptions: new AdoptionPreviewService(skillControl, new GitUpstreamFetcher(join(appDataDirectory, 'adoption-staging'))),
    deletions: new ManagedSkillDeletionService(stateStore, managedLibrary),
    upstreamUpdates: new UpstreamUpdateService(
      stateStore,
      managedLibrary,
      skillControl,
      new GitUpstreamFetcher(join(appDataDirectory, 'upstream-staging'))
    ),
    diagnostics: new DiagnosticBundleService(adapters, stateStore),
    syncRestores: new SyncRestoreService(stateStore, managedLibrary),
    manualSync: new ManualSyncService(syncExporter, githubAuthorization),
    groupDeletions: new GroupDeletionService(stateStore),
    syncPolicyChanges: new SyncPolicyChangeService(stateStore, skillControl),
    githubAuthorization,
    close: () => stateStore.close()
  };
}
