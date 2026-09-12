import { selectPortableSnapshot } from '../../domain/sync-selection';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SyncRepository, type SyncRepositorySnapshot } from '../../sync/sync-repository';
import type { SyncMergeState } from '../../sync/three-way-merge';

export interface SyncExportPreview {
  portableSkillCount: number;
  localOnlySkillCount: number;
  groupCount: number;
  desiredAgentStateCount: number;
  tombstoneCount: number;
  mergeState: SyncMergeState;
}

/**
 * Converts owned local state to an explicitly portable snapshot. It never
 * calls Git and never emits Local Only content; the caller owns remote intent
 * and confirmation.
 */
export class SyncExportService {
  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly managedLibrary: ManagedLibrary
  ) {}

  async preview(): Promise<SyncExportPreview> {
    const skills = this.stateStore.listSkills();
    const snapshot = selectPortableSnapshot({
      skills,
      groups: this.stateStore.listGroups(),
      desiredStates: this.stateStore.listDesiredAgentStates()
    });
    const mergeState = await this.toMergeState(snapshot);
    return {
      portableSkillCount: snapshot.skills.length,
      localOnlySkillCount: skills.filter((skill) => skill.syncPolicy === 'local-only').length,
      groupCount: snapshot.groups.length,
      desiredAgentStateCount: snapshot.agentStates.length,
      tombstoneCount: this.portableTombstones().length,
      mergeState
    };
  }

  async write(repository: SyncRepository): Promise<SyncRepositorySnapshot> {
    const skills = this.stateStore.listSkills();
    const snapshot = selectPortableSnapshot({
      skills,
      groups: this.stateStore.listGroups(),
      desiredStates: this.stateStore.listDesiredAgentStates()
    });
    await repository.write({
      snapshot,
      tombstones: this.portableTombstones(),
      copyContent: (skillId, targetDirectory) => this.managedLibrary.exportContent(skillId, targetDirectory)
    });
    return (await repository.read())!;
  }

  recordSyncBaseline(connectionId: string, mergeState: SyncMergeState): void {
    this.stateStore.saveSyncBaseline(connectionId, mergeState);
  }

  getSyncBaseline(connectionId: string): SyncMergeState | undefined {
    return this.stateStore.getSyncBaseline(connectionId);
  }

  /** Builds the same hash-only view for an already checked-out remote tree. */
  async mergeStateFromRepositorySnapshot(snapshot: SyncRepositorySnapshot): Promise<SyncMergeState> {
    const skills = await Promise.all(snapshot.skills.map(async (skill) => ({
      metadata: skill.metadata,
      contentHash: (await inspectSkillDirectory(skill.contentDirectory)).contentHash
    })));
    return {
      skills: skills.sort((left, right) => left.metadata.id.localeCompare(right.metadata.id)),
      groups: [...snapshot.groups].sort((left, right) => left.id.localeCompare(right.id)),
      agentStates: [...snapshot.agentStates].sort((left, right) => left.agent.localeCompare(right.agent)),
      tombstones: [...snapshot.tombstones].sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  private async toMergeState(snapshot: ReturnType<typeof selectPortableSnapshot>): Promise<SyncMergeState> {
    const skills = await Promise.all(snapshot.skills.map(async ({ skill }) => {
      const inspection = await inspectSkillDirectory(this.managedLibrary.contentDirectory(skill.id));
      return {
        metadata: {
          id: skill.id,
          schemaVersion: 1 as const,
          name: skill.name,
          ...(skill.userDescription ? { userDescription: skill.userDescription } : {}),
          tags: [...new Set(skill.tags)].sort(),
          syncPolicy: 'sync-allowed' as const,
          source: skill.source
        },
        contentHash: inspection.contentHash
      };
    }));
    return {
      skills: skills.sort((left, right) => left.metadata.id.localeCompare(right.metadata.id)),
      groups: snapshot.groups.map(({ group }) => group),
      agentStates: snapshot.agentStates.map(({ state }) => state),
      tombstones: this.portableTombstones()
    };
  }

  private portableTombstones() {
    return this.stateStore.listSkillTombstones()
      .filter((tombstone) => tombstone.syncAllowed)
      .map((tombstone) => ({
        entity: 'skill' as const,
        id: tombstone.id,
        schemaVersion: 1 as const,
        deletedAt: tombstone.deletedAt
      }));
  }
}
