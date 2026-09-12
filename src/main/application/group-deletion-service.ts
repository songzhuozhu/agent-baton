import { randomUUID } from 'node:crypto';
import type { SkillGroup } from '../../shared/domain';
import { LocalStateStore } from '../storage/local-state-store';

const DELETE_GROUP_PREVIEW_TTL_MS = 15 * 60 * 1_000;

export interface DeleteGroupPreview {
  id: string;
  group: SkillGroup;
  affectedAgents: string[];
  affectedSkillCount: number;
  expiresAt: string;
}

/** A confirmation seam for group deletion and Desired State cleanup. */
export class GroupDeletionService {
  private readonly pending = new Map<string, DeleteGroupPreview>();

  constructor(private readonly stateStore: LocalStateStore) {}

  preview(groupId: string, now = new Date()): DeleteGroupPreview {
    const group = this.stateStore.listGroups().find((candidate) => candidate.id === groupId);
    if (!group) throw new Error(`未找到 Skill Group：${groupId}`);
    const preview: DeleteGroupPreview = {
      id: randomUUID(),
      group,
      affectedAgents: this.stateStore.listDesiredAgentStates()
        .filter((state) => state.activeGroupIds.includes(groupId))
        .map((state) => state.agent)
        .sort(),
      affectedSkillCount: group.skillIds.length,
      expiresAt: new Date(now.getTime() + DELETE_GROUP_PREVIEW_TTL_MS).toISOString()
    };
    this.pending.set(preview.id, preview);
    this.removeExpired(now);
    return preview;
  }

  confirm(previewId: string, now = new Date()): void {
    const preview = this.pending.get(previewId);
    if (!preview || new Date(preview.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new Error('删除分组预览不存在或已过期，请重新预览。');
    }
    this.pending.delete(previewId);
    this.stateStore.deleteGroupAndReferences(preview.group.id);
  }

  private removeExpired(now: Date): void {
    for (const [id, preview] of this.pending) {
      if (new Date(preview.expiresAt).getTime() <= now.getTime()) this.pending.delete(id);
    }
  }
}
