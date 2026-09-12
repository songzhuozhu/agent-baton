import { describe, expect, it } from 'vitest';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SkillControlService } from './skill-control-service';
import { SyncPolicyChangeService } from './sync-policy-change-service';

describe('SyncPolicyChangeService', () => {
  it('previews the affected sync groups and requires confirmation before making a Skill Local Only', () => {
    const store = new LocalStateStore(':memory:');
    const control = new SkillControlService(store, new ManagedLibrary('/not-used'));
    store.saveSkill({ id: 'skill-a', name: 'design', originalDescription: '', tags: [], syncPolicy: 'sync-allowed', source: { kind: 'local' } });
    store.saveGroup({ id: 'group-a', name: 'Personal', participatesInSync: true, skillIds: ['skill-a'] });
    const service = new SyncPolicyChangeService(store, control);

    const preview = service.preview('skill-a', 'local-only', new Date('2026-08-09T00:00:00.000Z'));
    expect(preview).toMatchObject({ affectedSyncGroupIds: ['group-a'], historyWarning: true });
    service.confirm(preview.id, new Date('2026-08-09T00:01:00.000Z'));
    expect(store.listSkills()[0].syncPolicy).toBe('local-only');
    store.close();
  });
});
