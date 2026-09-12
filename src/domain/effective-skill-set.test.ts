import { describe, expect, it } from 'vitest';
import type { DesiredAgentState, ManagedSkill, SkillGroup } from '../shared/domain';
import { resolveEffectiveSkillSet } from './effective-skill-set';

const skills: ManagedSkill[] = [
  {
    id: 'company',
    name: 'company',
    originalDescription: '',
    tags: [],
    syncPolicy: 'local-only',
    source: { kind: 'local' }
  },
  {
    id: 'design',
    name: 'design',
    originalDescription: '',
    tags: [],
    syncPolicy: 'sync-allowed',
    source: { kind: 'local' }
  },
  {
    id: 'video',
    name: 'video',
    originalDescription: '',
    tags: [],
    syncPolicy: 'sync-allowed',
    source: { kind: 'local' }
  }
];

const groups: SkillGroup[] = [
  { id: 'work', name: '工作', participatesInSync: false, skillIds: ['company', 'design'] },
  { id: 'weekend', name: '周末', participatesInSync: true, skillIds: ['design', 'video'] }
];

describe('resolveEffectiveSkillSet', () => {
  it('deduplicates group membership and applies overrides in the documented order', () => {
    const desiredState: DesiredAgentState = {
      agent: 'codex',
      activeGroupIds: ['work', 'weekend'],
      overrides: { company: 'force-disable', video: 'force-disable', design: 'force-enable' }
    };

    expect(resolveEffectiveSkillSet({ skills, groups, desiredState })).toEqual({
      skillIds: ['design'],
      unknownGroupIds: [],
      unknownSkillIds: []
    });
  });

  it('reports dangling group and skill references without inventing an identity', () => {
    const desiredState: DesiredAgentState = {
      agent: 'codex',
      activeGroupIds: ['missing', 'work'],
      overrides: { ghost: 'force-enable' }
    };

    const result = resolveEffectiveSkillSet({
      skills,
      groups: [...groups, { id: 'broken', name: '损坏', participatesInSync: false, skillIds: ['lost'] }],
      desiredState: { ...desiredState, activeGroupIds: [...desiredState.activeGroupIds, 'broken'] }
    });

    expect(result).toEqual({
      skillIds: ['company', 'design'],
      unknownGroupIds: ['missing'],
      unknownSkillIds: ['ghost', 'lost']
    });
  });
});
