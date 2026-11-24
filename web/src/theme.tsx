import { useState } from 'react';

const themes = [
  ['crimson', 'Crimson', '#d92a43'],
  ['midnight', 'Midnight Blue', '#3e6bd8'],
  ['forest', 'Forest Green', '#2e9e6a'],
  ['violet', 'Violet', '#8e5bd8']
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
  const choose = (value: string) => {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem(key, value); } catch {}
  };
  return <div className="swatches" role="radiogroup" aria-label="App theme">
    {themes.map(([id, label, color]) => <button key={id} role="radio" aria-checked={theme === id} aria-label={label} title={label}
      className={theme === id ? 'swatch active' : 'swatch'} style={{ background: color }} onClick={() => choose(id)} />)}
  </div>;
}
