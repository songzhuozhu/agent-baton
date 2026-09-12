import { describe, expect, it } from 'vitest';
import { LocalStateStore } from '../storage/local-state-store';
import { GroupDeletionService } from './group-deletion-service';

describe('GroupDeletionService', () => {
  it('requires a preview and removes the group from all Agent desired states', () => {
    const store = new LocalStateStore(':memory:');
    store.saveGroup({ id: 'group-a', name: 'Work', participatesInSync: true, skillIds: ['skill-a', 'skill-b'] });
    store.saveDesiredAgentState({ agent: 'codex', activeGroupIds: ['group-a'], overrides: {} });
    store.saveDesiredAgentState({ agent: 'cursor', activeGroupIds: ['group-a'], overrides: {} });
    const service = new GroupDeletionService(store);

    const preview = service.preview('group-a', new Date('2026-08-09T00:00:00.000Z'));
    expect(preview).toMatchObject({ affectedAgents: ['codex', 'cursor'], affectedSkillCount: 2 });
    service.confirm(preview.id, new Date('2026-08-09T00:01:00.000Z'));

    expect(store.listGroups()).toEqual([]);
    expect(store.listDesiredAgentStates().map((state) => state.activeGroupIds)).toEqual([[], []]);
    store.close();
  });
});
