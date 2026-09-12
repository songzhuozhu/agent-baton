import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ManagedInstallationPlan } from '../../domain/managed-installation-plan';
import type { AgentKind } from '../../shared/domain';
import type { AgentAdapter } from '../adapters/agent-adapter';
import { ManagedInstallationDeployer } from '../deployment/managed-installation-deployer';
import { LocalStateStore } from '../storage/local-state-store';
import { ManagedInstallationApplyService, type ManagedInstallationApplyResult } from './managed-installation-apply-service';
import { SkillControlService } from './skill-control-service';
import type { ApplyRecord } from '../storage/local-state-store';

const PLAN_TTL_MS = 15 * 60 * 1000;

export class ApplyPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyPlanError';
  }
}

export interface PreviewedApplyPlan {
  id: string;
  createdAt: string;
  expiresAt: string;
  plan: ManagedInstallationPlan;
}

export interface PreviewedApplyUndo {
  id: string;
  agent: AgentKind;
  createdAt: string;
  expiresAt: string;
  operationCount: number;
  summary: string;
}

interface PendingApplyPlan extends PreviewedApplyPlan {
  adapter: AgentAdapter;
}

interface PendingApplyUndo extends PreviewedApplyUndo {
  adapter: AgentAdapter;
  record: ApplyRecord;
}

/**
 * Owns the confirmation seam. A filesystem write is impossible without a
 * previously created, non-expired preview ID.
 */
export class ApplyPlanService {
  private readonly pendingPlans = new Map<string, PendingApplyPlan>();
  private readonly pendingUndos = new Map<string, PendingApplyUndo>();

  constructor(
    private readonly skillControl: SkillControlService,
    private readonly stateStore: LocalStateStore,
    private readonly backupRoot: string
  ) {}

  async preview(adapter: AgentAdapter, now = new Date()): Promise<PreviewedApplyPlan> {
    const plan = await this.skillControl.previewManagedInstallationPlan(adapter);
    const id = randomUUID();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + PLAN_TTL_MS).toISOString();
    const pending: PendingApplyPlan = { id, createdAt, expiresAt, plan, adapter };
    this.pendingPlans.set(id, pending);
    this.removeExpiredPlans(now);
    return { id, createdAt, expiresAt, plan };
  }

  async confirm(planId: string, now = new Date()): Promise<ManagedInstallationApplyResult> {
    const pending = this.pendingPlans.get(planId);
    if (!pending) {
      throw new ApplyPlanError('Apply Plan 不存在或已被使用，请重新预览。');
    }
    if (new Date(pending.expiresAt).getTime() <= now.getTime()) {
      this.pendingPlans.delete(planId);
      throw new ApplyPlanError('Apply Plan 已过期，请重新预览。');
    }

    const targetRoot = pending.adapter.managedSkillRoot();
    if (!targetRoot) {
      throw new ApplyPlanError(`${pending.adapter.agent} 没有可安全写入的用户级 Skill 根目录。`);
    }

    // Consume before writing so the same confirmation cannot run twice. A
    // failed write is recoverable through the transaction backup and needs a
    // fresh preview because the filesystem state may have changed.
    this.pendingPlans.delete(planId);
    const deployer = new ManagedInstallationDeployer(
      join(this.backupRoot, pending.plan.agent),
      [targetRoot]
    );
    const applyService = new ManagedInstallationApplyService(this.stateStore, deployer);
    const result = await applyService.apply(pending.plan);
    if (pending.plan.operations.length > 0 && (pending.adapter.reloadBehavior?.() ?? 'requires-restart') !== 'hot-reload') {
      this.stateStore.setAgentRestartRequired(pending.plan.agent, true);
    }
    return result;
  }

  async verifyAfterManualRestart(adapter: AgentAdapter): Promise<void> {
    const rechecked = await this.skillControl.previewManagedInstallationPlan(adapter);
    if (rechecked.operations.length > 0) {
      throw new ApplyPlanError('重新扫描后仍存在待应用变更，不能确认 Agent 已加载最新状态。');
    }
    this.stateStore.setAgentRestartRequired(adapter.agent, false);
  }

  async previewUndo(adapter: AgentAdapter, now = new Date()): Promise<PreviewedApplyUndo> {
    const record = this.stateStore.getLatestUndoableApply(adapter.agent);
    if (!record) throw new ApplyPlanError('没有可撤销的最近一次成功应用。');
    const targetRoot = adapter.managedSkillRoot();
    if (!targetRoot) throw new ApplyPlanError(`${adapter.agent} 没有可安全写入的用户级 Skill 根目录。`);
    const deployer = new ManagedInstallationDeployer(join(this.backupRoot, adapter.agent), [targetRoot]);
    await Promise.all(record.changes.map(async (change) => {
      if (change.kind === 'deploy') {
        await deployer.assertCanUndoDeployment(change);
      } else {
        await deployer.assertCanUndoRemoval(change.targetDirectory, change.backupDirectory);
      }
    }));
    const id = randomUUID();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + PLAN_TTL_MS).toISOString();
    const pending: PendingApplyUndo = {
      id,
      agent: adapter.agent,
      createdAt,
      expiresAt,
      operationCount: record.changes.length,
      summary: record.summary,
      adapter,
      record
    };
    this.pendingUndos.set(id, pending);
    this.removeExpiredPlans(now);
    return withoutUndoInternals(pending);
  }

  async confirmUndo(previewId: string, now = new Date()): Promise<void> {
    const pending = this.pendingUndos.get(previewId);
    if (!pending || new Date(pending.expiresAt).getTime() <= now.getTime()) {
      this.pendingUndos.delete(previewId);
      throw new ApplyPlanError('撤销预览不存在或已过期，请重新预览。');
    }
    const targetRoot = pending.adapter.managedSkillRoot();
    if (!targetRoot) throw new ApplyPlanError(`${pending.adapter.agent} 没有可安全写入的用户级 Skill 根目录。`);
    const deployer = new ManagedInstallationDeployer(join(this.backupRoot, pending.adapter.agent), [targetRoot]);
    // Recheck every target before the first write. A user edit or an expired
    // backup makes the whole undo fail before touching any Installation.
    await Promise.all(pending.record.changes.map(async (change) => {
      if (change.kind === 'deploy') {
        await deployer.assertCanUndoDeployment(change);
      } else {
        await deployer.assertCanUndoRemoval(change.targetDirectory, change.backupDirectory);
      }
    }));
    this.pendingUndos.delete(previewId);
    for (const change of [...pending.record.changes].reverse()) {
      if (change.kind === 'deploy') {
        await deployer.undoDeployment(change);
      } else {
        await deployer.undoRemoval(change.targetDirectory, change.backupDirectory);
      }
    }
    const installationPathsToDelete = pending.record.changes
      .filter((change): change is Extract<typeof change, { kind: 'deploy' }> => change.kind === 'deploy')
      .map((change) => change.resultingInstallation.path);
    const installationsToSave = pending.record.changes
      .flatMap((change) => change.previousInstallation ? [change.previousInstallation] : []);
    this.stateStore.commitAgentUndo(
      pending.record.id,
      pending.agent,
      installationPathsToDelete,
      installationsToSave,
      now.toISOString()
    );
    if (pending.record.changes.length > 0 && (pending.adapter.reloadBehavior?.() ?? 'requires-restart') !== 'hot-reload') {
      this.stateStore.setAgentRestartRequired(pending.agent, true);
    }
  }

  hasPendingPlanFor(agent: AgentKind): boolean {
    this.removeExpiredPlans(new Date());
    return [...this.pendingPlans.values()].some((pending) => pending.plan.agent === agent);
  }

  private removeExpiredPlans(now: Date): void {
    for (const [id, pending] of this.pendingPlans) {
      if (new Date(pending.expiresAt).getTime() <= now.getTime()) {
        this.pendingPlans.delete(id);
      }
    }
    for (const [id, pending] of this.pendingUndos) {
      if (new Date(pending.expiresAt).getTime() <= now.getTime()) this.pendingUndos.delete(id);
    }
  }
}

function withoutUndoInternals(pending: PendingApplyUndo): PreviewedApplyUndo {
  const { adapter: _adapter, record: _record, ...preview } = pending;
  return preview;
}
