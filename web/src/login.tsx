import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, connectionLabel } from './lib';
import { Logo, StatusDot } from './ui';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true); const [visible, setVisible] = useState(false);
  const login = useMutation({ mutationFn: () => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, remember }) }), onSuccess: onLogin });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api('/api/health'), retry: 0, refetchInterval: 30000 });
  return <div className="login">
    <div className="login-backdrop" aria-hidden />
    <header className="login-top"><Logo /></header>
    <main className="login-card">
      <h1>Sign in</h1>
      <p className="muted">Use your Jellyfin username and password.</p>
      <form onSubmit={e => { e.preventDefault(); login.mutate(); }}>
        <label className="field"><span>Username</span>
          <input autoFocus autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label className="field"><span>Password</span>
          <span className="input-with-button">
            <input type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" className="btn small" onClick={() => setVisible(v => !v)} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button>
          </span></label>
        <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          <span className="box" aria-hidden><Check /></span>Keep me signed in on this device</label>
        <button className="btn primary block" type="submit" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {login.error && <p className="error" role="alert">{login.error.message}</p>}
      <p className="login-status"><StatusDot tone={health.isSuccess ? 'green' : health.isPending ? 'grey' : 'red'} />
        {health.isSuccess ? `Server reachable · ${connectionLabel}` : health.isPending ? 'Checking server…' : 'Unable to reach server'}
        {health.isError && <button className="link" onClick={() => void health.refetch()}>Retry</button>}</p>
    </main>
    <p className="login-note">Uses your existing Jellyfin account. Your server address is never shown.</p>
  </div>;
}
