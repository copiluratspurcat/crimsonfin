import { setPrefs, usePrefs } from './prefs';
import { useMediaTitle } from './titles';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, CornerDownLeft, DownloadCloud, LogOut, Search, Settings2, ShieldCheck } from 'lucide-react';
import { api, itemArt, useDebounced, type Account, type Item, type PageResult } from './lib';
import { Artwork, Logo } from './ui';
import { isTv } from './tv';

export type Tab = 'home' | 'movies' | 'series' | 'mylist' | 'requests' | 'search' | 'settings' | 'downloads' | 'admin';
const links: { key: Tab; label: string }[] = [
  { key: 'home', label: 'Home' }, { key: 'movies', label: 'Movies' }, { key: 'series', label: 'Shows' },
  { key: 'mylist', label: 'My list' }, { key: 'requests', label: 'Requests' }
];

type NavProps = {
  tab: Tab; user: Account; onTab: (tab: Tab) => void; onOpen: (item: Item) => void;
  onSearchAll: (query: string) => void; onSignOut: () => void;
};

export function TopNav({ tab, user, onTab, onOpen, onSearchAll, onSignOut }: NavProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const settingsTab = tab === 'settings' || tab === 'downloads' || tab === 'admin';
  return <header className={scrolled ? 'topnav scrolled' : 'topnav'}>
    <div className="topnav-left">
      <button className="topnav-logo" onClick={() => onTab('home')} aria-label="CrimsonFin home"><Logo /></button>
      <nav aria-label="Main">{links.map(l =>
        <button key={l.key} className={tab === l.key ? 'nav-pill active' : 'nav-pill'} aria-current={tab === l.key ? 'page' : undefined}
          onClick={() => onTab(l.key)}>{l.label}</button>)}
        {isTv && <button className={tab === 'search' ? 'nav-pill active' : 'nav-pill'} aria-current={tab === 'search' ? 'page' : undefined}
          onClick={() => onTab('search')}><Search aria-hidden /> Search</button>}
      </nav>
    </div>
    <div className="topnav-right">
      <TitleLanguageSwitch />
      {isTv ? <>
        <button className={settingsTab ? 'nav-icon active' : 'nav-icon'} aria-label="Settings" onClick={() => onTab('settings')}><Settings2 aria-hidden /></button>
        <span className="avatar" aria-label={user.name}>{user.name.slice(0, 1).toUpperCase()}</span>
      </> : <>
        <SearchBox onOpen={onOpen} onSearchAll={onSearchAll} />
        <AccountMenu user={user} active={settingsTab} onTab={onTab} onSignOut={onSignOut} />
      </>}
    </div>
  </header>;
}

function TitleLanguageSwitch() {
  const romanian = usePrefs().titleLanguage === 'ro';
  return <button type="button" className="title-language" role="switch"
    aria-label="Romanian media titles" aria-checked={romanian}
    title="Title language · English / Română"
    onClick={() => setPrefs({ titleLanguage: romanian ? 'en' : 'ro' })}>
    <span aria-hidden="true">EN</span><span aria-hidden="true" lang="ro">RO</span>
  </button>;
}

function SearchResultTitle({ item, term }: { item: Item; term: string }) {
  const title = useMediaTitle(item);
  return <Highlight text={title} term={term} />;
}

function SearchBox({ onOpen, onSearchAll }: Pick<NavProps, 'onOpen' | 'onSearchAll'>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const term = useDebounced(query.trim(), 220);
  const search = useQuery({ queryKey: ['search', term], queryFn: () => api<PageResult>(`/api/search?q=${encodeURIComponent(term)}`), enabled: term.length > 1 });
  const results = (search.data?.Items || []).slice(0, 6);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setIndex(0), [term]);
  const choose = (item: Item) => { setOpen(false); setQuery(''); input.current?.blur(); onOpen(item); };
  const show = open && term.length > 1;
  return <div className="searchbox" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <label className={show ? 'search-field open' : 'search-field'}>
      <Search aria-hidden />
      <input ref={input} type="search" value={query} placeholder="Search movies and shows" aria-label="Search movies and shows"
        role="combobox" aria-expanded={show} aria-controls="search-results" aria-autocomplete="list"
        onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(results.length, i + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
          const typed = query.trim();
          if (e.key === 'Enter' && typed.length > 1) {
            // Results belong to the debounced term; if the text moved on, search for what was typed.
            if (typed === term && results[index]) choose(results[index]);
            else { setOpen(false); onSearchAll(typed); }
          }
        }} />
      <kbd>Ctrl K</kbd>
    </label>
    {show && <div className="search-results" id="search-results" role="listbox">
      <p className="menu-label">{search.isFetching && !search.data ? 'Searching…' : results.length ? 'Top results' : 'No matches'}</p>
      {results.map((item, i) => <button key={item.Id} role="option" aria-selected={i === index} className={i === index ? 'result active' : 'result'}
        onMouseEnter={() => setIndex(i)} onClick={() => choose(item)}>
        <span className="result-art"><Artwork sources={[itemArt(item, 'Primary', 120)]} /></span>
        <span className="result-text"><SearchResultTitle item={item} term={term} />
          <small>{item.Type === 'Series' ? 'Show' : 'Movie'}{item.ProductionYear ? ` · ${item.ProductionYear}` : ''}</small></span>
        {i === index && <CornerDownLeft className="enter-hint" aria-hidden />}
      </button>)}
      {(search.data?.TotalRecordCount || 0) > 0 && <button className={index === results.length ? 'result see-all active' : 'result see-all'}
        onClick={() => { setOpen(false); onSearchAll(term); }}>See all {search.data!.TotalRecordCount === 1 ? '1 result' : search.data!.TotalRecordCount + ' results'} for “{term}” →</button>}
    </div>}
  </div>;
}

export function Highlight({ text, term }: { text: string; term: string }) {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (!term || at < 0) return <strong>{text}</strong>;
  return <strong>{text.slice(0, at)}<mark>{text.slice(at, at + term.length)}</mark>{text.slice(at + term.length)}</strong>;
}

function AccountMenu({ user, active, onTab, onSignOut }: { user: Account; active: boolean; onTab: (tab: Tab) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const go = (tab: Tab) => { setOpen(false); onTab(tab); };
  return <div className="account" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
    onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
    <button className={active || open ? 'account-button active' : 'account-button'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><ChevronDown aria-hidden />
    </button>
    {open && <div className="menu" role="menu">
      <div className="menu-user"><strong>{user.name}</strong><small>{user.isAdmin ? 'Administrator' : 'Jellyfin member'}</small></div>
      <button role="menuitem" onClick={() => go('settings')}><Settings2 aria-hidden /> Settings</button>
      {user.isAdmin && <>
        <button role="menuitem" onClick={() => go('downloads')}><DownloadCloud aria-hidden /> Downloads</button>
        <button role="menuitem" onClick={() => go('admin')}><ShieldCheck aria-hidden /> Admin</button>
      </>}
      <hr />
      <button role="menuitem" className="danger" onClick={() => { setOpen(false); onSignOut(); }}><LogOut aria-hidden /> Sign out</button>
    </div>}
  </div>;
}
