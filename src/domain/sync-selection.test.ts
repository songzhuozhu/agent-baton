import { describe, expect, it } from 'vitest';
import type { DesiredAgentState, ManagedSkill, SkillGroup } from '../shared/domain';
import { selectPortableSnapshot } from './sync-selection';

const skills: ManagedSkill[] = [
  {
    id: 'private',
    name: 'private',
    originalDescription: '内部部署',
    userDescription: '不能同步',
    tags: ['private'],
    syncPolicy: 'local-only',
    source: { kind: 'local' }
  },
  {
    id: 'design',
    name: 'design',
    originalDescription: '设计',
    tags: ['personal'],
    syncPolicy: 'sync-allowed',
    source: { kind: 'local' }
  }
];

const groups: SkillGroup[] = [
  { id: 'private-group', name: '公司', participatesInSync: true, skillIds: ['private'] },
  { id: 'personal-group', name: '个人', participatesInSync: true, skillIds: ['private', 'design'] },
  { id: 'local-group', name: '本地', participatesInSync: false, skillIds: ['design'] }
];

describe('selectPortableSnapshot', () => {
  it('never emits Local Only content or references, regardless of group membership', () => {
    const desiredStates: DesiredAgentState[] = [
      {
        agent: 'codex',
        activeGroupIds: ['private-group', 'personal-group', 'local-group'],
        overrides: { private: 'force-enable', design: 'force-disable' }
      }
    ];

    expect(selectPortableSnapshot({ skills, groups, desiredStates })).toEqual({
      skills: [{ skill: skills[1] }],
      groups: [
        { group: { id: 'personal-group', name: '个人', participatesInSync: true, skillIds: ['design'] } },
        { group: { id: 'private-group', name: '公司', participatesInSync: true, skillIds: [] } }
      ],
      agentStates: [
        {
          state: {
            agent: 'codex',
            activeGroupIds: ['personal-group', 'private-group'],
            overrides: { design: 'force-disable' }
          }
        }
      ]
    });
  });
});
