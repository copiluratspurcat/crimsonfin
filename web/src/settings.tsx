import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DownloadCloud, Keyboard, LogOut, Palette, RefreshCw, ShieldCheck, User, Wifi } from 'lucide-react';
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

function General() {
  const qc = useQueryClient();
  return <div className="settings-content">
    <h2 className="section-title">General</h2>
    <div className="setting"><span className="setting-text"><strong>Theme</strong><small>Crimson, Midnight Blue, Forest Green or Violet</small></span><ThemePicker /></div>
    <div className="setting"><span className="setting-text"><strong><Wifi aria-hidden className="inline" /> Connection</strong>
      <small>{connectionLabel} connection. Your server address is intentionally hidden.</small></span>
      <button className="btn small" onClick={() => void qc.invalidateQueries()}><RefreshCw aria-hidden /> Refresh data</button></div>
    <UpdatePanel />
    <div className="setting"><span className="setting-text"><strong>Motion</strong><small>Animations follow your system’s reduced-motion setting.</small></span><span className="chip small">System</span></div>
    {!isTv && <div className="setting column"><span className="setting-text"><strong><Keyboard aria-hidden className="inline" /> Keyboard shortcuts</strong></span>
      <div className="shortcuts">{[['Ctrl K', 'Search'], ['Space', 'Play / pause'], ['← →', 'Skip 10 s'], ['↑ ↓', 'Volume'], ['M', 'Mute'], ['F', 'Fullscreen'], ['C', 'Subtitles on/off']]
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
