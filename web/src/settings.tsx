import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, DownloadCloud, Keyboard, LogOut, Palette, RefreshCw, ShieldCheck, User, Wifi } from 'lucide-react';
import { setPrefs, subtitleLanguages, usePrefs, type Prefs } from './prefs';
import { connectionLabel, type Account } from './lib';
import type { Tab } from './nav';
import { ThemePicker } from './theme';
import { UpdatePanel } from './updates';
import { DownloadsSection } from './downloads';
import { AdminSection } from './admin';
import { isTv } from './tv';

type Section = 'general' | 'account' | 'downloads' | 'admin';

export function SettingsPage({ user, tab, onTab, onSignOut }: { user: Account; tab: Tab; onTab: (tab: Tab) => void; onSignOut: () => void }) {
  const [general, setGeneral] = useState<'general' | 'account'>('general');
  const section: Section = tab === 'downloads' || tab === 'admin' ? tab : general;
  const go = (s: Section) => { if (s === 'downloads' || s === 'admin') onTab(s); else { setGeneral(s); onTab('settings'); } };
  const item = (s: Section, label: string, Icon: typeof User) =>
    <button className={section === s ? 'rail-item active' : 'rail-item'} aria-current={section === s ? 'page' : undefined} onClick={() => go(s)}>
      <Icon aria-hidden />{label}</button>;
  return <div className="page settings">
    <nav className="rail" aria-label="Settings sections">
      <h1>Settings</h1>
      {item('general', 'General', Palette)}
      {item('account', 'Account', User)}
      {user.isAdmin && <><p className="rail-label">Server · admin only</p>{item('downloads', 'Downloads', DownloadCloud)}{item('admin', 'Admin', ShieldCheck)}</>}
      <button className="rail-item danger" onClick={onSignOut}><LogOut aria-hidden />Sign out</button>
    </nav>
    {section === 'general' && <General />}
    {section === 'account' && <AccountSection user={user} onSignOut={onSignOut} />}
    {section === 'downloads' && user.isAdmin && <DownloadsSection />}
    {section === 'admin' && user.isAdmin && <AdminSection />}
  </div>;
}

function Choice<K extends keyof Prefs>({ name, label, hint, options }: { name: K; label: string; hint?: string; options: [Prefs[K], string][] }) {
  const prefs = usePrefs();
  return <div className="setting"><span className="setting-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
    <label className="select"><select aria-label={label} value={String(prefs[name])}
      onChange={e => setPrefs({ [name]: options.find(([v]) => String(v) === e.target.value)?.[0] } as Partial<Prefs>)}>
      {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}</select><ChevronDown aria-hidden /></label></div>;
}

function General() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  return <div className="settings-content">
    <h2 className="section-title">General</h2>
    <div className="setting"><span className="setting-text"><strong>Theme</strong><small>Crimson, Midnight Blue, Forest Green or Violet</small></span><ThemePicker /></div>
    <h2 className="section-title">Subtitles & playback</h2>
    <Choice name="subtitleLanguage" label="Subtitle language" hint="Used automatically when a title has it. Picking a track in the player updates this."
      options={subtitleLanguages as [string, string][]} />
    <Choice name="subtitleSize" label="Subtitle size" options={[['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']]} />
    <Choice name="subtitleBackground" label="Subtitle background" hint="A solid plate keeps subtitles readable on bright scenes"
      options={[['solid', 'Solid'], ['shadow', 'Shadow only'], ['none', 'None']]} />
    <div className="setting"><span className="setting-text"><strong>Play next episode automatically</strong>
      <small>Counts down from 10 seconds when the credits start or the episode ends</small></span>
      <button className={prefs.autoplayNext ? 'toggle on' : 'toggle'} role="switch" aria-checked={prefs.autoplayNext}
        aria-label="Play next episode automatically" onClick={() => setPrefs({ autoplayNext: !prefs.autoplayNext })}><i /></button></div>
    <h2 className="section-title">App</h2>
    <div className="setting"><span className="setting-text"><strong><Wifi aria-hidden className="inline" /> Connection</strong>
      <small>{connectionLabel} connection. Your server address is intentionally hidden.</small></span>
      <button className="btn small" onClick={() => void qc.invalidateQueries()}><RefreshCw aria-hidden /> Refresh data</button></div>
    <UpdatePanel />
    <div className="setting"><span className="setting-text"><strong>Motion</strong><small>Animations follow your system’s reduced-motion setting.</small></span><span className="chip small">System</span></div>
    {!isTv && <div className="setting column"><span className="setting-text"><strong><Keyboard aria-hidden className="inline" /> Keyboard shortcuts</strong></span>
      <div className="shortcuts">{[['Ctrl K', 'Search'], ['Space', 'Play / pause'], ['← →', 'Skip 10 s'], ['↑ ↓', 'Volume'], ['M', 'Mute'], ['F', 'Fullscreen'], ['C', 'Subtitles on/off'], ['N', 'Next episode']]
        .map(([k, l]) => <span key={k}><kbd>{k}</kbd>{l}</span>)}</div></div>}
  </div>;
}

function AccountSection({ user, onSignOut }: { user: Account; onSignOut: () => void }) {
  return <div className="settings-content">
    <h2 className="section-title">Account</h2>
    <div className="setting"><span className="setting-text"><strong>{user.name}</strong>
      <small>{user.isAdmin ? 'Administrator' : 'Jellyfin member'} · your history and favorites belong to this Jellyfin user.</small></span>
      <button className="btn small" onClick={onSignOut}><LogOut aria-hidden /> Sign out</button></div>
  </div>;
}
