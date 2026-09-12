import { randomUUID } from 'node:crypto';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SyncRepository, type SyncRepositorySnapshot } from '../../sync/sync-repository';
import type { ManagedSkill } from '../../shared/domain';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';
import type { SyncMergeState } from '../../sync/three-way-merge';

const RESTORE_PREVIEW_TTL_MS = 15 * 60 * 1000;

export interface SyncRestorePreview {
  id: string;
  incomingSkillCount: number;
  incomingGroupCount: number;
  incomingAgentStateCount: number;
  incomingTombstoneCount: number;
  conflicts: string[];
  expiresAt: string;
}

interface PendingRestore extends SyncRestorePreview {
  snapshot: SyncRepositorySnapshot;
  connectionId: string;
}

/**
 * Restores a portable repository only after a preview confirmation. It writes
 * the managed library and desired state, never an Agent installation; an
 * Apply Plan remains a separate explicit step on the new device.
 */
export class SyncRestoreService {
  private readonly pending = new Map<string, PendingRestore>();

  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly managedLibrary: ManagedLibrary
  ) {}

  async preview(repository: SyncRepository, now = new Date()): Promise<SyncRestorePreview> {
    const snapshot = await repository.read();
    if (!snapshot) throw new Error('同步仓库中没有 AgentBaton 数据。');
    const conflicts = this.findConflicts(snapshot);
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + RESTORE_PREVIEW_TTL_MS).toISOString();
    const preview: PendingRestore = {
      id,
      incomingSkillCount: snapshot.skills.length,
      incomingGroupCount: snapshot.groups.length,
      incomingAgentStateCount: snapshot.agentStates.length,
      incomingTombstoneCount: snapshot.tombstones.length,
      conflicts,
      expiresAt,
      snapshot,
      connectionId: repository.rootDirectory()
    };
    this.pending.set(id, preview);
    this.removeExpired(now);
    return withoutSnapshot(preview);
  }

  async confirm(previewId: string, now = new Date()): Promise<void> {
    const pending = this.pending.get(previewId);
    if (!pending || new Date(pending.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new Error('同步恢复预览不存在或已过期，请重新预览。');
    }
    if (pending.conflicts.length > 0) {
      throw new Error('存在本地与远端冲突，必须先解决后才能恢复。');
    }
    this.pending.delete(previewId);
    const importedIds: string[] = [];
    try {
      const skills: ManagedSkill[] = [];
      for (const incoming of pending.snapshot.skills) {
        const adopted = await this.managedLibrary.adopt(incoming.metadata.id, incoming.contentDirectory);
        importedIds.push(incoming.metadata.id);
        skills.push({
          id: incoming.metadata.id,
          name: incoming.metadata.name,
          originalDescription: adopted.inspection.originalDescription,
          ...(incoming.metadata.userDescription ? { userDescription: incoming.metadata.userDescription } : {}),
          tags: incoming.metadata.tags,
          syncPolicy: 'sync-allowed',
          source: incoming.metadata.source
        });
      }
      this.saveImportedState(skills, pending.snapshot);
      this.stateStore.saveSyncBaseline(pending.connectionId, await mergeStateFromSnapshot(pending.snapshot));
    } catch (error) {
      await Promise.all(importedIds.reverse().map(async (skillId) => {
        try {
          await this.managedLibrary.trash(skillId, now);
        } catch {
          // Best effort: never hide the original import failure.
        }
      }));
      throw error;
    }
  }

  private saveImportedState(skills: readonly ManagedSkill[], snapshot: SyncRepositorySnapshot): void {
    // Collision checks happen in preview. Writing desired state here is local
    // intent only and deliberately does not create an Installation.
    for (const skill of skills) this.stateStore.saveSkill(skill);
    for (const group of snapshot.groups) this.stateStore.saveGroup(group);
    for (const state of snapshot.agentStates) this.stateStore.saveDesiredAgentState(state);
    for (const tombstone of snapshot.tombstones) {
      this.stateStore.saveSkillTombstone({ id: tombstone.id, deletedAt: tombstone.deletedAt, syncAllowed: true });
    }
  }

  private findConflicts(snapshot: SyncRepositorySnapshot): string[] {
    const localSkills = new Set(this.stateStore.listSkills().map((skill) => skill.id));
    const localGroups = new Set(this.stateStore.listGroups().map((group) => group.id));
    const localStates = new Set(this.stateStore.listDesiredAgentStates().map((state) => state.agent));
    const remoteSkills = new Set(snapshot.skills.map((skill) => skill.metadata.id));
    const conflicts = [
      ...snapshot.skills.filter((skill) => localSkills.has(skill.metadata.id)).map((skill) => `Skill ID 已存在：${skill.metadata.id}`),
      ...snapshot.groups.filter((group) => localGroups.has(group.id)).map((group) => `Skill Group ID 已存在：${group.id}`),
      ...snapshot.agentStates.filter((state) => localStates.has(state.agent)).map((state) => `Agent 期望状态已存在：${state.agent}`),
      ...snapshot.tombstones.filter((tombstone) => localSkills.has(tombstone.id) || remoteSkills.has(tombstone.id)).map((tombstone) => `删除墓碑与 Skill 同时存在：${tombstone.id}`)
    ];
    return conflicts.sort();
  }

  private removeExpired(now: Date): void {
    for (const [id, pending] of this.pending) {
      if (new Date(pending.expiresAt).getTime() <= now.getTime()) this.pending.delete(id);
    }
  }
}

function withoutSnapshot(pending: PendingRestore): SyncRestorePreview {
  const { snapshot: _snapshot, connectionId: _connectionId, ...preview } = pending;
  return preview;
}

async function mergeStateFromSnapshot(snapshot: SyncRepositorySnapshot): Promise<SyncMergeState> {
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
