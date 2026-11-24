import React, { useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Clapperboard, Heart, Play } from 'lucide-react';
import { art, episodeCode, isPlayable, minutesLeft, progressOf, wideArt, type Item } from './lib';

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
        <Artwork sources={[art(item.Id, 'Primary', 400)]} label="No artwork" />
        {badge && <span className="card-badge">{badge}</span>}
        {item.UserData?.Played && <span className="card-watched" title="Watched"><Check aria-hidden /></span>}
        {item.UserData?.IsFavorite && !item.UserData?.Played && <span className="card-fav" title="In My list"><Heart aria-hidden /></span>}
        <ProgressBar value={progressOf(item)} />
      </span>
      <span className="card-text"><strong>{item.Name}</strong>{meta && <small>{meta}</small>}</span>
    </button>
    <QuickPlay item={item} onOpen={onOpen} onPlay={onPlay} />
  </div>;
}

export function WideCard({ item, onOpen, onPlay, subtitle, badge }: CardProps) {
  const title = item.Type === 'Episode' ? item.SeriesName || item.Name : item.Name;
  const sub = subtitle ?? [episodeCode(item), minutesLeft(item) || (item.Type === 'Episode' ? item.Name : item.ProductionYear)]
    .filter(Boolean).join(' · ');
  return <div className="card wide-card">
    <button className="card-hit" onClick={() => (isPlayable(item) ? onPlay(item) : onOpen(item))} aria-label={`${title}, ${sub}`}>
      <span className="card-art">
        <Artwork sources={[...wideArt(item), art(item.SeriesId || item.Id, 'Primary', 400)]} label={title} />
        {badge && <span className="card-badge">{badge}</span>}
        <ProgressBar value={progressOf(item)} />
      </span>
      <span className="card-text"><strong>{title}</strong>{sub && <small className={badge ? 'accent' : ''}>{sub}</small>}</span>
    </button>
    <QuickPlay item={item} onOpen={onOpen} onPlay={onPlay} />
  </div>;
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
