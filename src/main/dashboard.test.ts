import { describe, expect, it } from 'vitest';
import type { AgentAdapter } from './adapters/agent-adapter';
import { loadDashboard } from './dashboard';

describe('loadDashboard', () => {
  it('uses actual discovery as the baseline instead of inventing a pending apply', async () => {
    const adapter: AgentAdapter = {
      agent: 'codex',
      detect: async () => ({ agent: 'codex', availability: 'detected', detail: 'fixture' }),
      discoverUserSkills: async () => ({
        installations: [
          {
            agent: 'codex',
            scope: 'user',
            sourcePath: '/aliases/one',
            canonicalPath: '/canonical/one',
            skillName: 'one',
            originalDescription: '',
            contentHash: 'sha256:1',
            risks: []
          },
          {
            agent: 'codex',
            scope: 'user',
            sourcePath: '/aliases/two',
            canonicalPath: '/canonical/one',
            skillName: 'one',
            originalDescription: '',
            contentHash: 'sha256:1',
            risks: []
          }
        ],
        issues: []
      }),
      assessSkill: async () => ({ status: 'compatible', detail: 'fixture' }),
      managedSkillRoot: () => '/fixture/skills'
    };

    await expect(loadDashboard([adapter])).resolves.toEqual({
      pendingApplyCount: 0,
      pendingSyncCount: 0,
      upstreamUpdateCount: 0,
      agents: [
        {
          id: 'codex',
          name: 'Codex',
          status: 'detected',
          currentEnabledCount: 1,
          desiredEnabledCount: 1,
          restartRequired: false
        }
      ]
    });
  });
});
