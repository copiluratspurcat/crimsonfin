import { useState } from 'react';

const themes = [
  ['crimson', 'Crimson'],
  ['midnight', 'Midnight Blue'],
  ['forest', 'Forest Green'],
  ['violet', 'Violet']
] as const;
const key = 'crimsonfin.theme';

function savedTheme() {
  try {
    const value = localStorage.getItem(key);
    return themes.find(([id]) => id === value)?.[0] ?? 'crimson';
  } catch {
    return 'crimson';
  }
}

export function initTheme() {
  document.documentElement.dataset.theme = savedTheme();
}

export function ThemePicker() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'crimson');
  return <div className="setting-card theme-settings">
    <h3><label htmlFor="app-theme">App theme</label></h3>
    <select id="app-theme" value={theme} onChange={event => {
      const value = event.target.value;
      setTheme(value);
      document.documentElement.dataset.theme = value;
      try { localStorage.setItem(key, value); } catch {}
    }}>
      {themes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select>
  </div>;
}
