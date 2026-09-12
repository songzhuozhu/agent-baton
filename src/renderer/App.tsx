import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { AppToolbar } from './components/AppToolbar';
import { useThemePreference } from './hooks/use-theme-preference';
import type { AgentKind, ManagedSkill, SkillGroup } from '../shared/domain';
import type {
  AdoptionPreviewDto,
  AgentSkillViewDto,
  BatchApplyPreviewDto,
  BatchApplyResultDto,
  DashboardSnapshot,
  DiagnosticBundlePreviewDto,
  DeleteManagedSkillPreviewDto,
  DeleteGroupPreviewDto,
  GitHubAuthorizationStartDto,
  LibrarySnapshot,
  LocalErrorLogDto,
  ManualSyncPreviewDto,
  PreviewedApplyPlanDto,
  PreviewedApplyUndoDto,
  SyncRestorePreviewDto,
  SyncPolicyChangePreviewDto,
  SyncConnectionDto,
  UpstreamStatusDto,
  UpstreamUpdatePreviewDto
} from '../shared/ipc';
export function App(): ReactElement {
  const bridgeAvailable = typeof window.agentBaton !== 'undefined';
  const [dashboard, setDashboard] = useState<DashboardSnapshot>();
  const [library, setLibrary] = useState<LibrarySnapshot>();
  const [selectedAgent, setSelectedAgent] = useState<AgentKind>();
  const [agentView, setAgentView] = useState<AgentSkillViewDto>();
  const [adoptionPreview, setAdoptionPreview] = useState<AdoptionPreviewDto>();
  const [upstreamAdoptionOpen, setUpstreamAdoptionOpen] = useState(false);
  const [upstreamRepositoryUrl, setUpstreamRepositoryUrl] = useState('');
  const [upstreamRelativePath, setUpstreamRelativePath] = useState('');
  const [applyPreview, setApplyPreview] = useState<PreviewedApplyPlanDto>();
  const [undoPreview, setUndoPreview] = useState<PreviewedApplyUndoDto>();
  const [batchApplyPreview, setBatchApplyPreview] = useState<BatchApplyPreviewDto>();
  const [batchApplyResult, setBatchApplyResult] = useState<BatchApplyResultDto>();
  const [batchAssignmentOpen, setBatchAssignmentOpen] = useState(false);
  const [batchAgentIds, setBatchAgentIds] = useState<AgentKind[]>([]);
  const [batchGroupIds, setBatchGroupIds] = useState<string[]>([]);
  const [deletePreview, setDeletePreview] = useState<DeleteManagedSkillPreviewDto>();
  const [recoverableSkillId, setRecoverableSkillId] = useState<string>();
  const [upstreamStatuses, setUpstreamStatuses] = useState<Record<string, UpstreamStatusDto>>({});
  const [upstreamPreview, setUpstreamPreview] = useState<UpstreamUpdatePreviewDto>();
  const [diagnosticPreview, setDiagnosticPreview] = useState<DiagnosticBundlePreviewDto>();
  const [localErrorLogs, setLocalErrorLogs] = useState<LocalErrorLogDto[]>();
  const [syncPreview, setSyncPreview] = useState<ManualSyncPreviewDto>();
  const [syncConnection, setSyncConnection] = useState<SyncConnectionDto | null>(null);
  const [restorePreview, setRestorePreview] = useState<SyncRestorePreviewDto>();
  const [restoreConnectionOpen, setRestoreConnectionOpen] = useState(false);
  const [syncRepositoryUrl, setSyncRepositoryUrl] = useState('');
  const [deleteGroupPreview, setDeleteGroupPreview] = useState<DeleteGroupPreviewDto>();
  const [syncPolicyPreview, setSyncPolicyPreview] = useState<SyncPolicyChangePreviewDto>();
  const [githubAuthorization, setGithubAuthorization] = useState<GitHubAuthorizationStartDto>();
  const [githubConnected, setGithubConnected] = useState(false);
  const [tags, setTags] = useState('');
  const [userDescription, setUserDescription] = useState('');
  const [syncAllowed, setSyncAllowed] = useState(false);
  const [metadataSkill, setMetadataSkill] = useState<ManagedSkill>();
  const [metadataTags, setMetadataTags] = useState('');
  const [metadataDescription, setMetadataDescription] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryPolicyFilter, setLibraryPolicyFilter] = useState<'all' | 'local-only' | 'sync-allowed'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [theme, setTheme] = useThemePreference();

  const refresh = async (agent = selectedAgent): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const [nextDashboard, nextLibrary, nextGithubConnected, nextSyncConnection] = await Promise.all([
        window.agentBaton.dashboard.load(),
        window.agentBaton.library.load(),
        window.agentBaton.github.isConnected(),
        window.agentBaton.sync.connection()
      ]);
      setDashboard(nextDashboard);
      setLibrary(nextLibrary);
      setGithubConnected(nextGithubConnected);
      setSyncConnection(nextSyncConnection);
      if (agent) {
        setAgentView(await window.agentBaton.agents.view(agent));
      }
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (bridgeAvailable) {
      void refresh();
    }
  }, [bridgeAvailable]);

  useEffect(() => {
    if (bridgeAvailable && error) {
      // Logging must not turn an already handled application error into an unhandled rejection.
      void window.agentBaton.diagnostics.recordLocalError(error).catch(() => undefined);
    }
  }, [bridgeAvailable, error]);

  const selectAgent = async (agent: AgentKind): Promise<void> => {
    setSelectedAgent(agent);
    setBusy(true);
    try {
      setAgentView(await window.agentBaton.agents.view(agent));
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const chooseSkill = async (): Promise<void> => {
    try {
      const preview = await window.agentBaton.adoption.chooseAndPreview();
      if (preview) {
        openAdoptionPreview(preview);
      }
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const previewUpstreamAdoption = async (): Promise<void> => {
    if (!upstreamRepositoryUrl.trim()) {
      setError('请输入 GitHub 仓库 HTTPS 地址。');
      return;
    }
    setBusy(true);
    try {
      const preview = await window.agentBaton.adoption.previewUpstream(
        upstreamRepositoryUrl.trim(),
        upstreamRelativePath.trim()
      );
      setUpstreamAdoptionOpen(false);
      openAdoptionPreview(preview);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const chooseScanRoot = async (kind: 'custom' | 'project'): Promise<void> => {
    try {
      const root = await window.agentBaton.settings.chooseAndAddScanRoot(kind);
      if (root) await refresh();
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const openAdoptionPreview = (preview: AdoptionPreviewDto): void => {
    setTags('');
    setUserDescription('');
    setSyncAllowed(false);
    setAdoptionPreview(preview);
  };

  const confirmAdoption = async (): Promise<void> => {
    if (!adoptionPreview) return;
    setBusy(true);
    try {
      await window.agentBaton.adoption.confirm({
        previewId: adoptionPreview.id,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        userDescription,
        syncPolicy: syncAllowed ? 'sync-allowed' : 'local-only'
      });
      setAdoptionPreview(undefined);
      await refresh();
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async (): Promise<void> => {
    const name = window.prompt('Skill Group 名称');
    if (!name?.trim()) return;
    try {
      await window.agentBaton.groups.create(name);
      await refresh();
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const toggleActiveGroup = async (group: SkillGroup, active: boolean): Promise<void> => {
    if (!selectedAgent || !agentView) return;
    const groupIds = active
      ? [...agentView.desiredState.activeGroupIds, group.id]
      : agentView.desiredState.activeGroupIds.filter((id) => id !== group.id);
    try {
      await window.agentBaton.agents.setActiveGroups(selectedAgent, groupIds);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const setSkillOverride = async (skillId: string, value: '' | 'force-enable' | 'force-disable'): Promise<void> => {
    if (!selectedAgent) return;
    try {
      await window.agentBaton.agents.setSkillOverride(selectedAgent, skillId, value || null);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const previewApply = async (): Promise<void> => {
    if (!selectedAgent) return;
    try {
      setApplyPreview(await window.agentBaton.apply.preview(selectedAgent));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const verifyAfterRestart = async (): Promise<void> => {
    if (!selectedAgent) return;
    setBusy(true);
    try {
      await window.agentBaton.agents.verifyAfterRestart(selectedAgent);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmApply = async (): Promise<void> => {
    if (!applyPreview) return;
    setBusy(true);
    try {
      await window.agentBaton.apply.confirm(applyPreview.id);
      setApplyPreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewUndo = async (): Promise<void> => {
    if (!selectedAgent) return;
    try {
      setUndoPreview(await window.agentBaton.apply.previewUndo(selectedAgent));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const confirmUndo = async (): Promise<void> => {
    if (!undoPreview) return;
    setBusy(true);
    try {
      await window.agentBaton.apply.confirmUndo(undoPreview.id);
      setUndoPreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openBatchAssignment = (): void => {
    setBatchAgentIds(selectedAgent ? [selectedAgent] : []);
    setBatchGroupIds(selectedAgent && agentView ? agentView.desiredState.activeGroupIds : []);
    setBatchAssignmentOpen(true);
  };

  const toggleBatchAgent = (agent: AgentKind, checked: boolean): void => {
    setBatchAgentIds((current) => checked
      ? [...new Set([...current, agent])]
      : current.filter((candidate) => candidate !== agent));
  };

  const toggleBatchGroup = (groupId: string, checked: boolean): void => {
    setBatchGroupIds((current) => checked
      ? [...new Set([...current, groupId])]
      : current.filter((candidate) => candidate !== groupId));
  };

  const confirmBatchAssignment = async (): Promise<void> => {
    if (batchAgentIds.length === 0) {
      setError('请至少选择一个目标 Agent。');
      return;
    }
    setBusy(true);
    try {
      await window.agentBaton.agents.setActiveGroupsForAgents(batchAgentIds, batchGroupIds);
      setBatchAssignmentOpen(false);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewBatchApply = async (): Promise<void> => {
    if (batchAgentIds.length === 0) {
      setError('先使用“批量分配分组”选择需要应用的 Agent。');
      return;
    }
    try {
      setBatchApplyResult(undefined);
      setBatchApplyPreview(await window.agentBaton.apply.previewBatch(batchAgentIds));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const confirmBatchApply = async (): Promise<void> => {
    if (!batchApplyPreview) return;
    setBusy(true);
    try {
      setBatchApplyResult(await window.agentBaton.apply.confirmBatch(batchApplyPreview.id));
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewDelete = async (skillId: string): Promise<void> => {
    try {
      setDeletePreview(await window.agentBaton.skills.previewDelete(skillId));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deletePreview) return;
    setBusy(true);
    try {
      await window.agentBaton.skills.confirmDelete(deletePreview.id);
      setRecoverableSkillId(deletePreview.skill.id);
      setDeletePreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const restoreDeletedSkill = async (): Promise<void> => {
    if (!recoverableSkillId) return;
    setBusy(true);
    try {
      await window.agentBaton.skills.restore(recoverableSkillId);
      setRecoverableSkillId(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const checkUpstream = async (skillId: string): Promise<void> => {
    try {
      const status = await window.agentBaton.upstream.check(skillId);
      setUpstreamStatuses((current) => ({ ...current, [skillId]: status }));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const previewUpstreamUpdate = async (skillId: string): Promise<void> => {
    try {
      setUpstreamPreview(await window.agentBaton.upstream.previewUpdate(skillId));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const previewDiscardForkAndUpdate = async (skillId: string): Promise<void> => {
    try {
      setUpstreamPreview(await window.agentBaton.upstream.previewDiscardLocalForkAndUpdate(skillId));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const confirmUpstreamUpdate = async (): Promise<void> => {
    if (!upstreamPreview) return;
    setBusy(true);
    try {
      await window.agentBaton.upstream.confirmUpdate(upstreamPreview.id);
      setUpstreamPreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewDiagnostics = async (): Promise<void> => {
    try {
      setDiagnosticPreview(await window.agentBaton.diagnostics.preview());
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const generateDiagnostics = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.agentBaton.diagnostics.chooseAndGenerate();
      setDiagnosticPreview(undefined);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const showLocalErrors = async (): Promise<void> => {
    try {
      setLocalErrorLogs(await window.agentBaton.diagnostics.listLocalErrors());
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const clearLocalErrors = async (): Promise<void> => {
    try {
      await window.agentBaton.diagnostics.clearLocalErrors();
      setLocalErrorLogs([]);
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const previewSyncPush = async (): Promise<void> => {
    try {
      const preview = syncConnection
        ? await window.agentBaton.sync.previewSavedPush()
        : await window.agentBaton.sync.chooseAndPreviewPush();
      if (preview) setSyncPreview(preview);
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const clearSyncConnection = async (): Promise<void> => {
    try {
      await window.agentBaton.sync.clearConnection();
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const confirmSyncPush = async (): Promise<void> => {
    if (!syncPreview) return;
    setBusy(true);
    try {
      await window.agentBaton.sync.confirmPush(syncPreview.id);
      setSyncPreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewSyncRestore = async (): Promise<void> => {
    try {
      const preview = await window.agentBaton.sync.chooseAndPreviewRestore();
      if (preview) setRestorePreview(preview);
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const cloneAndPreviewRestore = async (): Promise<void> => {
    if (!syncRepositoryUrl.trim()) {
      setError('请输入 GitHub 同步仓库 HTTPS 地址。');
      return;
    }
    setBusy(true);
    try {
      const preview = await window.agentBaton.sync.cloneAndPreviewRestore(syncRepositoryUrl.trim());
      if (preview) {
        setRestoreConnectionOpen(false);
        setRestorePreview(preview);
      }
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmSyncRestore = async (): Promise<void> => {
    if (!restorePreview) return;
    setBusy(true);
    try {
      await window.agentBaton.sync.confirmRestore(restorePreview.id);
      setRestorePreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const renameGroup = async (group: SkillGroup): Promise<void> => {
    const name = window.prompt('新的 Skill Group 名称', group.name);
    if (!name?.trim()) return;
    try {
      await window.agentBaton.groups.rename(group.id, name);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const previewDeleteGroup = async (groupId: string): Promise<void> => {
    try {
      setDeleteGroupPreview(await window.agentBaton.groups.previewDelete(groupId));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const confirmDeleteGroup = async (): Promise<void> => {
    if (!deleteGroupPreview) return;
    setBusy(true);
    try {
      await window.agentBaton.groups.confirmDelete(deleteGroupPreview.id);
      setDeleteGroupPreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewSyncPolicyChange = async (skillId: string, nextPolicy: 'local-only' | 'sync-allowed'): Promise<void> => {
    try {
      setSyncPolicyPreview(await window.agentBaton.skills.previewSyncPolicy(skillId, nextPolicy));
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const confirmSyncPolicyChange = async (): Promise<void> => {
    if (!syncPolicyPreview) return;
    setBusy(true);
    try {
      await window.agentBaton.skills.confirmSyncPolicy(syncPolicyPreview.id);
      setSyncPolicyPreview(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openMetadataEditor = (skill: ManagedSkill): void => {
    setMetadataSkill(skill);
    setMetadataTags(skill.tags.join(', '));
    setMetadataDescription(skill.userDescription ?? '');
  };

  const confirmMetadataEdit = async (): Promise<void> => {
    if (!metadataSkill) return;
    setBusy(true);
    try {
      await window.agentBaton.skills.updateMetadata(metadataSkill.id, {
        tags: metadataTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        userDescription: metadataDescription
      });
      setMetadataSkill(undefined);
      await refresh(selectedAgent);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const startGitHubAuthorization = async (): Promise<void> => {
    try {
      setGithubAuthorization(await window.agentBaton.github.startAuthorization());
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  const pollGitHubAuthorization = async (): Promise<void> => {
    if (!githubAuthorization) return;
    try {
      const result = await window.agentBaton.github.pollAuthorization(githubAuthorization.id);
      if (result.status === 'authorized') {
        setGithubConnected(true);
        setGithubAuthorization(undefined);
      } else if (result.status === 'denied' || result.status === 'expired') {
        setGithubAuthorization(undefined);
        setError(result.status === 'denied' ? 'GitHub 授权被拒绝。' : 'GitHub 授权已过期，请重新开始。');
      }
    } catch (reason) {
      setError(toMessage(reason));
    }
  };

  if (!bridgeAvailable) {
    return <main className="fatal-startup" role="alert">
      <section>
        <p className="eyebrow">AGENTBATON</p>
        <h1>无法连接桌面服务</h1>
        <p>应用的本机安全桥接没有加载。请关闭后重新打开 AgentBaton；若问题持续，请记录此提示并反馈。</p>
      </section>
    </main>;
  }

  if (!dashboard || !library) {
    if (error) {
      return <main className="fatal-startup" role="alert">
        <section>
          <p className="eyebrow">AGENTBATON</p>
          <h1>无法读取本机状态</h1>
          <p>{error}</p>
          <div className="modal-actions">
            <button className="primary" onClick={() => void refresh()}>重新读取</button>
          </div>
        </section>
      </main>;
    }
    return <main className="loading" role="status">正在读取本机 Agent 状态…</main>;
  }

  const activeAgent = dashboard.agents.find((agent) => agent.id === selectedAgent);
  const normalizedSearch = librarySearch.trim().toLocaleLowerCase();
  const visibleSkills = library.skills.filter((skill) => {
    const matchesSearch = !normalizedSearch || [skill.name, skill.originalDescription, skill.userDescription ?? '', ...skill.tags]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    return matchesSearch && (libraryPolicyFilter === 'all' || skill.syncPolicy === libraryPolicyFilter);
  });
  return (
    <main className="app-shell">
      <AppToolbar
        theme={theme}
        onThemeChange={setTheme}
        onRefresh={() => void refresh()}
        onAdopt={() => void chooseSkill()}
        groups={[
          { label: '扫描范围', actions: [
            { label: '添加扫描目录', onSelect: () => void chooseScanRoot('custom') },
            { label: '添加项目根目录', onSelect: () => void chooseScanRoot('project') }
          ] },
          { label: '同步与来源', actions: [
            { label: githubConnected ? 'GitHub 已连接' : '连接 GitHub', onSelect: () => void startGitHubAuthorization() },
            { label: '从 Git 恢复', onSelect: () => setRestoreConnectionOpen(true) },
            { label: '同步到 Git', onSelect: () => void previewSyncPush() },
            { label: '从 Git 纳管', onSelect: () => setUpstreamAdoptionOpen(true) }
          ] },
          { label: '维护', actions: [
            { label: '生成诊断包', onSelect: () => void previewDiagnostics() },
            { label: '查看本机错误', onSelect: () => void showLocalErrors() }
          ] }
        ]}
      />

      {error && <p className="error-banner" role="alert">{error}</p>}
      {syncConnection && <p className="sync-connection">同步仓库：<span className="mono">{syncConnection.repositoryUrl}</span><button className="text-button" onClick={() => void clearSyncConnection()}>断开本机连接</button></p>}
      {recoverableSkillId && <p className="notice-banner">Skill 已移入本地回收站，30 天内可恢复。<button className="text-button" onClick={() => void restoreDeletedSkill()}>立即恢复</button></p>}
      {library.customScanRoots.length > 0 && <section className="scan-roots" aria-label="自定义扫描目录">{library.customScanRoots.map((root) => <span key={root.path}><span className="mono">{root.path}</span><button className="text-button" onClick={() => void window.agentBaton.settings.removeScanRoot(root.path).then(() => refresh())}>移除</button></span>)}</section>}

      <section className="attention" aria-label="待处理事项">
        <div>
          <p className="eyebrow">待处理</p>
          <h2>{busy ? '正在处理…' : '让每个 Agent 只带需要的 Skill'}</h2>
          <p>所有本机修改都会先生成 Apply Plan；扫描和预览不会执行或改写 Skill 内容。</p>
        </div>
        <dl>
          <div><dt>待应用</dt><dd>{dashboard.pendingApplyCount}</dd></div>
          <div><dt>待同步</dt><dd>{dashboard.pendingSyncCount}</dd></div>
          <div><dt>上游更新</dt><dd>{dashboard.upstreamUpdateCount}</dd></div>
        </dl>
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">你的 Agent</p>
          <h2>当前状态</h2>
        </div>
        <button className="secondary" onClick={() => void createGroup()}>新建分组</button>
      </section>

      <section className="agent-grid" aria-label="Agent 列表">
        {dashboard.agents.map((agent) => {
          const hasPendingChange = agent.currentEnabledCount !== agent.desiredEnabledCount;
          return (
            <article className={`agent-card ${selectedAgent === agent.id ? 'selected' : ''}`} key={agent.id}>
              <div className="card-header">
                <h3>{agent.name}</h3>
                <span className={`status status-${agent.status}`}>{statusLabel(agent.status)}</span>
              </div>
              <p className="count">
                {agent.status === 'not-detected' || agent.status === 'unsupported-platform'
                  ? '查看支持情况'
                  : hasPendingChange
                    ? `${agent.currentEnabledCount} → ${agent.desiredEnabledCount}`
                    : `${agent.currentEnabledCount} 个已启用 Skill`}
              </p>
              <p className="card-copy">
                {agent.status === 'unsupported-platform'
                  ? '当前平台没有官方客户端支持证据，不会尝试写入配置。'
                  : agent.restartRequired
                    ? '配置已写入，等待手动重启后验证。'
                    : hasPendingChange
                      ? '已保存新的期望状态，尚未修改 Agent。'
                      : '选择分组后可预览实际变更。'}
              </p>
              <button className="card-action" onClick={() => void selectAgent(agent.id as AgentKind)}>
                {selectedAgent === agent.id ? '正在查看' : '查看 Agent'}
              </button>
            </article>
          );
        })}
      </section>

      {activeAgent && agentView && (
        <section className="detail-panel" aria-label={`${activeAgent.name} 配置`}>
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">{activeAgent.name}</p>
              <h2>分组与有效 Skill</h2>
            </div>
            <span className="detail-actions"><button className="secondary" disabled={activeAgent.status !== 'detected'} onClick={() => void previewUndo()}>撤销最近应用</button><button className="primary" disabled={activeAgent.status !== 'detected'} onClick={() => void previewApply()}>预览并应用</button></span>
          </div>
          {activeAgent.restartRequired && <p className="notice-banner">请在目标 Agent 中手动重启，然后重新扫描确认。<button className="text-button" onClick={() => void verifyAfterRestart()}>我已重启，验证状态</button></p>}
          <p className="detail-copy">
            当前有效集合：{agentView.effectiveSkillIds.length} 个托管 Skill。外部发现的 Skill 不会被删除或改写。
          </p>
          <div className="batch-actions">
            <div><strong>批量场景切换</strong><small>把相同分组赋给多个 Agent，再分别预览每个 Agent 的写入。</small></div>
            <span><button className="secondary" onClick={openBatchAssignment}>批量分配分组</button><button className="secondary" disabled={batchAgentIds.length === 0} onClick={() => void previewBatchApply()}>预览批量应用{batchAgentIds.length ? `（${batchAgentIds.length}）` : ''}</button></span>
          </div>
          <div className="group-list">
            {library.groups.length === 0 && <p className="empty-copy">还没有分组。先纳管 Skill，再创建一个场景分组。</p>}
            {library.groups.map((group) => {
              const active = agentView.desiredState.activeGroupIds.includes(group.id);
              return (
                <div className="group-row" key={group.id}>
                  <label>
                    <input type="checkbox" checked={active} onChange={(event) => void toggleActiveGroup(group, event.target.checked)} />
                    <span><strong>{group.name}</strong><small>{group.skillIds.length} 个 Skill · {group.participatesInSync ? '参与同步' : '仅本地分组'}</small></span>
                  </label>
                  <span className="group-actions"><button className="text-button" onClick={() => void window.agentBaton.groups.setSyncParticipation(group.id, !group.participatesInSync).then(() => refresh(selectedAgent))}>{group.participatesInSync ? '停止同步' : '参与同步'}</button><button className="text-button" onClick={() => void renameGroup(group)}>重命名</button><button className="text-button" onClick={() => void previewDeleteGroup(group.id)}>删除</button></span>
                </div>
              );
            })}
          </div>
          {library.skills.length > 0 && <div className="override-list"><p className="eyebrow">单 Skill 覆盖</p>{library.skills.map((skill) => <label key={skill.id}><span>{skill.name}</span><select value={agentView.desiredState.overrides[skill.id] ?? ''} onChange={(event) => void setSkillOverride(skill.id, event.target.value as '' | 'force-enable' | 'force-disable')}><option value="">跟随分组</option><option value="force-enable">强制启用</option><option value="force-disable">强制禁用</option></select></label>)}</div>}
        </section>
      )}

      <section className="library-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Skill 库</p>
            <h2>托管 {library.skills.length} · 发现 {library.discovered.length + library.customDiscovered.length}</h2>
          </div>
        </div>
        <div className="library-filters" role="search">
          <label>搜索 Skill、Tag 或描述<input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="例如：设计、视频、内部" /></label>
          <label>同步策略<select value={libraryPolicyFilter} onChange={(event) => setLibraryPolicyFilter(event.target.value as typeof libraryPolicyFilter)}><option value="all">全部</option><option value="local-only">Local Only</option><option value="sync-allowed">Sync Allowed</option></select></label>
        </div>
        <div className="skill-grid">
          {visibleSkills.map((skill) => (
            <article className="skill-card" key={skill.id}>
              <div className="card-header"><h3>{skill.name}</h3><span className="policy">{skill.syncPolicy === 'local-only' ? 'Local Only' : 'Sync Allowed'}</span></div>
              <p>{skill.userDescription || skill.originalDescription || '没有描述。'}</p>
              <small>{skill.tags.length ? skill.tags.join(' · ') : '无 Tag'}</small>
              <small>来源：{sourceLabel(skill)}</small>
              <div className="membership-actions"><button className="text-button" onClick={() => openMetadataEditor(skill)}>编辑描述和 Tag</button><button className="text-button" onClick={() => void previewSyncPolicyChange(skill.id, skill.syncPolicy === 'local-only' ? 'sync-allowed' : 'local-only')}>{skill.syncPolicy === 'local-only' ? '允许同步' : '改为 Local Only'}</button></div>
              {library.groups.length > 0 && (
                <div className="membership-actions">
                  {library.groups.map((group) => (
                    <button
                      className="text-button"
                      key={group.id}
                      onClick={() => void (group.skillIds.includes(skill.id)
                        ? window.agentBaton.groups.removeSkill(group.id, skill.id)
                        : window.agentBaton.groups.addSkill(group.id, skill.id)).then(() => refresh())}
                    >
                      {group.skillIds.includes(skill.id) ? `移出 ${group.name}` : `加入 ${group.name}`}
                    </button>
                  ))}
                </div>
              )}
              {skill.source.kind === 'upstream' && (
                <div className="membership-actions">
                  <button className="text-button" onClick={() => void checkUpstream(skill.id)}>检查上游</button>
                  {upstreamStatuses[skill.id]?.kind === 'update-available' && <button className="text-button" onClick={() => void previewUpstreamUpdate(skill.id)}>预览更新</button>}
                  {upstreamStatuses[skill.id]?.kind === 'forked' && <button className="text-button" onClick={() => void previewDiscardForkAndUpdate(skill.id)}>丢弃本地分叉并预览更新</button>}
                  {upstreamStatuses[skill.id] && <small>上游：{upstreamLabel(upstreamStatuses[skill.id])}</small>}
                </div>
              )}
              <button className="danger-button" onClick={() => void previewDelete(skill.id)}>删除托管 Skill</button>
            </article>
          ))}
          {library.discovered.map((skill) => (
            <article className="skill-card discovered" key={`${skill.agent}:${skill.sourcePath}`}>
              <div className="card-header"><h3>{skill.skillName}</h3><span className="policy">发现于 {skill.agent}</span></div>
              <p>{skill.originalDescription || 'Skill 未提供描述。'}</p>
              <small>{skill.risks.length ? `风险内容 ${skill.risks.length} 项` : '未检测到风险内容'}</small>
              <button className="text-button" onClick={() => void window.agentBaton.adoption.previewPath(skill.sourcePath).then(openAdoptionPreview).catch((reason) => setError(toMessage(reason)))}>
                查看并纳管
              </button>
            </article>
          ))}
          {library.customDiscovered.map((skill) => (
            <article className="skill-card discovered" key={`custom:${skill.sourcePath}`}>
              <div className="card-header"><h3>{skill.skillName}</h3><span className="policy">{skill.scope === 'project' ? '项目发现' : '自定义目录'}</span></div>
              <p>{skill.originalDescription || 'Skill 未提供描述。'}</p>
              <small>{skill.risks.length ? `风险内容 ${skill.risks.length} 项` : '未检测到风险内容'}</small>
              <button className="text-button" onClick={() => void window.agentBaton.adoption.previewPath(skill.sourcePath).then(openAdoptionPreview).catch((reason) => setError(toMessage(reason)))}>查看并纳管</button>
            </article>
          ))}
          {visibleSkills.length === 0 && library.skills.length > 0 && <p className="empty-copy">没有符合筛选条件的托管 Skill。</p>}
        </div>
      </section>

      {adoptionPreview && (
        <Modal title={`纳管 ${adoptionPreview.name}`} onClose={() => setAdoptionPreview(undefined)}>
          <p>将创建独立规范副本。原始目录不会被修改，默认不会同步到 GitHub。</p>
          <p className="mono">{adoptionPreview.sourceDirectory}</p>
          {adoptionPreview.sourceKind === 'upstream' && adoptionPreview.upstream && <p>上游：<span className="mono">{adoptionPreview.upstream.repositoryUrl} · {adoptionPreview.upstream.relativePath || '.'} · {adoptionPreview.upstream.baselineCommit}</span></p>}
          <p>风险内容：{adoptionPreview.risks.length ? adoptionPreview.risks.map((risk) => risk.relativePath).join('、') : '未检测到'}</p>
          {adoptionPreview.possibleDuplicates.length > 0 && <p className="warning">可能存在重复项：{adoptionPreview.possibleDuplicates.map((skill) => `${skill.name}（${skill.reason === 'same-content' ? '内容相同' : '名称相同'}）`).join('、')}。这只是提示，不会自动合并或删除。</p>}
          <label>Tag（逗号分隔）<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <label>用户描述<textarea value={userDescription} onChange={(event) => setUserDescription(event.target.value)} /></label>
          <label className="checkbox-line"><input type="checkbox" checked={syncAllowed} onChange={(event) => setSyncAllowed(event.target.checked)} />允许同步到参与同步的分组</label>
          <div className="modal-actions"><button className="secondary" onClick={() => setAdoptionPreview(undefined)}>取消</button><button className="primary" onClick={() => void confirmAdoption()}>确认纳管</button></div>
        </Modal>
      )}

      {upstreamAdoptionOpen && (
        <Modal title="从 Git 上游纳管 Skill" onClose={() => setUpstreamAdoptionOpen(false)}>
          <p>仓库会先克隆到隔离暂存目录并进行只读检查；确认前不会写入托管库或 Agent。私有仓库需要后续完成 GitHub App 授权与 Git 传输配置。</p>
          <label>GitHub 仓库 HTTPS 地址<input value={upstreamRepositoryUrl} onChange={(event) => setUpstreamRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" /></label>
          <label>Skill 相对路径（根目录留空）<input value={upstreamRelativePath} onChange={(event) => setUpstreamRelativePath(event.target.value)} placeholder="skills/ui-polish" /></label>
          <div className="modal-actions"><button className="secondary" onClick={() => setUpstreamAdoptionOpen(false)}>取消</button><button className="primary" onClick={() => void previewUpstreamAdoption()}>在隔离目录预览</button></div>
        </Modal>
      )}

      {applyPreview && (
        <Modal title={`${applyPreview.plan.agent} 的 Apply Plan`} onClose={() => setApplyPreview(undefined)}>
          <p>此计划在 {new Date(applyPreview.expiresAt).toLocaleTimeString()} 前有效。确认前不会写入文件。</p>
          <ul className="operation-list">
            {applyPreview.plan.operations.map((operation) => <li key={`${operation.kind}:${operation.targetDirectory}`}>{operation.kind === 'deploy' ? '部署或刷新' : '卸载'}：{operation.targetDirectory}</li>)}
          </ul>
          {applyPreview.plan.blockedExternalInstallationPaths.length > 0 && <p className="warning">{applyPreview.plan.blockedExternalInstallationPaths.length} 个外部 Installation 不会被修改。</p>}
          <div className="modal-actions"><button className="secondary" onClick={() => setApplyPreview(undefined)}>返回</button><button className="primary" onClick={() => void confirmApply()}>确认并应用</button></div>
        </Modal>
      )}

      {batchAssignmentOpen && (
        <Modal title="批量分配 Skill Group" onClose={() => setBatchAssignmentOpen(false)}>
          <p>这会替换所选 Agent 当前启用的分组；不会向任何 Agent 写入文件。确认后仍需逐项预览并应用。</p>
          <fieldset className="batch-selection"><legend>目标 Agent</legend>{dashboard.agents.map((agent) => <label className="checkbox-line" key={agent.id}><input type="checkbox" checked={batchAgentIds.includes(agent.id as AgentKind)} onChange={(event) => toggleBatchAgent(agent.id as AgentKind, event.target.checked)} />{agent.name} · {statusLabel(agent.status)}</label>)}</fieldset>
          <fieldset className="batch-selection"><legend>启用的分组</legend>{library.groups.length === 0 ? <p className="empty-copy">还没有可分配的分组。</p> : library.groups.map((group) => <label className="checkbox-line" key={group.id}><input type="checkbox" checked={batchGroupIds.includes(group.id)} onChange={(event) => toggleBatchGroup(group.id, event.target.checked)} />{group.name} · {group.skillIds.length} 个 Skill</label>)}</fieldset>
          <div className="modal-actions"><button className="secondary" onClick={() => setBatchAssignmentOpen(false)}>取消</button><button className="primary" disabled={batchAgentIds.length === 0} onClick={() => void confirmBatchAssignment()}>保存期望状态</button></div>
        </Modal>
      )}

      {undoPreview && (
        <Modal title={`撤销 ${undoPreview.agent} 最近应用`} onClose={() => setUndoPreview(undefined)}>
          <p>将撤销最近一次成功应用中的 {undoPreview.operationCount} 项托管 Installation 变更。确认前已检查当前 Installation 和备份；若其后出现外部修改，会安全中止。</p>
          <p>{undoPreview.summary}</p>
          <p>此操作只撤销 Agent 的本机 Installation，不会改写分组和期望状态；随后可能需要再次应用或手动重启 Agent。</p>
          <div className="modal-actions"><button className="secondary" onClick={() => setUndoPreview(undefined)}>取消</button><button className="danger-button" onClick={() => void confirmUndo()}>确认撤销</button></div>
        </Modal>
      )}

      {batchApplyPreview && (
        <Modal title="批量 Apply Plan" onClose={() => { setBatchApplyPreview(undefined); setBatchApplyResult(undefined); }}>
          {!batchApplyResult && <><p>每个 Agent 的写入独立执行：一个失败不会回滚另一个成功的 Agent。此批计划在 {new Date(batchApplyPreview.expiresAt).toLocaleTimeString()} 前有效。</p>
          <ul className="operation-list">{batchApplyPreview.plans.map((plan) => <li key={plan.id}>{plan.plan.agent}：{plan.plan.operations.length} 项托管 Installation 变更</li>)}</ul>
          {batchApplyPreview.failures.length > 0 && <p className="warning">无法生成计划：{batchApplyPreview.failures.map((failure) => `${failure.agent}（${failure.detail}）`).join('；')}</p>}
          <div className="modal-actions"><button className="secondary" onClick={() => setBatchApplyPreview(undefined)}>取消</button><button className="primary" disabled={batchApplyPreview.plans.length === 0} onClick={() => void confirmBatchApply()}>确认分别应用</button></div></>}
          {batchApplyResult && <><p>批量执行已经结束。可只对失败的 Agent 重新预览并重试。</p><ul className="operation-list">{batchApplyResult.results.map((result) => <li key={result.agent}>{result.agent}：{result.status === 'succeeded' ? `成功，${result.appliedOperationCount} 项变更` : `失败，${result.detail}`}</li>)}</ul><div className="modal-actions"><button className="primary" onClick={() => { setBatchApplyPreview(undefined); setBatchApplyResult(undefined); }}>完成</button></div></>}
        </Modal>
      )}

      {deletePreview && (
        <Modal title={`删除 ${deletePreview.skill.name}`} onClose={() => setDeletePreview(undefined)}>
          <p>将从托管库、{deletePreview.affectedGroupIds.length} 个分组和 {deletePreview.affectedOverrides.length} 个单 Skill 覆盖中移除；内容会进入本地回收站保留 30 天。</p>
          {deletePreview.managedInstallationCount > 0 && <p className="warning">已有 {deletePreview.managedInstallationCount} 个已部署 Installation 保留在 Agent 中，需要在对应 Agent 的 Apply Plan 中单独卸载。</p>}
          {deletePreview.skill.syncPolicy === 'sync-allowed' && <p>同步仓库会在下一次手动同步时收到删除墓碑；Git 历史不会自动清除旧内容。</p>}
          <div className="modal-actions"><button className="secondary" onClick={() => setDeletePreview(undefined)}>取消</button><button className="danger-button" onClick={() => void confirmDelete()}>确认删除</button></div>
        </Modal>
      )}

      {upstreamPreview && (
        <Modal title="预览上游更新" onClose={() => setUpstreamPreview(undefined)}>
          <p>候选内容仍在隔离暂存区；确认只更新托管库并保留旧版本备份，之后需要另行生成 Apply Plan。</p>
          {upstreamPreview.discardLocalFork && <p className="warning">你选择了放弃本地分叉。确认后当前规范副本会被替换，但本地分叉内容会先保存为可恢复的版本备份。</p>}
          <p>远端 Commit：<span className="mono">{upstreamPreview.remoteCommit}</span></p>
          <p>风险内容：{upstreamPreview.risks} 项</p>
          <ul className="operation-list">{upstreamPreview.changedFiles.map((file) => <li key={file.path}>{changeLabel(file.change)}：{file.path}</li>)}</ul>
          <div className="modal-actions"><button className="secondary" onClick={() => setUpstreamPreview(undefined)}>取消</button><button className="primary" onClick={() => void confirmUpstreamUpdate()}>确认更新托管库</button></div>
        </Modal>
      )}

      {diagnosticPreview && (
        <Modal title="生成诊断包" onClose={() => setDiagnosticPreview(undefined)}>
          <p>诊断包只保存在本机，不会自动上传。</p>
          <p>将生成：{diagnosticPreview.files.join('、')}</p>
          <p>默认排除：{diagnosticPreview.exclusions.join('、')}</p>
          <div className="modal-actions"><button className="secondary" onClick={() => setDiagnosticPreview(undefined)}>取消</button><button className="primary" onClick={() => void generateDiagnostics()}>选择位置并生成</button></div>
        </Modal>
      )}

      {localErrorLogs && (
        <Modal title="本机错误日志" onClose={() => setLocalErrorLogs(undefined)}>
          <p>日志只保存在当前设备，凭据文本会被脱敏；默认诊断包不包含这些原始错误信息。</p>
          {localErrorLogs.length === 0 ? <p className="empty-copy">没有已记录的错误。</p> : <ul className="operation-list">{localErrorLogs.map((entry) => <li key={entry.id}><span className="mono">{new Date(entry.createdAt).toLocaleString()}</span><br />{entry.message}</li>)}</ul>}
          <div className="modal-actions"><button className="secondary" onClick={() => void clearLocalErrors()}>清空本机日志</button><button className="primary" onClick={() => setLocalErrorLogs(undefined)}>完成</button></div>
        </Modal>
      )}

      {syncPreview && (
        <Modal title="同步到 Git" onClose={() => setSyncPreview(undefined)}>
          <p>将同步 {syncPreview.portableSkillCount} 个允许同步的 Skill、{syncPreview.groupCount} 个分组、{syncPreview.desiredAgentStateCount} 个 Agent 期望状态和 {syncPreview.tombstoneCount} 个删除墓碑。</p>
          <p className="warning">{syncPreview.localOnlySkillCount} 个 Local Only Skill 被明确排除，既不会写入此次快照，也不会提交到 Git。</p>
          <p>远端关系：{remoteRelationLabel(syncPreview.remoteRelation)}</p>
          {syncPreview.existingPortableChanges.length > 0 && <p>工作树已有变更：{syncPreview.existingPortableChanges.join('、')}</p>}
          {syncPreview.conflicts.length > 0 && <p className="warning">检测到跨设备冲突：{syncPreview.conflicts.join('；')}</p>}
          {syncPreview.reconciliationRequired && <p className="warning">为了避免覆盖当前工作树或远端状态，此次同步已被安全阻止。先在同步仓库中完成协调或恢复，再重新预览。</p>}
          <div className="modal-actions"><button className="secondary" onClick={() => setSyncPreview(undefined)}>取消</button><button className="primary" disabled={!canPush(syncPreview.remoteRelation) || syncPreview.reconciliationRequired} onClick={() => void confirmSyncPush()}>确认提交并推送</button></div>
        </Modal>
      )}

      {restorePreview && (
        <Modal title="从 Git 恢复" onClose={() => setRestorePreview(undefined)}>
          <p>将恢复 {restorePreview.incomingSkillCount} 个托管 Skill、{restorePreview.incomingGroupCount} 个分组与 {restorePreview.incomingAgentStateCount} 个 Agent 期望状态。不会自动安装到本机 Agent。</p>
          {restorePreview.conflicts.length > 0 && <p className="warning">检测到冲突：{restorePreview.conflicts.join('；')}</p>}
          <div className="modal-actions"><button className="secondary" onClick={() => setRestorePreview(undefined)}>取消</button><button className="primary" disabled={restorePreview.conflicts.length > 0} onClick={() => void confirmSyncRestore()}>确认恢复期望状态</button></div>
        </Modal>
      )}

      {restoreConnectionOpen && (
        <Modal title="从 Git 同步仓库恢复" onClose={() => setRestoreConnectionOpen(false)}>
          <p>输入你的 AgentBaton 专用 GitHub 仓库地址后，选择本地存放位置。应用只会克隆仓库、恢复托管库和期望状态；不会自动安装到 Agent。</p>
          {syncConnection && <p>当前本机已连接：<span className="mono">{syncConnection.repositoryUrl}</span></p>}
          <label>GitHub 仓库 HTTPS 地址<input value={syncRepositoryUrl} onChange={(event) => setSyncRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/agent-baton-sync.git" /></label>
          <p>私有仓库需要先完成 GitHub App 授权。也可以从一个已克隆的本地工作树恢复。</p>
          <div className="modal-actions"><button className="secondary" onClick={() => { setRestoreConnectionOpen(false); void previewSyncRestore(); }}>选择已有工作树</button><button className="primary" onClick={() => void cloneAndPreviewRestore()}>选择位置并克隆</button></div>
        </Modal>
      )}

      {deleteGroupPreview && (
        <Modal title={`删除分组 ${deleteGroupPreview.group.name}`} onClose={() => setDeleteGroupPreview(undefined)}>
          <p>将移除这个逻辑分组，不会删除其中的托管 Skill。{deleteGroupPreview.affectedSkillCount} 个 Skill 会失去该成员关系。</p>
          <p>受影响 Agent：{deleteGroupPreview.affectedAgents.length ? deleteGroupPreview.affectedAgents.join('、') : '无'}；这些 Agent 会停止启用此分组。</p>
          <div className="modal-actions"><button className="secondary" onClick={() => setDeleteGroupPreview(undefined)}>取消</button><button className="danger-button" onClick={() => void confirmDeleteGroup()}>确认删除分组</button></div>
        </Modal>
      )}

      {syncPolicyPreview && (
        <Modal title="修改同步策略" onClose={() => setSyncPolicyPreview(undefined)}>
          <p>将 <strong>{syncPolicyPreview.skill.name}</strong> 设为 {syncPolicyPreview.nextPolicy === 'local-only' ? 'Local Only' : 'Sync Allowed'}。</p>
          <p>受影响的参与同步分组：{syncPolicyPreview.affectedSyncGroupIds.length ? syncPolicyPreview.affectedSyncGroupIds.join('、') : '无'}。</p>
          {syncPolicyPreview.historyWarning && <p className="warning">确认后该 Skill 会从当前和未来同步快照移除；现有 Git 历史可能仍保留旧内容，V1 不会改写历史。</p>}
          <div className="modal-actions"><button className="secondary" onClick={() => setSyncPolicyPreview(undefined)}>取消</button><button className="primary" onClick={() => void confirmSyncPolicyChange()}>确认修改</button></div>
        </Modal>
      )}

      {metadataSkill && (
        <Modal title={`编辑 ${metadataSkill.name} 的本地资料`} onClose={() => setMetadataSkill(undefined)}>
          <p>这些信息只保存在 AgentBaton 元数据中；不会写回 SKILL.md，也不会影响 Agent 的触发逻辑。</p>
          <label>Tag（逗号分隔）<input value={metadataTags} onChange={(event) => setMetadataTags(event.target.value)} /></label>
          <label>用户描述<textarea value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} /></label>
          <p>原始描述：{metadataSkill.originalDescription || 'Skill 未提供描述。'}</p>
          <div className="modal-actions"><button className="secondary" onClick={() => setMetadataSkill(undefined)}>取消</button><button className="primary" onClick={() => void confirmMetadataEdit()}>保存本地资料</button></div>
        </Modal>
      )}

      {githubAuthorization && (
        <Modal title="连接 GitHub" onClose={() => setGithubAuthorization(undefined)}>
          <p>在浏览器中访问 <a href={githubAuthorization.verificationUri} target="_blank" rel="noreferrer">{githubAuthorization.verificationUri}</a>，然后输入此设备码：</p>
          <p className="mono">{githubAuthorization.userCode}</p>
          <p>完成授权后点击下方按钮。凭据只会进入系统安全存储，应用不提供 PAT 输入框。</p>
          <div className="modal-actions"><button className="secondary" onClick={() => setGithubAuthorization(undefined)}>取消</button><button className="primary" onClick={() => void pollGitHubAuthorization()}>我已完成授权，检查状态</button></div>
        </Modal>
      )}
    </main>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }): ReactElement {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="card-header"><h2>{title}</h2><button className="text-button" onClick={onClose}>关闭</button></div>{children}</section></div>;
}

function statusLabel(status: DashboardSnapshot['agents'][number]['status']): string {
  return status === 'detected' ? '已检测' : status === 'read-only' ? '只读' : status === 'unsupported-platform' ? '平台不支持' : '未检测';
}

function toMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function upstreamLabel(status: UpstreamStatusDto): string {
  if (status.kind === 'current') return '已是最新';
  if (status.kind === 'update-available') return '有可用更新';
  if (status.kind === 'forked') return '已分叉，已阻止直接更新';
  if (status.kind === 'unavailable') return '暂不可用';
  return '非上游来源';
}

function sourceLabel(skill: ManagedSkill): string {
  return skill.source.kind === 'local' ? '本地来源' : `上游 · ${skill.source.repositoryUrl}`;
}

function changeLabel(change: UpstreamUpdatePreviewDto['changedFiles'][number]['change']): string {
  return change === 'added' ? '新增' : change === 'removed' ? '移除' : '修改';
}

function remoteRelationLabel(relation: ManualSyncPreviewDto['remoteRelation']): string {
  return relation === 'up-to-date' ? '本地与远端一致' : relation === 'ahead' ? '本地已有待推送提交' : relation === 'behind' ? '远端领先，必须先恢复或合并' : relation === 'diverged' ? '双方分叉，必须先解决冲突' : '未配置远端分支';
}

function canPush(relation: ManualSyncPreviewDto['remoteRelation']): boolean {
  return relation === 'up-to-date' || relation === 'ahead';
}
