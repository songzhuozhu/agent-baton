import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter, DiscoveredSkillInstallation } from './adapters/agent-adapter';
import { SkillControlService } from './application/skill-control-service';
import { loadDashboard } from './dashboard';
import { ManagedLibrary } from './library/managed-library';
import { LocalStateStore } from './storage/local-state-store';

const stores: LocalStateStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function fixture() {
  const store = new LocalStateStore(':memory:');
  stores.push(store);
  const service = new SkillControlService(store, new ManagedLibrary('/unused/library'));
  for (const id of ['one', 'two']) {
    store.saveSkill({ id, name: id, originalDescription: '', tags: [], syncPolicy: 'local-only', source: { kind: 'local' } });
  }
  const installations: DiscoveredSkillInstallation[] = [];
  const adapter: AgentAdapter = {
    agent: 'codex',
    detect: async () => ({ agent: 'codex', availability: 'detected', detail: 'fixture' }),
    discoverUserSkills: async () => ({ installations, issues: [] }),
    assessSkill: async () => ({ status: 'compatible', detail: 'fixture' }),
    managedSkillRoot: () => '/fixture/skills'
  };
  function discover(skillId: string, managed = true, canonicalPath = `/fixture/skills/${skillId}`) {
    const path = `/fixture/skills/${skillId}`;
    installations.push({
      agent: 'codex', scope: 'user', sourcePath: path, canonicalPath,
      skillName: skillId, originalDescription: '', contentHash: 'sha256:1', risks: []
    });
    if (managed) {
      store.saveObservedInstallation({
        agent: 'codex', skillId, path, contentHash: 'sha256:1', enabled: true, managed: true
      });
    }
  }
  return { store, service, adapter, discover };
}

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
          hasPendingChanges: false,
          restartRequired: false
        }
      ]
    });
  });

  it('flags a skill replacement even when the enabled counts are unchanged', async () => {
    const { store, service, adapter, discover } = fixture();
    discover('one');
    service.setSkillOverride('codex', 'two', 'force-enable');

    const dashboard = await loadDashboard([adapter], service, store);
    expect(dashboard.pendingApplyCount).toBe(1);
    expect(dashboard.agents[0]).toMatchObject({
      currentEnabledCount: 1, desiredEnabledCount: 1, hasPendingChanges: true
    });
  });

  it('keeps external skills in the desired total without marking them pending', async () => {
    const { store, service, adapter, discover } = fixture();
    discover('one');
    discover('external', false);
    discover('alias', false, '/fixture/skills/external');
    service.setSkillOverride('codex', 'one', 'force-enable');

    const dashboard = await loadDashboard([adapter], service, store);
    expect(dashboard.pendingApplyCount).toBe(0);
    expect(dashboard.agents[0]).toMatchObject({
      currentEnabledCount: 2, desiredEnabledCount: 2, hasPendingChanges: false
    });
  });

  it('does not treat an implicit empty selection as a request to remove installations', async () => {
    const { store, service, adapter, discover } = fixture();
    discover('one');
    discover('external', false);

    const dashboard = await loadDashboard([adapter], service, store);
    expect(dashboard.pendingApplyCount).toBe(0);
    expect(dashboard.agents[0]).toMatchObject({
      currentEnabledCount: 2, desiredEnabledCount: 2, hasPendingChanges: false
    });
  });

  it('detects a missing managed installation from discovery even when its stored record remains', async () => {
    const { store, service, adapter } = fixture();
    store.saveObservedInstallation({
      agent: 'codex', skillId: 'one', path: '/fixture/skills/one',
      contentHash: 'sha256:1', enabled: true, managed: true
    });
    service.setSkillOverride('codex', 'one', 'force-enable');

    const dashboard = await loadDashboard([adapter], service, store);
    expect(dashboard.pendingApplyCount).toBe(1);
    expect(dashboard.agents[0]).toMatchObject({
      currentEnabledCount: 0, desiredEnabledCount: 1, hasPendingChanges: true
    });
  });

  it('deduplicates an external alias of a retained managed installation in the desired total', async () => {
    const { store, service, adapter, discover } = fixture();
    discover('one');
    discover('alias', false, '/fixture/skills/one');
    service.setSkillOverride('codex', 'one', 'force-enable');

    const dashboard = await loadDashboard([adapter], service, store);
    expect(dashboard.pendingApplyCount).toBe(0);
    expect(dashboard.agents[0]).toMatchObject({
      currentEnabledCount: 1, desiredEnabledCount: 1, hasPendingChanges: false
    });
  });
});
