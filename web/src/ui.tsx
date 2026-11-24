import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Clapperboard, Eye, EyeOff, Heart, HeartOff, History, MoreHorizontal, Play, Tv2 } from 'lucide-react';
import { api, art, itemArt, episodeCode, isPlayable, minutesLeft, progressOf, queryClient, wideArt, type Item } from './lib';

export function Logo({ compact }: { compact?: boolean }) {
  return <span className="logo">
    <img src="/dobby.png" alt="" width={40} height={40} draggable={false} />
    {!compact && <span className="logo-word">CrimsonFin</span>}
  </span>;
}

/** Image that walks through fallbacks, then shows a placeholder. */
export function Artwork({ sources, label }: { sources: string[]; label?: string }) {
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];
  return <span className="artwork-img">
    {src ? <img key={src} src={src} alt="" loading="lazy" draggable={false} onError={() => setAttempt(a => a + 1)} />
      : <span className="artwork-missing"><Clapperboard aria-hidden />{label && <small>{label}</small>}</span>}
  </span>;
}

function ProgressBar({ value }: { value: number }) {
  if (!value) return null;
  return <span className="card-progress" aria-hidden><i style={{ width: `${value}%` }} /></span>;
}

type CardProps = { item: Item; onOpen: (item: Item) => void; onPlay: (item: Item) => void; subtitle?: string; badge?: string };

export function PosterCard({ item, onOpen, onPlay, subtitle, badge }: CardProps) {
  const meta = subtitle ?? [item.ProductionYear, item.Genres?.[0]].filter(Boolean).join(' · ');
  return <div className="card poster-card">
    <button className="card-hit" onClick={() => onOpen(item)} aria-label={`${item.Name}${meta ? ', ' + meta : ''}`}>
      <span className="card-art">
        <Artwork sources={[itemArt(item, 'Primary', 400)]} label="No artwork" />
        {badge && <span className="card-badge">{badge}</span>}
        {item.UserData?.Played && <span className="card-watched" title="Watched"><Check aria-hidden /></span>}
        {item.UserData?.IsFavorite && !item.UserData?.Played && <span className="card-fav" title="In My list"><Heart aria-hidden /></span>}
        <ProgressBar value={progressOf(item)} />
      </span>
      <span className="card-text"><strong>{item.Name}</strong>{meta && <small>{meta}</small>}</span>
    </button>
    <QuickPlay item={item} onOpen={onOpen} onPlay={onPlay} />
    <CardMenu item={item} onOpen={onOpen} />
  </div>;
}

export function WideCard({ item, onOpen, onPlay, subtitle, badge }: CardProps) {
  const title = item.Type === 'Episode' ? item.SeriesName || item.Name : item.Name;
  const sub = subtitle ?? [episodeCode(item), minutesLeft(item) || (item.Type === 'Episode' ? item.Name : item.ProductionYear)]
    .filter(Boolean).join(' · ');
  return <div className="card wide-card">
    <button className="card-hit" onClick={() => (isPlayable(item) ? onPlay(item) : onOpen(item))} aria-label={`${title}, ${sub}`}>
      <span className="card-art">
        <Artwork sources={[...wideArt(item), item.SeriesId ? art(item.SeriesId, 'Primary', 400, item.SeriesPrimaryImageTag) : itemArt(item, 'Primary', 400)]} label={title} />
        {badge && <span className="card-badge">{badge}</span>}
        <ProgressBar value={progressOf(item)} />
      </span>
      <span className="card-text"><strong>{title}</strong>{sub && <small className={badge ? 'accent' : ''}>{sub}</small>}</span>
    </button>
    <QuickPlay item={item} onOpen={onOpen} onPlay={onPlay} />
    <CardMenu item={item} onOpen={onOpen} />
  </div>;
}

/**
 * "⋯" menu on a card's artwork: watch-history and list actions. Shown on hover/focus
 * (PC) or when the card has remote focus (TV). The panel is position:fixed so the
 * horizontally scrolling rows can't clip it.
 */
export function CardMenu({ item, onOpen, className = 'card-menu' }: { item: Item; onOpen: (item: Item) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusedOnOpen = useRef(false);
  const inProgress = progressOf(item) > 0 && !item.UserData?.Played;
  const played = !!item.UserData?.Played;
  const favorite = !!item.UserData?.IsFavorite;
  const action = useMutation({
    mutationFn: (kind: 'progress' | 'watched' | 'unwatched' | 'favorite' | 'unfavorite') => {
      const id = encodeURIComponent(item.Id);
      if (kind === 'progress') return api(`/api/items/${id}/progress`, { method: 'DELETE' });
      if (kind === 'watched' || kind === 'unwatched') return api(`/api/items/${id}/played`, { method: kind === 'watched' ? 'POST' : 'DELETE' });
      return api(`/api/items/${id}/favorite`, { method: kind === 'favorite' ? 'POST' : 'DELETE' });
    },
    onSuccess: () => {
      setOpen(false);
      for (const key of ['resume', 'nextup', 'movies', 'series', 'library', 'item', 'episodes', 'search']) void queryClient.invalidateQueries({ queryKey: [key] });
    }
  });
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect();
      const w = panel.current?.offsetWidth || 240, h = panel.current?.offsetHeight || 180;
      const top = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
      setPos({ top, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) });
    };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  // Move focus into the menu once it is placed (it is measured off-screen first), once per opening,
  // so remote/keyboard users can act on it directly and scrolling does not steal focus back.
  useEffect(() => {
    if (!open) { focusedOnOpen.current = false; return; }
    if (!pos || focusedOnOpen.current) return;
    focusedOnOpen.current = true;
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    // Capture Escape (TV Back) before the page uses it to leave the details view.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', close); window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  const run = (kind: Parameters<typeof action.mutate>[0]) => action.mutate(kind);
  return <>
    <button ref={button} className={open ? `${className} open` : className} aria-label={`More options for ${item.Name}`} title="More options"
      aria-haspopup="menu" aria-expanded={open} onClick={e => { e.stopPropagation(); if (!open) setPos(null); setOpen(o => !o); }}><MoreHorizontal aria-hidden /></button>
    {open && <div ref={panel} className="menu card-menu-panel" role="menu" aria-label={`Options for ${item.Name}`}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }} onClick={e => e.stopPropagation()}>
      {inProgress && <button role="menuitem" disabled={action.isPending} onClick={() => run('progress')}><History aria-hidden /> Remove from Continue watching</button>}
      {played ? <button role="menuitem" disabled={action.isPending} onClick={() => run('unwatched')}><EyeOff aria-hidden /> Mark as unwatched</button>
        : <button role="menuitem" disabled={action.isPending} onClick={() => run('watched')}><Eye aria-hidden /> Mark as watched</button>}
      {item.Type !== 'Episode' && (favorite ? <button role="menuitem" disabled={action.isPending} onClick={() => run('unfavorite')}><HeartOff aria-hidden /> Remove from My list</button>
        : <button role="menuitem" disabled={action.isPending} onClick={() => run('favorite')}><Heart aria-hidden /> Add to My list</button>)}
      {item.Type === 'Episode' && item.SeriesId && <button role="menuitem" onClick={() => { setOpen(false); onOpen(item); }}><Tv2 aria-hidden /> Go to series</button>}
      {action.isPending && <p className="menu-label" role="status">Saving…</p>}
      {action.error && <p className="menu-error" role="alert">{action.error.message}</p>}
    </div>}
  </>;
}

/** Mouse-only shortcut: the hover play button (hidden on TV, where OK opens/plays). */
function QuickPlay({ item, onOpen, onPlay }: Omit<CardProps, 'subtitle' | 'badge'>) {
  return <button className="card-play" tabIndex={-1} aria-hidden title={isPlayable(item) ? `Play ${item.Name}` : `Open ${item.Name}`}
    onClick={() => (isPlayable(item) ? onPlay(item) : onOpen(item))}><Play fill="currentColor" /></button>;
}

export function Row({ title, meta, action, children }: { title: string; meta?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return <section className="row">
    <header className="row-head"><h2>{title}</h2>{meta && <span className="muted">{meta}</span>}<span className="spacer" />{action}</header>
    <div className="row-wrap">
      <button className="row-arrow left" tabIndex={-1} aria-label={`Scroll ${title} left`} onClick={() => scroll(-1)}><ChevronLeft /></button>
      <div className="row-track" ref={ref}>{children}</div>
      <button className="row-arrow right" tabIndex={-1} aria-label={`Scroll ${title} right`} onClick={() => scroll(1)}><ChevronRight /></button>
    </div>
  </section>;
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty">{children}{action}</div>;
}

export function PageHead({ title, meta, children }: { title: string; meta?: string; children?: React.ReactNode }) {
  return <header className="page-head"><div className="page-title"><h1>{title}</h1>{meta && <span className="muted">{meta}</span>}</div>
    {children && <div className="page-tools">{children}</div>}</header>;
}

export function Tabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (value: T) => void; options: { value: T; label: string; count?: number }[]; label: string;
}) {
  return <div className="tabs" role="tablist" aria-label={label}>{options.map(o =>
    <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'pill active' : 'pill'} onClick={() => onChange(o.value)}>
      {o.label}{o.count != null && <span className="count">{o.count}</span>}
    </button>)}</div>;
}

export function StatusDot({ tone }: { tone: 'green' | 'amber' | 'blue' | 'grey' | 'red' }) {
  return <i className={`dot dot-${tone}`} aria-hidden />;
}
