import { useEffect, useState } from 'react';
import { CheckCircle2, DownloadCloud, RefreshCw } from 'lucide-react';

type UpdateState = { state: string; version?: string | null; percent?: number; message?: string };
type Bridge = {
  getStatus: () => Promise<UpdateState | null>;
  check: () => Promise<UpdateState | null>;
  install: () => Promise<boolean>;
  onChange: (fn: (state: UpdateState) => void) => () => void
};
declare global { interface Window { crimsonfinUpdates?: Bridge } }

const names: Record<string, string> = {
  idle: 'Automatic update checks enabled', checking: 'Checking for updates…',
  current: 'You have the latest version', downloading: 'Downloading update…',
  downloaded: 'Update ready to install', manual: 'Update available',
  error: 'Automatic update failed'
};

export function UpdatePanel() {
  const bridge = window.crimsonfinUpdates;
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.getStatus().then(s => { if (live) setState(s); }).catch(() => {});
    const unsubscribe = bridge.onChange(s => { if (live) setState(s); });
    return () => { live = false; unsubscribe(); };
  }, [bridge]);
  if (!bridge) return <div className="setting">
    <span className="setting-text"><strong>App updates</strong>
      <small>The web version runs straight from your server, so it is always current. Desktop apps check for updates automatically.</small></span>
    <span className="chip small">Web client</span>
  </div>;
  const message = state?.state ? names[state.state] || 'Automatic update checks enabled' : 'Automatic update checks enabled';
  return <div className="setting column">
    <div className="setting-row">
      <span className="setting-text"><strong>App updates</strong><small>{message}{state?.version ? ' · v' + state.version : ''}</small></span>
      <span className="actions">
        <button className="btn small" disabled={busy || state?.state === 'downloading' || state?.state === 'checking'} onClick={async () => {
          setBusy(true); try { const s = await bridge.check(); if (s) setState(s); } finally { setBusy(false); }
        }}><RefreshCw aria-hidden /> Check now</button>
        {(state?.state === 'error' || state?.state === 'manual') && <a className="btn small"
          href="https://github.com/copiluratspurcat/crimsonfin/releases/latest" target="_blank" rel="noreferrer"><DownloadCloud aria-hidden /> Official download</a>}
        {state?.state === 'downloaded' && <button className="btn small primary" onClick={() => bridge.install()}><CheckCircle2 aria-hidden /> Restart & install</button>}
      </span>
    </div>
    {state?.state === 'downloading' && <span className="meter" role="progressbar" aria-label="Update download progress"
      aria-valuenow={Math.round(state.percent || 0)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: Math.max(0, Math.min(100, state.percent || 0)) + '%' }} /></span>}
    {state?.state === 'error' && <small className="error-text">{state.message || 'Try again later.'}</small>}
    {state?.state === 'manual' && <small className="muted">{state.message}</small>}
    <small className="muted">CrimsonFin checks GitHub Releases automatically. Windows installs updates on restart. macOS and Linux updates are installed from the official release.</small>
  </div>;
}
