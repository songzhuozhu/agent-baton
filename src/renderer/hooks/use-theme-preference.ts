import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const storageKey = 'agent-baton-theme';

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // An unavailable preference store must not prevent the desktop UI from starting.
  }
  return 'system';
}

export function useThemePreference() {
  const [theme, setTheme] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(storageKey, theme);
    } catch {
      // Keep the selected theme usable for this session even if persistence fails.
    }
  }, [theme]);

  return [theme, setTheme] as const;
}
