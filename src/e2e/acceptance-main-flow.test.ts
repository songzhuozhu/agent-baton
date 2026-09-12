import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../main/adapters/agent-adapter';
import { ApplyPlanService } from '../main/application/apply-plan-service';
import { SkillControlService } from '../main/application/skill-control-service';
import { SyncExportService } from '../main/application/sync-export-service';
import { ManagedLibrary } from '../main/library/managed-library';
import { LocalStateStore } from '../main/storage/local-state-store';
import { SyncRepository } from '../sync/sync-repository';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('V1 acceptance main flow', () => {
  it('adopts Skills, reuses one Skill across groups, applies per Agent, and keeps Local Only content out of Git', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-e2e-'));
    temporaryDirectories.push(workspace);
    const designSource = join(workspace, 'design-source');
    const privateSource = join(workspace, 'private-source');
    await mkdir(designSource, { recursive: true });
    await mkdir(privateSource, { recursive: true });
    await writeFile(join(designSource, 'SKILL.md'), '---\nname: design\ndescription: personal design\n---\n');
    await writeFile(join(privateSource, 'SKILL.md'), '---\nname: internal\ndescription: work only\n---\n');
    const store = new LocalStateStore(':memory:');
    const library = new ManagedLibrary(join(workspace, 'library'));
    const control = new SkillControlService(store, library);
    const design = await control.adoptSkill({ sourceDirectory: designSource, syncPolicy: 'sync-allowed', tags: ['design'] });
    const internal = await control.adoptSkill({ sourceDirectory: privateSource, tags: ['private'] });
    const work = control.createGroup('公司开发');
    const personal = control.createGroup('个人全栈');
    control.addSkillToGroup(work.id, design.id);
    control.addSkillToGroup(work.id, internal.id);
    control.addSkillToGroup(personal.id, design.id);
    control.setGroupSyncParticipation(work.id, true);
    control.setGroupSyncParticipation(personal.id, true);
    control.setActiveGroups('codex', [work.id]);
    control.setActiveGroups('claude-code', [personal.id]);

    expect(control.getAgentSkillView('codex').effectiveSkillIds).toEqual([design.id, internal.id].sort());
    expect(control.getAgentSkillView('claude-code').effectiveSkillIds).toEqual([design.id]);

    const codexTarget = join(workspace, 'codex-skills');
    const codex: AgentAdapter = {
      agent: 'codex',
      detect: async () => ({ agent: 'codex', availability: 'detected', detail: 'fixture' }),
      discoverUserSkills: async () => ({ installations: [], issues: [] }),
      assessSkill: async () => ({ status: 'compatible', detail: 'fixture' }),
      managedSkillRoot: () => codexTarget,
      reloadBehavior: () => 'requires-restart'
    };
    const applyPlans = new ApplyPlanService(control, store, join(workspace, 'backups'));
    const plan = await applyPlans.preview(codex);
    expect(plan.plan.operations).toHaveLength(2);
    await applyPlans.confirm(plan.id);
    expect(store.listObservedInstallations().filter((installation) => installation.agent === 'codex')).toHaveLength(2);

    await new SyncExportService(store, library).write(new SyncRepository(join(workspace, 'sync-repository')));
    await expect(readFile(join(workspace, 'sync-repository', 'agent-baton', 'skills', design.id, 'metadata.json'), 'utf8')).resolves.toContain('design');
    await expect(readFile(join(workspace, 'sync-repository', 'agent-baton', 'skills', internal.id, 'metadata.json'), 'utf8')).rejects.toThrow();
    store.close();
  });
});
