import type { AgentAdapter } from '../adapters/agent-adapter';
import type { AgentKind } from '../../shared/domain';
import { ApplyPlanService, type PreviewedApplyPlan } from './apply-plan-service';
import { randomUUID } from 'node:crypto';

const BATCH_PREVIEW_TTL_MS = 15 * 60 * 1_000;

export interface BatchApplyPreview {
  id: string;
  createdAt: string;
  expiresAt: string;
  plans: PreviewedApplyPlan[];
  failures: Array<{ agent: AgentKind; detail: string }>;
}

export interface BatchApplyResult {
  results: Array<
    | { agent: AgentKind; status: 'succeeded'; appliedOperationCount: number }
    | { agent: AgentKind; status: 'failed'; detail: string }
  >;
}

/**
 * Coordinates several independently atomic Agent applies. It deliberately
 * does not roll back another Agent after one fails; each outcome is reported
 * for an explicit user retry.
 */
export class BatchApplyService {
  private readonly pending = new Map<string, BatchApplyPreview>();

  constructor(private readonly applyPlans: ApplyPlanService) {}

  async preview(adapters: readonly AgentAdapter[], now = new Date()): Promise<BatchApplyPreview> {
    const settled = await Promise.all(adapters.map(async (adapter) => {
      try {
        return { kind: 'plan' as const, plan: await this.applyPlans.preview(adapter) };
      } catch (error) {
        return { kind: 'failure' as const, agent: adapter.agent, detail: toMessage(error) };
      }
    }));
    const preview: BatchApplyPreview = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + BATCH_PREVIEW_TTL_MS).toISOString(),
      plans: settled.filter((item): item is { kind: 'plan'; plan: PreviewedApplyPlan } => item.kind === 'plan').map((item) => item.plan),
      failures: settled.filter((item): item is { kind: 'failure'; agent: AgentKind; detail: string } => item.kind === 'failure').map(({ agent, detail }) => ({ agent, detail }))
    };
    this.pending.set(preview.id, preview);
    this.removeExpired(now);
    return preview;
  }

  async confirm(previewId: string, now = new Date()): Promise<BatchApplyResult> {
    const preview = this.pending.get(previewId);
    if (!preview || new Date(preview.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new Error('批量 Apply Plan 不存在或已过期，请重新预览。');
    }
    // Consume the batch intent before writes. Individual plans are also
    // single-use, so a retry always starts with a fresh filesystem preview.
    this.pending.delete(previewId);
    const results = await Promise.all(preview.plans.map(async (plan) => {
      try {
        const result = await this.applyPlans.confirm(plan.id);
        return { agent: plan.plan.agent, status: 'succeeded' as const, appliedOperationCount: result.appliedOperationCount };
      } catch (error) {
        return { agent: plan.plan.agent, status: 'failed' as const, detail: toMessage(error) };
      }
    }));
    return { results: results.sort((left, right) => left.agent.localeCompare(right.agent)) };
  }

  private removeExpired(now: Date): void {
    for (const [id, preview] of this.pending) {
      if (new Date(preview.expiresAt).getTime() <= now.getTime()) this.pending.delete(id);
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
