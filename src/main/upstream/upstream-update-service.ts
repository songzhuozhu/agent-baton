import { randomUUID } from 'node:crypto';
import type { UpstreamSkillSource } from '../../shared/domain';
import { inspectSkillDirectory, type SkillFileManifestEntry } from '../skills/skill-file-inspector';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SkillControlService } from '../application/skill-control-service';

const UPSTREAM_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const UPDATE_PREVIEW_TTL_MS = 15 * 60 * 1_000;

export interface StagedUpstreamCandidate {
  commit: string;
  skillDirectory: string;
  cleanup(): Promise<void>;
}

export interface UpstreamFetcher {
  resolveHead(repositoryUrl: string): Promise<string>;
  stage(source: UpstreamSkillSource): Promise<StagedUpstreamCandidate>;
}

export type UpstreamStatus =
  | { kind: 'not-upstream' }
  | { kind: 'current'; checkedAt: string }
  | { kind: 'update-available'; checkedAt: string; remoteCommit: string }
  | { kind: 'forked'; checkedAt: string }
  | { kind: 'unavailable'; checkedAt: string; detail: string };

export interface UpstreamUpdatePreview {
  id: string;
  skillId: string;
  remoteCommit: string;
  changedFiles: Array<{ path: string; change: 'added' | 'removed' | 'modified' }>;
  risks: number;
  discardLocalFork: boolean;
  expiresAt: string;
}

interface PendingUpdate extends UpstreamUpdatePreview {
  candidate: StagedUpstreamCandidate;
  expectedLocalHash: string;
}

/**
 * Checks updates without changing owned data, stages a candidate in isolation,
 * and refuses to overwrite a locally forked Skill. Deployment remains a later
 * Apply Plan after the user accepts the update.
 */
export class UpstreamUpdateService {
  private readonly pending = new Map<string, PendingUpdate>();

  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly managedLibrary: ManagedLibrary,
    private readonly skillControl: SkillControlService,
    private readonly fetcher: UpstreamFetcher
  ) {}

  async check(skillId: string, now = new Date()): Promise<UpstreamStatus> {
    const skill = this.requireSkill(skillId);
    if (skill.source.kind !== 'upstream') return { kind: 'not-upstream' };
    const checkedAt = now.toISOString();
    const current = await inspectSkillDirectory(this.managedLibrary.contentDirectory(skillId));
    if (current.contentHash !== skill.source.contentHash) {
      this.saveCheck(skillId, checkedAt);
      return { kind: 'forked', checkedAt };
    }
    try {
      const remoteCommit = await this.fetcher.resolveHead(skill.source.repositoryUrl);
      this.saveCheck(skillId, checkedAt);
      return remoteCommit === skill.source.baselineCommit
        ? { kind: 'current', checkedAt }
        : { kind: 'update-available', checkedAt, remoteCommit };
    } catch (error) {
      this.saveCheck(skillId, checkedAt);
      return { kind: 'unavailable', checkedAt, detail: toMessage(error) };
    }
  }

  async checkEligible(now = new Date(), manual = false): Promise<Array<{ skillId: string; status: UpstreamStatus }>> {
    const results: Array<{ skillId: string; status: UpstreamStatus }> = [];
    for (const skill of this.stateStore.listSkills().filter((skill) => skill.source.kind === 'upstream')) {
      const lastCheckedAt = this.stateStore.getLocalSetting(this.checkKey(skill.id));
      if (!manual && lastCheckedAt && now.getTime() - new Date(lastCheckedAt).getTime() < UPSTREAM_CHECK_INTERVAL_MS) continue;
      results.push({ skillId: skill.id, status: await this.check(skill.id, now) });
    }
    return results;
  }

  async previewUpdate(skillId: string, now = new Date()): Promise<UpstreamUpdatePreview> {
    return this.previewUpdateInternal(skillId, false, now);
  }

  /**
   * An explicit recovery path for a local fork. The current canonical content
   * is still backed up on confirmation; this method never discards it during
   * checking or previewing.
   */
  async previewDiscardLocalForkAndUpdate(skillId: string, now = new Date()): Promise<UpstreamUpdatePreview> {
    return this.previewUpdateInternal(skillId, true, now);
  }

  private async previewUpdateInternal(
    skillId: string,
    discardLocalFork: boolean,
    now: Date
  ): Promise<UpstreamUpdatePreview> {
    const skill = this.requireSkill(skillId);
    if (skill.source.kind !== 'upstream') throw new Error('该 Skill 没有上游来源。');
    const current = await inspectSkillDirectory(this.managedLibrary.contentDirectory(skillId));
    if (current.contentHash !== skill.source.contentHash && !discardLocalFork) {
      throw new Error('该 Skill 已分叉：本地内容不同于上游基线，不能直接更新。');
    }
    const candidate = await this.fetcher.stage(skill.source);
    try {
      const inspectedCandidate = await inspectSkillDirectory(candidate.skillDirectory);
      const preview: PendingUpdate = {
        id: randomUUID(),
        skillId,
        remoteCommit: candidate.commit,
        changedFiles: diffFiles(current.files, inspectedCandidate.files),
        risks: inspectedCandidate.risks.length,
        discardLocalFork,
        expiresAt: new Date(now.getTime() + UPDATE_PREVIEW_TTL_MS).toISOString(),
        candidate,
        expectedLocalHash: current.contentHash
      };
      this.pending.set(preview.id, preview);
      await this.removeExpired(now);
      return withoutCandidate(preview);
    } catch (error) {
      await candidate.cleanup();
      throw error;
    }
  }

  async confirmUpdate(previewId: string, now = new Date()): Promise<{ backupDirectory: string }> {
    const pending = this.pending.get(previewId);
    if (!pending || new Date(pending.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new Error('上游更新预览不存在或已过期，请重新预览。');
    }
    this.pending.delete(previewId);
    try {
      const skill = this.requireSkill(pending.skillId);
      if (skill.source.kind !== 'upstream') throw new Error('该 Skill 的上游来源已被修改，请重新预览。');
      const current = await inspectSkillDirectory(this.managedLibrary.contentDirectory(skill.id));
      if (current.contentHash !== pending.expectedLocalHash) {
        throw new Error('预览后本地 Skill 已变化，安全中止上游更新。');
      }
      const replacement = await this.managedLibrary.replaceContent(skill.id, pending.candidate.skillDirectory, now);
      this.skillControl.applyConfirmedUpstreamUpdate(skill.id, replacement.inspection.originalDescription, {
        ...skill.source,
        baselineCommit: pending.candidate.commit,
        contentHash: replacement.inspection.contentHash
      });
      return { backupDirectory: replacement.backupDirectory };
    } finally {
      await pending.candidate.cleanup();
    }
  }

  private requireSkill(skillId: string) {
    const skill = this.stateStore.listSkills().find((candidate) => candidate.id === skillId);
    if (!skill) throw new Error(`未找到托管 Skill：${skillId}`);
    return skill;
  }

  private saveCheck(skillId: string, checkedAt: string): void {
    this.stateStore.saveLocalSetting(this.checkKey(skillId), checkedAt);
  }

  private checkKey(skillId: string): string {
    return `upstream:last-check:${skillId}`;
  }

  private async removeExpired(now: Date): Promise<void> {
    for (const [id, pending] of this.pending) {
      if (new Date(pending.expiresAt).getTime() <= now.getTime()) {
        this.pending.delete(id);
        await pending.candidate.cleanup();
      }
    }
  }
}

function diffFiles(
  currentFiles: readonly SkillFileManifestEntry[],
  candidateFiles: readonly SkillFileManifestEntry[]
): Array<{ path: string; change: 'added' | 'removed' | 'modified' }> {
  const currentByPath = new Map(currentFiles.map((file) => [file.relativePath, file]));
  const candidateByPath = new Map(candidateFiles.map((file) => [file.relativePath, file]));
  return [...new Set([...currentByPath.keys(), ...candidateByPath.keys()])]
    .sort()
    .flatMap<{ path: string; change: 'added' | 'removed' | 'modified' }>((path) => {
      const current = currentByPath.get(path);
      const candidate = candidateByPath.get(path);
      if (!current) return [{ path, change: 'added' as const }];
      if (!candidate) return [{ path, change: 'removed' as const }];
      return current.contentHash !== candidate.contentHash || current.kind !== candidate.kind
        ? [{ path, change: 'modified' as const }]
        : [];
    });
}

function withoutCandidate(pending: PendingUpdate): UpstreamUpdatePreview {
  const { candidate: _candidate, expectedLocalHash: _expectedLocalHash, ...preview } = pending;
  return preview;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
