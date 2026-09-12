import { randomUUID } from 'node:crypto';
import type { AgentKind, ManagedSkill } from '../../shared/domain';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore, type SkillDeletionRecovery } from '../storage/local-state-store';

const DELETE_PREVIEW_TTL_MS = 15 * 60 * 1000;
const RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeleteManagedSkillPreview {
  id: string;
  skill: ManagedSkill;
  affectedGroupIds: string[];
  affectedOverrides: Array<{ agent: AgentKind; override: 'force-enable' | 'force-disable' }>;
  managedInstallationCount: number;
  expiresAt: string;
}

interface PendingDelete extends DeleteManagedSkillPreview {}

/**
 * Owns destructive library deletion. The preview is required, canonical
 * content first moves to a local 30-day trash, and the tombstone is portable
 * only when the deleted Skill was previously Sync Allowed.
 */
export class ManagedSkillDeletionService {
  private readonly pending = new Map<string, PendingDelete>();

  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly managedLibrary: ManagedLibrary
  ) {}

  preview(skillId: string, now = new Date()): DeleteManagedSkillPreview {
    const skill = this.requireSkill(skillId);
    const affectedGroupIds = this.stateStore.listGroups()
      .filter((group) => group.skillIds.includes(skillId))
      .map((group) => group.id)
      .sort();
    const affectedOverrides = this.stateStore.listDesiredAgentStates()
      .flatMap((state) => state.overrides[skillId]
        ? [{ agent: state.agent, override: state.overrides[skillId] }]
        : [])
      .sort((left, right) => left.agent.localeCompare(right.agent));
    const managedInstallationCount = this.stateStore.listObservedInstallations()
      .filter((installation) => installation.managed && installation.skillId === skillId)
      .length;
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + DELETE_PREVIEW_TTL_MS).toISOString();
    const preview = { id, skill, affectedGroupIds, affectedOverrides, managedInstallationCount, expiresAt };
    this.pending.set(id, preview);
    this.removeExpired(now);
    return preview;
  }

  async confirm(previewId: string, now = new Date()): Promise<{ expiresAt: string }> {
    const preview = this.pending.get(previewId);
    if (!preview || new Date(preview.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new Error('删除预览不存在或已过期，请重新预览。');
    }
    this.pending.delete(previewId);
    const trashed = await this.managedLibrary.trash(preview.skill.id, now);
    const expiresAt = new Date(now.getTime() + RECOVERY_WINDOW_MS).toISOString();
    const recovery: SkillDeletionRecovery = {
      skill: preview.skill,
      groupIds: preview.affectedGroupIds,
      overrides: preview.affectedOverrides,
      trashDirectory: trashed.trashDirectory,
      expiresAt
    };
    try {
      this.stateStore.deleteManagedSkillAndReferences(
        preview.skill.id,
        { id: preview.skill.id, deletedAt: trashed.trashedAt, syncAllowed: preview.skill.syncPolicy === 'sync-allowed' },
        recovery
      );
    } catch (error) {
      await this.managedLibrary.restore(preview.skill.id, trashed.trashDirectory);
      throw error;
    }
    return { expiresAt };
  }

  async restore(skillId: string, now = new Date()): Promise<void> {
    const recovery = this.stateStore.getSkillDeletionRecovery(skillId);
    if (!recovery) throw new Error('没有可恢复的删除记录。');
    if (new Date(recovery.expiresAt).getTime() <= now.getTime()) {
      throw new Error('该 Skill 的 30 天恢复期限已过。');
    }
    await this.managedLibrary.restore(skillId, recovery.trashDirectory);
    try {
      this.stateStore.restoreDeletedManagedSkill(skillId);
    } catch (error) {
      await this.managedLibrary.trash(skillId, now);
      throw error;
    }
  }

  private requireSkill(skillId: string): ManagedSkill {
    const skill = this.stateStore.listSkills().find((candidate) => candidate.id === skillId);
    if (!skill) throw new Error(`未找到托管 Skill：${skillId}`);
    return skill;
  }

  private removeExpired(now: Date): void {
    for (const [id, preview] of this.pending) {
      if (new Date(preview.expiresAt).getTime() <= now.getTime()) this.pending.delete(id);
    }
  }
}
