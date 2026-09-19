import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../adapters/agent-adapter';
import { ManagedLibrary } from '../library/managed-library';
import { LocalStateStore } from '../storage/local-state-store';
import { SkillControlService } from './skill-control-service';
import { ApplyPlanError, ApplyPlanService } from './apply-plan-service';
import { ManagedSkillDeletionService } from './managed-skill-deletion-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ApplyPlanService', () => {
  it('requires a preview ID before it writes and consumes that ID after confirmation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-plan-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    const targetRoot = join(workspace, 'target');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\ndescription: design\n---\ncanonical');
    const store = new LocalStateStore(':memory:');
    const control = new SkillControlService(store, new ManagedLibrary(join(workspace, 'library')));
    const skill = await control.adoptSkill({ sourceDirectory: source });
    const group = control.createGroup('个人');
    control.addSkillToGroup(group.id, skill.id);
    control.setActiveGroups('codex', [group.id]);
    const adapter: AgentAdapter = {
      agent: 'codex',
      detect: async () => ({ agent: 'codex', availability: 'detected', detail: 'fixture' }),
      discoverUserSkills: async () => ({ installations: [], issues: [] }),
      assessSkill: async () => ({ status: 'compatible', detail: 'fixture' }),
      managedSkillRoot: () => targetRoot
    };
    const service = new ApplyPlanService(control, store, join(workspace, 'backups'));

    try {
      await expect(service.confirm('missing')).rejects.toBeInstanceOf(ApplyPlanError);
      const preview = await service.preview(adapter, new Date('2026-08-09T00:00:00.000Z'));
      expect(preview.plan.operations).toHaveLength(1);
      await expect(service.confirm(preview.id, new Date('2026-08-09T00:01:00.000Z'))).resolves.toMatchObject({
        appliedOperationCount: 1
      });
      const target = preview.plan.operations[0].targetDirectory;
      await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toContain('canonical');
      expect(store.isAgentRestartRequired('codex')).toBe(true);
      await service.verifyAfterManualRestart(adapter);
      expect(store.isAgentRestartRequired('codex')).toBe(false);
      const undo = await service.previewUndo(adapter, new Date('2026-08-09T00:02:00.000Z'));
      expect(undo).toMatchObject({ agent: 'codex', operationCount: 1 });
      await service.confirmUndo(undo.id, new Date('2026-08-09T00:03:00.000Z'));
      await expect(readFile(join(target, 'SKILL.md'), 'utf8')).rejects.toThrow();
      expect(store.listObservedInstallations()).toEqual([]);
      expect(store.listApplyRecords()[0].undoneAt).toBe('2026-08-09T00:03:00.000Z');
      expect(store.isAgentRestartRequired('codex')).toBe(true);
      await expect(service.confirm(preview.id, new Date('2026-08-09T00:02:00.000Z'))).rejects.toBeInstanceOf(ApplyPlanError);
    } finally {
      store.close();
    }
  });

  it('expires a stale plan before confirming it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-plan-'));
    temporaryDirectories.push(workspace);
    const store = new LocalStateStore(':memory:');
    const control = new SkillControlService(store, new ManagedLibrary(join(workspace, 'library')));
    const adapter: AgentAdapter = {
      agent: 'trae',
      detect: async () => ({ agent: 'trae', availability: 'read-only', detail: 'fixture' }),
      discoverUserSkills: async () => ({ installations: [], issues: [] }),
      assessSkill: async () => ({ status: 'unknown', detail: 'fixture' }),
      managedSkillRoot: () => join(workspace, 'target')
    };
    const service = new ApplyPlanService(control, store, join(workspace, 'backups'));

    try {
      const preview = await service.preview(adapter, new Date('2026-08-09T00:00:00.000Z'));
      await expect(service.confirm(preview.id, new Date('2026-08-09T00:16:00.000Z'))).rejects.toThrow('已过期');
    } finally {
      store.close();
    }
  });

  it('removes the registered installation after its canonical Skill is deleted', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-plan-'));
    temporaryDirectories.push(workspace);
    const source = join(workspace, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: design\n---\ncanonical');
    const store = new LocalStateStore(':memory:');
    const library = new ManagedLibrary(join(workspace, 'library'));
    const control = new SkillControlService(store, library);
    const adapter: AgentAdapter = {
      agent: 'codex',
      detect: async () => ({ agent: 'codex', availability: 'detected', detail: 'fixture' }),
      discoverUserSkills: async () => ({ installations: [], issues: [] }),
      assessSkill: async () => ({ status: 'compatible', detail: 'fixture' }),
      managedSkillRoot: () => join(workspace, 'target')
    };
    const service = new ApplyPlanService(control, store, join(workspace, 'backups'));
    try {
      const skill = await control.adoptSkill({ sourceDirectory: source });
      control.setSkillOverride('codex', skill.id, 'force-enable');
      const apply = await service.preview(adapter);
      await service.confirm(apply.id);
      const target = apply.plan.operations[0].targetDirectory;
      const deletions = new ManagedSkillDeletionService(store, library);
      await deletions.confirm(deletions.preview(skill.id).id);

      const cleanup = await service.preview(adapter);
      expect(cleanup.plan.operations).toMatchObject([{ kind: 'remove', skillId: skill.id }]);
      await expect(service.confirm(cleanup.id)).resolves.toMatchObject({ appliedOperationCount: 1 });
      await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(store.listObservedInstallations()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
