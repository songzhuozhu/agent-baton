import { dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { AGENT_KINDS, type AgentKind } from '../shared/domain';
import type { ApplicationRuntime } from './application/runtime';
import { loadDashboard } from './dashboard';
import { discoverCustomSkills } from './skills/custom-skill-discovery';
import { SyncRepository } from '../sync/sync-repository';
import { cloneGitWorktree, GitWorktree, isGitHubHttpsRepositoryUrl } from './git/git-worktree';
import { basename, join } from 'node:path';

const agentSchema = z.enum(AGENT_KINDS);
const groupNameSchema = z.string().trim().min(1).max(120);
const groupIdSchema = z.string().uuid();
const skillIdSchema = z.string().uuid();
const tagsSchema = z.array(z.string().trim().min(1).max(64)).max(20).optional();

export function registerIpcHandlers(runtime: ApplicationRuntime): void {
  ipcMain.handle('dashboard:load', () => loadDashboard(runtime.adapters, runtime.skillControl, runtime.stateStore));

  ipcMain.handle('library:load', async () => ({
    skills: runtime.skillControl.listSkills(),
    groups: runtime.skillControl.listGroups(),
    discovered: (
      await Promise.all(runtime.adapters.map((adapter) => adapter.discoverUserSkills()))
    )
      .flatMap((result) => result.installations)
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    customScanRoots: runtime.stateStore.listCustomScanRoots(),
    customDiscovered: (await discoverCustomSkills(runtime.stateStore.listCustomScanRoots())).installations
  }));

  ipcMain.handle('settings:choose-and-add-scan-root', async (_event, rawInput: unknown) => {
    const kind = z.enum(['custom', 'project']).parse(rawInput);
    const result = await dialog.showOpenDialog({ title: kind === 'project' ? '选择项目根目录' : '选择自定义 Skill 扫描目录', properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const root = { path: result.filePaths[0], kind };
    runtime.stateStore.saveCustomScanRoot(root);
    return root;
  });

  ipcMain.handle('settings:remove-scan-root', (_event, rawInput: unknown) => {
    const path = z.string().min(1).max(4_096).parse(rawInput);
    runtime.stateStore.deleteCustomScanRoot(path);
  });

  ipcMain.handle('adoption:choose-and-preview', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择包含 SKILL.md 的目录',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return runtime.adoptions.preview(result.filePaths[0]);
  });

  ipcMain.handle('adoption:preview-path', (_event, rawPath: unknown) => {
    const path = z.string().min(1).max(4_096).parse(rawPath);
    return runtime.adoptions.preview(path);
  });

  ipcMain.handle('adoption:preview-upstream', (_event, rawInput: unknown) => {
    const input = z.object({
      repositoryUrl: z.string().url().max(2_048),
      relativePath: z.string().max(1_024)
    }).parse(rawInput);
    return runtime.adoptions.previewUpstream(input.repositoryUrl, input.relativePath);
  });

  ipcMain.handle('adoption:confirm', async (_event, rawInput: unknown) => {
    const input = z
      .object({
        previewId: z.string().uuid(),
        tags: tagsSchema,
        userDescription: z.string().max(2_000).optional(),
        syncPolicy: z.enum(['local-only', 'sync-allowed']).optional()
      })
      .parse(rawInput);
    return runtime.adoptions.confirm(input.previewId, input);
  });

  ipcMain.handle('skills:delete-preview', (_event, rawInput: unknown) =>
    runtime.deletions.preview(skillIdSchema.parse(rawInput))
  );

  ipcMain.handle('skills:delete-confirm', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    return runtime.deletions.confirm(input.previewId);
  });

  ipcMain.handle('skills:restore', (_event, rawInput: unknown) =>
    runtime.deletions.restore(skillIdSchema.parse(rawInput))
  );

  ipcMain.handle('skills:sync-policy-preview', (_event, rawInput: unknown) => {
    const input = z.object({ skillId: skillIdSchema, nextPolicy: z.enum(['local-only', 'sync-allowed']) }).parse(rawInput);
    return runtime.syncPolicyChanges.preview(input.skillId, input.nextPolicy);
  });

  ipcMain.handle('skills:sync-policy-confirm', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    return runtime.syncPolicyChanges.confirm(input.previewId);
  });

  ipcMain.handle('skills:update-metadata', (_event, rawInput: unknown) => {
    const input = z.object({
      skillId: skillIdSchema,
      tags: z.array(z.string().trim().min(1).max(64)).max(20),
      userDescription: z.string().max(2_000)
    }).parse(rawInput);
    return runtime.skillControl.updateSkillMetadata(input.skillId, input);
  });

  ipcMain.handle('upstream:check', (_event, rawInput: unknown) =>
    runtime.upstreamUpdates.check(skillIdSchema.parse(rawInput))
  );

  ipcMain.handle('upstream:preview-update', (_event, rawInput: unknown) =>
    runtime.upstreamUpdates.previewUpdate(skillIdSchema.parse(rawInput))
  );

  ipcMain.handle('upstream:preview-discard-fork-and-update', (_event, rawInput: unknown) =>
    runtime.upstreamUpdates.previewDiscardLocalForkAndUpdate(skillIdSchema.parse(rawInput))
  );

  ipcMain.handle('upstream:confirm-update', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    return runtime.upstreamUpdates.confirmUpdate(input.previewId);
  });

  ipcMain.handle('diagnostics:preview', () => runtime.diagnostics.preview());

  ipcMain.handle('diagnostics:choose-and-generate', async () => {
    const result = await dialog.showSaveDialog({
      title: '保存 AgentBaton 诊断包',
      defaultPath: 'agent-baton-diagnostic.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await runtime.diagnostics.generate(result.filePath);
    return result.filePath;
  });

  ipcMain.handle('diagnostics:record-local-error', (_event, rawInput: unknown) => {
    runtime.stateStore.appendLocalError(z.string().max(4_000).parse(rawInput));
  });

  ipcMain.handle('diagnostics:list-local-errors', () => runtime.stateStore.listLocalErrors());

  ipcMain.handle('diagnostics:clear-local-errors', () => runtime.stateStore.clearLocalErrors());

  ipcMain.handle('sync:choose-and-preview-push', async () => {
    const result = await dialog.showOpenDialog({ title: '选择 AgentBaton 专用 Git 工作树', properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    await saveSyncConnection(runtime, result.filePaths[0]);
    return runtime.manualSync.preview(result.filePaths[0]);
  });

  ipcMain.handle('sync:connection', () => runtime.stateStore.getSyncConnection() ?? null);

  ipcMain.handle('sync:connection-clear', () => runtime.stateStore.clearSyncConnection());

  ipcMain.handle('sync:preview-saved-push', () => {
    const connection = runtime.stateStore.getSyncConnection();
    if (!connection) throw new Error('尚未连接 AgentBaton 专用 GitHub 同步仓库。');
    return runtime.manualSync.preview(connection.repositoryDirectory);
  });

  ipcMain.handle('sync:confirm-push', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    return runtime.manualSync.confirm(input.previewId);
  });

  ipcMain.handle('sync:choose-and-preview-restore', async () => {
    const result = await dialog.showOpenDialog({ title: '选择包含 AgentBaton 数据的 Git 工作树', properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    await saveSyncConnection(runtime, result.filePaths[0]);
    return runtime.syncRestores.preview(new SyncRepository(result.filePaths[0]));
  });

  ipcMain.handle('sync:clone-and-preview-restore', async (_event, rawInput: unknown) => {
    const input = z.object({ repositoryUrl: z.string().url().max(2_048) }).parse(rawInput);
    const repositoryName = syncRepositoryDirectoryName(input.repositoryUrl);
    const result = await dialog.showOpenDialog({
      title: '选择同步仓库的本地存放位置',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const targetDirectory = join(result.filePaths[0], repositoryName);
    await cloneGitWorktree({
      repositoryUrl: input.repositoryUrl,
      targetDirectory,
      environment: runtime.githubAuthorization.gitEnvironment()
    });
    runtime.stateStore.saveSyncConnection({ repositoryDirectory: targetDirectory, repositoryUrl: input.repositoryUrl });
    return runtime.syncRestores.preview(new SyncRepository(targetDirectory));
  });

  ipcMain.handle('sync:confirm-restore', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    return runtime.syncRestores.confirm(input.previewId);
  });

  ipcMain.handle('github:authorization-start', () => runtime.githubAuthorization.start());

  ipcMain.handle('github:authorization-poll', (_event, rawInput: unknown) => {
    const id = z.string().uuid().parse(rawInput);
    return runtime.githubAuthorization.poll(id);
  });

  ipcMain.handle('github:authorization-status', () => runtime.githubAuthorization.isConnected());

  ipcMain.handle('github:authorization-disconnect', () => runtime.githubAuthorization.disconnect());

  ipcMain.handle('groups:create', (_event, rawInput: unknown) => {
    const input = z.object({ name: groupNameSchema }).parse(rawInput);
    return runtime.skillControl.createGroup(input.name);
  });

  ipcMain.handle('groups:add-skill', (_event, rawInput: unknown) => {
    const input = z.object({ groupId: groupIdSchema, skillId: skillIdSchema }).parse(rawInput);
    return runtime.skillControl.addSkillToGroup(input.groupId, input.skillId);
  });

  ipcMain.handle('groups:remove-skill', (_event, rawInput: unknown) => {
    const input = z.object({ groupId: groupIdSchema, skillId: skillIdSchema }).parse(rawInput);
    return runtime.skillControl.removeSkillFromGroup(input.groupId, input.skillId);
  });

  ipcMain.handle('groups:rename', (_event, rawInput: unknown) => {
    const input = z.object({ groupId: groupIdSchema, name: groupNameSchema }).parse(rawInput);
    return runtime.skillControl.renameGroup(input.groupId, input.name);
  });

  ipcMain.handle('groups:delete-preview', (_event, rawInput: unknown) =>
    runtime.groupDeletions.preview(groupIdSchema.parse(rawInput))
  );

  ipcMain.handle('groups:delete-confirm', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    runtime.groupDeletions.confirm(input.previewId);
  });

  ipcMain.handle('groups:set-sync-participation', (_event, rawInput: unknown) => {
    const input = z.object({ groupId: groupIdSchema, participatesInSync: z.boolean() }).parse(rawInput);
    return runtime.skillControl.setGroupSyncParticipation(input.groupId, input.participatesInSync);
  });

  ipcMain.handle('agents:set-active-groups', (_event, rawInput: unknown) => {
    const input = z.object({ agent: agentSchema, groupIds: z.array(groupIdSchema) }).parse(rawInput);
    return runtime.skillControl.setActiveGroups(input.agent, input.groupIds);
  });

  ipcMain.handle('agents:set-active-groups-batch', (_event, rawInput: unknown) => {
    const input = z.object({ agents: z.array(agentSchema).min(1), groupIds: z.array(groupIdSchema) }).parse(rawInput);
    return runtime.skillControl.setActiveGroupsForAgents(input.agents, input.groupIds);
  });

  ipcMain.handle('agents:view', (_event, rawInput: unknown) => {
    const agent = agentSchema.parse(rawInput);
    return runtime.skillControl.getAgentSkillView(agent);
  });

  ipcMain.handle('agents:set-skill-override', (_event, rawInput: unknown) => {
    const input = z
      .object({
        agent: agentSchema,
        skillId: skillIdSchema,
        override: z.enum(['force-enable', 'force-disable']).nullable()
      })
      .parse(rawInput);
    return runtime.skillControl.setSkillOverride(input.agent, input.skillId, input.override ?? undefined);
  });

  ipcMain.handle('agents:verify-after-restart', async (_event, rawInput: unknown) => {
    const agent = agentSchema.parse(rawInput);
    await runtime.applyPlans.verifyAfterManualRestart(requireAdapter(runtime, agent));
  });

  ipcMain.handle('apply:preview', async (_event, rawInput: unknown) => {
    const agent = agentSchema.parse(rawInput);
    return runtime.applyPlans.preview(requireAdapter(runtime, agent));
  });

  ipcMain.handle('apply:confirm', (_event, rawInput: unknown) => {
    const input = z.object({ planId: z.string().uuid() }).parse(rawInput);
    return runtime.applyPlans.confirm(input.planId);
  });

  ipcMain.handle('apply:preview-batch', (_event, rawInput: unknown) => {
    const agents = z.array(agentSchema).min(1).parse(rawInput);
    const uniqueAgents = [...new Set(agents)];
    return runtime.batchApplies.preview(uniqueAgents.map((agent) => requireAdapter(runtime, agent)));
  });

  ipcMain.handle('apply:confirm-batch', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    return runtime.batchApplies.confirm(input.previewId);
  });

  ipcMain.handle('apply:preview-undo', (_event, rawInput: unknown) => {
    const agent = agentSchema.parse(rawInput);
    return runtime.applyPlans.previewUndo(requireAdapter(runtime, agent));
  });

  ipcMain.handle('apply:confirm-undo', (_event, rawInput: unknown) => {
    const input = z.object({ previewId: z.string().uuid() }).parse(rawInput);
    return runtime.applyPlans.confirmUndo(input.previewId);
  });
}

function requireAdapter(runtime: ApplicationRuntime, agent: AgentKind) {
  const adapter = runtime.adapters.find((candidate) => candidate.agent === agent);
  if (!adapter) {
    throw new Error(`Unsupported Agent: ${agent}`);
  }
  return adapter;
}

function syncRepositoryDirectoryName(repositoryUrl: string): string {
  const pathname = new URL(repositoryUrl).pathname;
  const name = basename(pathname).replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!name || name === '.' || name === '-') throw new Error('无法从同步仓库地址生成安全的本地目录名。');
  return `agent-baton-sync-${name}`;
}

async function saveSyncConnection(runtime: ApplicationRuntime, repositoryDirectory: string): Promise<void> {
  const originUrl = await new GitWorktree(repositoryDirectory).originUrl();
  if (!isGitHubHttpsRepositoryUrl(originUrl)) {
    throw new Error('同步仓库必须是 HTTPS github.com 地址；不会把 GitHub App 凭据发送给其他远端。');
  }
  runtime.stateStore.saveSyncConnection({ repositoryDirectory, repositoryUrl: originUrl });
}
