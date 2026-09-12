import { randomUUID } from 'node:crypto';
import { GitWorktree, isGitHubHttpsRepositoryUrl, type GitCommandEnvironment, type GitRemoteRelation } from '../git/git-worktree';
import { SyncRepository } from '../../sync/sync-repository';
import { SyncExportService, type SyncExportPreview } from './sync-export-service';
import { deterministicJson } from '../../sync/sync-repository';
import { mergeSyncStates, type SyncConflict, type SyncMergeState } from '../../sync/three-way-merge';

const SYNC_PREVIEW_TTL_MS = 15 * 60 * 1_000;

export interface ManualSyncPreview {
  id: string;
  createdAt: string;
  expiresAt: string;
  portableSkillCount: number;
  localOnlySkillCount: number;
  groupCount: number;
  desiredAgentStateCount: number;
  tombstoneCount: number;
  remoteRelation: GitRemoteRelation;
  existingPortableChanges: string[];
  reconciliationRequired: boolean;
  conflicts: string[];
}

/** Provides one-process Git credentials without exposing secrets to IPC. */
export interface GitTransportEnvironmentProvider {
  gitEnvironment(): GitCommandEnvironment;
}

interface PendingManualSync extends ManualSyncPreview {
  repository: SyncRepository;
  worktree: GitWorktree;
  mergeState: SyncMergeState;
}

/**
 * User-triggered push boundary. It has no background commit/push behavior:
 * first fetch and preview, then write the portable tree, commit and push only
 * after the user confirms the short-lived plan.
 */
export class ManualSyncService {
  private readonly pending = new Map<string, PendingManualSync>();

  constructor(
    private readonly exporter: SyncExportService,
    private readonly transport?: GitTransportEnvironmentProvider
  ) {}

  async preview(repositoryDirectory: string, now = new Date()): Promise<ManualSyncPreview> {
    const preflightWorktree = new GitWorktree(repositoryDirectory);
    const originUrl = await preflightWorktree.originUrl();
    if (this.transport && !isGitHubHttpsRepositoryUrl(originUrl)) {
      throw new Error('GitHub App 同步只允许 HTTPS github.com 的专用同步仓库，凭据不会发送到其他远端。');
    }
    const worktree = new GitWorktree(repositoryDirectory, undefined, this.transport?.gitEnvironment());
    await worktree.fetch();
    const [status, remoteRelation, exportPreview] = await Promise.all([
      worktree.status(),
      worktree.remoteRelation(),
      this.exporter.preview()
    ]);
    const repository = new SyncRepository(repositoryDirectory);
    const remoteSnapshot = await repository.read();
    const remoteMergeState = remoteSnapshot
      ? await this.exporter.mergeStateFromRepositorySnapshot(remoteSnapshot)
      : emptyMergeState();
    const baseMergeState = this.exporter.getSyncBaseline(repository.rootDirectory());
    const merge = mergeSyncStates(baseMergeState ?? emptyMergeState(), exportPreview.mergeState, remoteMergeState);
    const hasUntrackedRemoteState = !baseMergeState && !sameMergeState(remoteMergeState, emptyMergeState());
    const reconciliationRequired = status.changedPortablePaths.length > 0
      || remoteRelation !== 'up-to-date'
      || merge.conflicts.length > 0
      || hasUntrackedRemoteState
      || (!sameMergeState(merge.merged, exportPreview.mergeState) && !sameMergeState(remoteMergeState, emptyMergeState()));
    const id = randomUUID();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + SYNC_PREVIEW_TTL_MS).toISOString();
    const pending: PendingManualSync = {
      ...toPreview(id, createdAt, expiresAt, exportPreview, remoteRelation, status.changedPortablePaths, reconciliationRequired, merge.conflicts),
      repository,
      worktree,
      mergeState: exportPreview.mergeState
    };
    this.pending.set(id, pending);
    this.removeExpired(now);
    return withoutInternals(pending);
  }

  async confirm(previewId: string, now = new Date()): Promise<{ commit: string }> {
    const pending = this.pending.get(previewId);
    if (!pending || new Date(pending.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new Error('同步预览不存在或已过期，请重新预览。');
    }
    if (pending.reconciliationRequired) {
      throw new Error('同步预览发现未协调的 Git 或跨设备状态，必须先解决后才能推送。');
    }
    if (pending.remoteRelation === 'no-upstream') {
      throw new Error('当前同步仓库没有上游远端，不能安全推送。');
    }
    this.pending.delete(previewId);
    const relationNow = await pending.worktree.remoteRelation();
    if (relationNow !== 'up-to-date') {
      throw new Error('预览后远端状态发生变化，请重新预览同步。');
    }
    await this.exporter.write(pending.repository);
    const commit = await pending.worktree.commitPortableChanges('sync: update AgentBaton state');
    if (!commit) throw new Error('同步快照没有可提交的变更。');
    await pending.worktree.pushHead();
    this.exporter.recordSyncBaseline(pending.repository.rootDirectory(), pending.mergeState);
    return { commit };
  }

  private removeExpired(now: Date): void {
    for (const [id, pending] of this.pending) {
      if (new Date(pending.expiresAt).getTime() <= now.getTime()) this.pending.delete(id);
    }
  }
}

function toPreview(
  id: string,
  createdAt: string,
  expiresAt: string,
  exportPreview: SyncExportPreview,
  remoteRelation: GitRemoteRelation,
  existingPortableChanges: string[],
  reconciliationRequired: boolean,
  conflicts: readonly SyncConflict[]
): ManualSyncPreview {
  return {
    id,
    createdAt,
    expiresAt,
    portableSkillCount: exportPreview.portableSkillCount,
    localOnlySkillCount: exportPreview.localOnlySkillCount,
    groupCount: exportPreview.groupCount,
    desiredAgentStateCount: exportPreview.desiredAgentStateCount,
    tombstoneCount: exportPreview.tombstoneCount,
    remoteRelation,
    existingPortableChanges,
    reconciliationRequired,
    conflicts: conflicts.map(describeConflict)
  };
}

function emptyMergeState(): SyncMergeState {
  return { skills: [], groups: [], agentStates: [], tombstones: [] };
}

function sameMergeState(left: SyncMergeState, right: SyncMergeState): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function describeConflict(conflict: SyncConflict): string {
  if (conflict.kind === 'field') return `${conflict.entity} ${conflict.id} 的 ${conflict.field} 字段同时被修改`;
  if (conflict.kind === 'content') return `Skill ${conflict.id} 的内容同时被修改`;
  if (conflict.kind === 'delete-vs-change') return `${conflict.entity} ${conflict.id} 存在删除与修改冲突`;
  return `Skill ${conflict.id} 的删除墓碑与内容同时存在`;
}

function withoutInternals(pending: PendingManualSync): ManualSyncPreview {
  const { repository: _repository, worktree: _worktree, mergeState: _mergeState, ...preview } = pending;
  return preview;
}
