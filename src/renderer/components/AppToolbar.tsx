import { useEffect, useRef, type ReactElement } from 'react';
import type { ThemePreference } from '../hooks/use-theme-preference';

interface ToolbarActionGroup {
  label: string;
  actions: Array<{ label: string; onSelect: () => void }>;
}

interface AppToolbarProps {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onRefresh: () => void;
  onAdopt: () => void;
  groups: ToolbarActionGroup[];
}

export function AppToolbar({ theme, onThemeChange, onRefresh, onAdopt, groups }: AppToolbarProps): ReactElement {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent): void => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) {
        menu.current.open = false;
      }
    };
    const dismissWithEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <p className="eyebrow">AGENTBATON</p>
        <h1>One baton. Every agent.</h1>
      </div>
      <div className="header-actions">
        <label className="theme-picker">
          主题
          <select value={theme} onChange={(event) => onThemeChange(event.target.value as ThemePreference)}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <button className="secondary quick-action" onClick={onRefresh}>刷新扫描</button>
        <details className="toolbar-menu" ref={menu} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}>
          <summary className="secondary" ref={trigger}>
            更多操作<span aria-hidden="true">⌄</span>
          </summary>
          <div className="toolbar-menu-panel">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <p>{group.label}</p>
                {group.actions.map((action) => (
                  <button key={action.label} onClick={() => {
                    if (menu.current) menu.current.open = false;
                    trigger.current?.focus();
                    action.onSelect();
                  }}>{action.label}</button>
                ))}
              </section>
            ))}
          </div>
        </details>
        <button className="primary quick-action" onClick={onAdopt}>纳管 Skill</button>
      </div>
    </header>
  );
}
