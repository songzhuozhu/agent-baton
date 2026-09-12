import { describe, expect, it } from 'vitest';
import { LocalStateStore } from './local-state-store';

describe('LocalStateStore', () => {
  it('migrates an empty database and keeps portable intent separate from local observations', () => {
    const store = new LocalStateStore(':memory:');
    try {
      store.saveSkill({
        id: 'skill-1',
        name: '设计',
        originalDescription: '原始描述',
        userDescription: '我的备注',
        tags: ['personal'],
        syncPolicy: 'sync-allowed',
        source: { kind: 'local' }
      });
      store.saveGroup({
        id: 'group-1',
        name: '个人全栈',
        participatesInSync: true,
        skillIds: ['skill-1']
      });
      store.saveDesiredAgentState({
        agent: 'codex',
        activeGroupIds: ['group-1'],
        overrides: {}
      });
      store.saveObservedInstallation({
        agent: 'codex',
        skillId: 'skill-1',
        path: '/device-only/.agents/skills/design',
        contentHash: 'sha256:abc',
        enabled: true,
        managed: true
      });
      store.saveSkillTombstone({
        id: 'removed-skill', deletedAt: '2026-08-09T00:00:00.000Z', syncAllowed: true
      });
      store.saveSyncBaseline('private-repository', {
        skills: [], groups: [], agentStates: [], tombstones: []
      });
      store.saveSyncConnection({
        repositoryDirectory: '/device-only/agent-baton-sync',
        repositoryUrl: 'https://github.com/example/agent-baton-sync.git'
      });

      expect(store.listSkills()).toHaveLength(1);
      expect(store.listGroups()).toHaveLength(1);
      expect(store.listDesiredAgentStates()).toEqual([
        { agent: 'codex', activeGroupIds: ['group-1'], overrides: {} }
      ]);
      expect(store.listObservedInstallations()).toEqual([
        {
          agent: 'codex',
          skillId: 'skill-1',
          path: '/device-only/.agents/skills/design',
          contentHash: 'sha256:abc',
          enabled: true,
          managed: true
        }
      ]);
      expect(store.listSkillTombstones()).toEqual([
        { id: 'removed-skill', deletedAt: '2026-08-09T00:00:00.000Z', syncAllowed: true }
      ]);
      expect(store.getSyncBaseline('private-repository')).toEqual({
        skills: [], groups: [], agentStates: [], tombstones: []
      });
      expect(store.getSyncConnection()).toEqual({
        repositoryDirectory: '/device-only/agent-baton-sync',
        repositoryUrl: 'https://github.com/example/agent-baton-sync.git'
      });
      store.clearSyncConnection();
      expect(store.getSyncConnection()).toBeUndefined();
      store.appendLocalError('Git failed: Authorization: Bearer ghp_exampleSecret');
      expect(store.listLocalErrors()).toEqual([
        expect.objectContaining({ message: 'Git failed: Authorization: Bearer [已脱敏]' })
      ]);
      store.clearLocalErrors();
      expect(store.listLocalErrors()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
