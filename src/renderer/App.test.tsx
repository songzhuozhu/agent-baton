// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function installBridge() {
  const api = {
    dashboard: { load: vi.fn().mockResolvedValue({
      agents: [], pendingApplyCount: 0, pendingSyncCount: 0, upstreamUpdateCount: 0
    }) },
    library: { load: vi.fn().mockResolvedValue({
      skills: [], groups: [], discovered: [], customScanRoots: [], customDiscovered: []
    }) },
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
