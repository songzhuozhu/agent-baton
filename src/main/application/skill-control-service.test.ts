import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SkillControlService } from './skill-control-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SkillControlService', () => {
  it('adopts explicitly, defaults to Local Only, and resolves group intent per Agent', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-control-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: interface-design\ndescription: UI\n---\n');
    const store = new LocalStateStore(':memory:');
    const service = new SkillControlService(store, new ManagedLibrary(join(workspace, 'library')));

    try {
      const skill = await service.adoptSkill({
        sourceDirectory: source,
        tags: ['personal', 'design', 'personal'],
        userDescription: '个人项目界面'
      });
      const group = service.createGroup('个人全栈');
      service.addSkillToGroup(group.id, skill.id);
      service.setActiveGroups('codex', [group.id]);
      service.setSkillOverride('codex', skill.id, 'force-disable');

      expect(skill.syncPolicy).toBe('local-only');
      expect(skill.tags).toEqual(['design', 'personal']);
      expect(service.getAgentSkillView('codex')).toEqual({
        desiredState: {
          agent: 'codex',
          activeGroupIds: [group.id],
          overrides: { [skill.id]: 'force-disable' }
        },
        effectiveSkillIds: [],
        unknownGroupIds: [],
        unknownSkillIds: []
      });
      expect(service.setActiveGroupsForAgents(['codex', 'cursor'], [group.id])).toEqual([
        expect.objectContaining({ agent: 'codex', activeGroupIds: [group.id] }),
        expect.objectContaining({ agent: 'cursor', activeGroupIds: [group.id] })
      ]);
    } finally {
      store.close();
    }
  });
});
