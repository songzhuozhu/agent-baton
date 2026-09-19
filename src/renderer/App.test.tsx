// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { DashboardSnapshot, LibrarySnapshot } from '../shared/ipc';

beforeEach(() => {
  // jsdom has no top layer; real dialog focus/inert behavior is checked in Chromium.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});

function installBridge(library: Partial<LibrarySnapshot> = {}, dashboard: Partial<DashboardSnapshot> = {}) {
  const api = {
    dashboard: { load: vi.fn().mockResolvedValue({
      agents: [], pendingApplyCount: 0, pendingSyncCount: 0, upstreamUpdateCount: 0, ...dashboard
    }) },
    library: { load: vi.fn().mockResolvedValue({
      skills: [], groups: [], discovered: [], customScanRoots: [], customDiscovered: [], ...library
    }) },
    groups: { create: vi.fn().mockResolvedValue({}), rename: vi.fn().mockResolvedValue({}), addSkill: vi.fn().mockResolvedValue({}) },
    settings: { removeScanRoot: vi.fn().mockResolvedValue(undefined) },
    agents: { view: vi.fn().mockResolvedValue({ desiredState: { agent: 'codex', activeGroupIds: [], overrides: {} }, effectiveSkillIds: [], unknownGroupIds: [], unknownSkillIds: [] }) },
    github: { isConnected: vi.fn().mockResolvedValue(false) },
    sync: { connection: vi.fn().mockResolvedValue(null) },
    diagnostics: { recordLocalError: vi.fn().mockResolvedValue(undefined) }
  };
  vi.stubGlobal('agentBaton', api);
  return api;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('desktop startup', () => {
  it('shows an actionable error when preload did not inject the bridge', () => {
    vi.stubGlobal('agentBaton', undefined);
    render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('无法连接桌面服务');
  });

  it('renders the dashboard after loading local state', async () => {
    installBridge();
    render(<App />);
    expect(await screen.findByRole('heading', { name: '当前状态' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '纳管 Skill' })).toBeTruthy();
  });

  it('allows retry after IPC failure even if recording the error also fails', async () => {
    const api = installBridge();
    api.dashboard.load.mockRejectedValueOnce(new Error('读取失败'));
    api.diagnostics.recordLocalError.mockRejectedValue(new Error('日志不可写'));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('读取失败');
    await waitFor(() => expect(api.diagnostics.recordLocalError).toHaveBeenCalledWith('读取失败'));
    await userEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByRole('heading', { name: '当前状态' })).toBeTruthy();
    expect(api.dashboard.load).toHaveBeenCalledTimes(2);
  });

  it('keeps the UI and theme selection usable when preference storage fails', async () => {
    installBridge();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('不可读'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('不可写'); });
    render(<App />);
    await screen.findByRole('heading', { name: '当前状态' });
    expect(document.documentElement.dataset.theme).toBe('system');
    await userEvent.selectOptions(screen.getByLabelText('主题'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

const managedSkill = {
  id: 'managed-1', name: 'design-helper', originalDescription: '界面设计', tags: ['UI'],
  syncPolicy: 'local-only' as const, source: { kind: 'local' as const },
  contentHash: 'sha256:1', createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z'
};
const discovery = {
  agent: 'codex' as const, sourcePath: '/fixture/video', canonicalPath: '/fixture/video',
  skillName: 'video-helper', originalDescription: '视频处理', contentHash: 'sha256:2', risks: []
};
const agentSummary = { id: 'codex', name: 'Codex', status: 'detected' as const, currentEnabledCount: 0, desiredEnabledCount: 0, restartRequired: false };

describe('everyday library workflows', () => {
  it('guides an empty library to adoption and discovery', async () => {
    installBridge();
    render(<App />);
    expect(await screen.findByRole('heading', { name: '从第一个 Skill 开始' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择本地 Skill' })).toBeTruthy();
  });

  it('creates a trimmed group through an in-app form and prevents duplicate submissions', async () => {
    const api = installBridge();
    let complete!: () => void;
    api.groups.create.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '新建分组' }));
    const dialog = screen.getByRole('dialog', { name: '新建分组' });
    const save = within(dialog).getByRole('button', { name: '保存分组' });
    expect(save.matches(':disabled')).toBe(true);
    await user.type(within(dialog).getByLabelText('分组名称'), '  个人项目  ');
    await user.dblClick(save);
    expect(api.groups.create).toHaveBeenCalledExactlyOnceWith('个人项目');
    expect(save.matches(':disabled')).toBe(true);
    expect(within(dialog).getByRole('status').textContent).toContain('正在处理');
    complete();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps failed group input and shows the error inside its dialog, then permits retry', async () => {
    const api = installBridge();
    api.groups.create.mockRejectedValueOnce(new Error('磁盘暂时不可写'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '新建分组' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('分组名称'), '工作');
    await user.click(within(dialog).getByRole('button', { name: '保存分组' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('磁盘暂时不可写');
    expect((within(dialog).getByLabelText('分组名称') as HTMLInputElement).value).toBe('工作');
    await user.click(within(dialog).getByRole('button', { name: '保存分组' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.groups.create).toHaveBeenCalledTimes(2);
  });

  it('renames an existing group without window.prompt', async () => {
    const api = installBridge({ groups: [{ id: 'group-1', name: '旧名称', skillIds: [], participatesInSync: false }] }, { agents: [agentSummary] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '查看 Agent' }));
    await user.click(await screen.findByRole('button', { name: '重命名' }));
    const input = screen.getByLabelText('分组名称');
    expect((input as HTMLInputElement).value).toBe('旧名称');
    await user.clear(input);
    await user.type(input, '新名称{Enter}');
    expect(api.groups.rename).toHaveBeenCalledExactlyOnceWith('group-1', '新名称');
  });

  it('filters both managed and discovered skills and can clear empty results', async () => {
    installBridge({ skills: [managedSkill], discovered: [discovery] });
    const user = userEvent.setup();
    render(<App />);
    const search = await screen.findByLabelText('搜索 Skill、Tag 或描述');
    await user.type(search, '视频');
    expect(screen.queryByRole('heading', { name: 'design-helper' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'video-helper' })).toBeTruthy();
    await user.clear(search);
    await user.type(search, 'missing');
    expect(screen.queryByRole('heading', { name: 'video-helper' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('heading', { name: 'design-helper' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'video-helper' })).toBeTruthy();
  });

  it('does not present unadopted discoveries as Local Only or Sync Allowed skills', async () => {
    installBridge({ skills: [managedSkill], discovered: [discovery] });
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(await screen.findByLabelText('同步策略（仅托管）'), 'local-only');
    expect(screen.queryByRole('heading', { name: 'video-helper' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'design-helper' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '已发现 1' }));
    expect(screen.getByRole('heading', { name: 'video-helper' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'design-helper' })).toBeNull();
  });

  it('handles scan-root removal failures instead of leaving an unhandled rejection', async () => {
    const api = installBridge({ customScanRoots: [{ path: '/fixture', kind: 'custom' }] });
    api.settings.removeScanRoot.mockRejectedValue(new Error('目录设置不可写'));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '移除' }));
    expect((await screen.findByRole('alert')).textContent).toContain('目录设置不可写');
  });
});
