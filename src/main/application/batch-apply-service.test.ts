import { describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../adapters/agent-adapter';
import type { PreviewedApplyPlan } from './apply-plan-service';
import { BatchApplyService } from './batch-apply-service';

const codex: AgentAdapter = {
  agent: 'codex',
  detect: async () => ({ agent: 'codex', availability: 'detected', detail: 'fixture' }),
  discoverUserSkills: async () => ({ installations: [], issues: [] }),
  assessSkill: async () => ({ status: 'compatible', detail: 'fixture' }),
  managedSkillRoot: () => '/fixture/codex'
};

const trae: AgentAdapter = { ...codex, agent: 'trae', managedSkillRoot: () => undefined };

describe('BatchApplyService', () => {
  it('keeps Agents independent: a failed preview or apply does not erase other results', async () => {
    const codexPreview: PreviewedApplyPlan = {
      id: 'plan-codex', createdAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T00:15:00.000Z',
      plan: { agent: 'codex', operations: [], blockedExternalInstallationPaths: [] }
    };
    const fakeApplyPlans = {
      preview: async (adapter: AgentAdapter) => {
        if (adapter.agent === 'trae') throw new Error('read only');
        return codexPreview;
      },
      confirm: async (id: string) => {
        if (id === 'plan-codex') return { appliedOperationCount: 1, backupReferences: [] };
        throw new Error('missing');
      }
    };
    const service = new BatchApplyService(fakeApplyPlans as never);

    const preview = await service.preview([codex, trae]);
    expect(preview).toMatchObject({ id: expect.any(String), plans: [codexPreview], failures: [{ agent: 'trae' }] });
    await expect(service.confirm(preview.id)).resolves.toEqual({
      results: [{ agent: 'codex', status: 'succeeded', appliedOperationCount: 1 }]
    });
  });

  it('rejects a batch confirmation after its preview expires', async () => {
    const codexPreview: PreviewedApplyPlan = {
      id: 'plan-codex', createdAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T00:15:00.000Z',
      plan: { agent: 'codex', operations: [], blockedExternalInstallationPaths: [] }
    };
    const fakeApplyPlans = { preview: async () => codexPreview, confirm: async () => ({ appliedOperationCount: 0, backupReferences: [] }) };
    const service = new BatchApplyService(fakeApplyPlans as never);
    const now = new Date('2026-08-09T00:00:00.000Z');
    const preview = await service.preview([codex], now);

    await expect(service.confirm(preview.id, new Date('2026-08-09T00:16:00.000Z')))
      .rejects.toThrow('不存在或已过期');
  });
});
