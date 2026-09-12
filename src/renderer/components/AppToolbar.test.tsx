// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppToolbar } from './AppToolbar';

afterEach(cleanup);

function setup() {
  const onSelect = vi.fn();
  render(<AppToolbar
    theme="system" onThemeChange={vi.fn()} onRefresh={vi.fn()} onAdopt={vi.fn()}
    groups={[{ label: '维护', actions: [{ label: '生成诊断包', onSelect }] }]}
  />);
  const trigger = screen.getByText('更多操作');
  const menu = trigger.closest('details')!;
  return { trigger, menu, onSelect, user: userEvent.setup() };
}

describe('toolbar disclosure', () => {
  it('closes on Escape and returns keyboard focus to the trigger', async () => {
    const { user, trigger, menu } = setup();
    await user.click(trigger);
    expect(menu.open).toBe(true);
    await user.tab();
    await user.keyboard('{Escape}');
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes after invoking a selected action exactly once', async () => {
    const { user, trigger, menu, onSelect } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '生成诊断包' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu.open).toBe(false);
  });

  it('closes when clicking outside the toolbar menu', async () => {
    const { user, trigger, menu } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('heading'));
    expect(menu.open).toBe(false);
  });
});
