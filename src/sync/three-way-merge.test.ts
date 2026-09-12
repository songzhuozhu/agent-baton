import { describe, expect, it } from 'vitest';
import type { SyncMergeState } from './three-way-merge';
import { mergeSyncStates } from './three-way-merge';

function state(overrides: Partial<SyncMergeState> = {}): SyncMergeState {
  return {
    skills: [{
      metadata: {
        id: 'skill-a', schemaVersion: 1, name: 'Design', tags: ['design'], syncPolicy: 'sync-allowed', source: { kind: 'local' }
      },
      contentHash: 'hash-base'
    }],
    groups: [{ id: 'group-a', name: 'Personal', participatesInSync: true, skillIds: ['skill-a'] }],
    agentStates: [{ agent: 'codex', activeGroupIds: ['group-a'], overrides: {} }],
    tombstones: [],
    ...overrides
  };
}

describe('mergeSyncStates', () => {
  it('automatically merges independent metadata fields from two devices', () => {
    const base = state();
    const local = state({ skills: [{ ...base.skills[0], metadata: { ...base.skills[0].metadata, userDescription: '我的说明' } }] });
    const remote = state({ skills: [{ ...base.skills[0], metadata: { ...base.skills[0].metadata, tags: ['design', 'personal'] } }] });

    expect(mergeSyncStates(base, local, remote)).toEqual({
      conflicts: [],
      merged: state({ skills: [{
        contentHash: 'hash-base',
        metadata: {
          id: 'skill-a', schemaVersion: 1, name: 'Design', userDescription: '我的说明', tags: ['design', 'personal'], syncPolicy: 'sync-allowed', source: { kind: 'local' }
        }
      }] })
    });
  });

  it('reports a same-field conflict rather than using last writer wins', () => {
    const base = state();
    const local = state({ groups: [{ ...base.groups[0], name: '本地名称' }] });
    const remote = state({ groups: [{ ...base.groups[0], name: '远端名称' }] });

    const result = mergeSyncStates(base, local, remote);

    expect(result.conflicts).toContainEqual(expect.objectContaining({ kind: 'field', entity: 'group', id: 'group-a', field: 'name' }));
  });

  it('does not text-merge concurrently changed Skill content', () => {
    const base = state();
    const local = state({ skills: [{ ...base.skills[0], contentHash: 'hash-local' }] });
    const remote = state({ skills: [{ ...base.skills[0], contentHash: 'hash-remote' }] });

    const result = mergeSyncStates(base, local, remote);

    expect(result.conflicts).toContainEqual({
      kind: 'content', entity: 'skill', id: 'skill-a', baseHash: 'hash-base', localHash: 'hash-local', remoteHash: 'hash-remote'
    });
  });

  it('requires an explicit decision when a tombstone and old Skill content coexist', () => {
    const base = state();
    const local = state({ tombstones: [{ entity: 'skill', id: 'skill-a', schemaVersion: 1, deletedAt: '2026-08-09T00:00:00.000Z' }] });
    const remote = state();

    const result = mergeSyncStates(base, local, remote);

    expect(result.conflicts).toContainEqual(expect.objectContaining({ kind: 'tombstone', id: 'skill-a' }));
  });
});
