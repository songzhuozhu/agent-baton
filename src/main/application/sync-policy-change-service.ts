import { randomUUID } from 'node:crypto';
import type { ManagedSkill, SyncPolicy } from '../../shared/domain';
import { LocalStateStore } from '../storage/local-state-store';
import { SkillControlService } from './skill-control-service';

const POLICY_PREVIEW_TTL_MS = 15 * 60 * 1_000;

export interface SyncPolicyChangePreview {
  id: string;
  skill: ManagedSkill;
  nextPolicy: SyncPolicy;
  affectedSyncGroupIds: string[];
  historyWarning: boolean;
  expiresAt: string;
}

/** Explicit confirmation is required before revoking portability. */
export class SyncPolicyChangeService {
  private readonly pending = new Map<string, SyncPolicyChangePreview>();

  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly skillControl: SkillControlService
  ) {}

  preview(skillId: string, nextPolicy: SyncPolicy, now = new Date()): SyncPolicyChangePreview {
    const skill = this.stateStore.listSkills().find((candidate) => candidate.id === skillId);
    if (!skill) throw new Error(`未找到托管 Skill：${skillId}`);
    const preview: SyncPolicyChangePreview = {
      id: randomUUID(),
      skill,
      nextPolicy,
      affectedSyncGroupIds: this.stateStore.listGroups()
        .filter((group) => group.participatesInSync && group.skillIds.includes(skillId))
        .map((group) => group.id)
        .sort(),
      historyWarning: skill.syncPolicy === 'sync-allowed' && nextPolicy === 'local-only',
      expiresAt: new Date(now.getTime() + POLICY_PREVIEW_TTL_MS).toISOString()
    };
    this.pending.set(preview.id, preview);
    this.removeExpired(now);
    return preview;
  }

  confirm(previewId: string, now = new Date()): ManagedSkill {
    const preview = this.pending.get(previewId);
    if (!preview || new Date(preview.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new Error('同步策略预览不存在或已过期，请重新预览。');
    }
    this.pending.delete(previewId);
    return this.skillControl.updateSkillMetadata(preview.skill.id, { syncPolicy: preview.nextPolicy });
  }

  private removeExpired(now: Date): void {
    for (const [id, preview] of this.pending) {
      if (new Date(preview.expiresAt).getTime() <= now.getTime()) this.pending.delete(id);
    }
  }
}
