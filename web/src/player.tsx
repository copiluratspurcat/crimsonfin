import { useMediaTitle } from './titles';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { isTv } from './tv';
import { buildHlsUrl } from './hls-url';
import { ArrowLeft, Captions, Clapperboard, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Settings2, SkipForward, SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, itemArt, type PageResult } from './lib';
import { languageKey, setPrefs, usePrefs } from './prefs';

type StreamInfo = {
  Index: number;
  Type: string;
  Language?: string;
  DisplayTitle?: string;
  Codec?: string;
  IsDefault?: boolean;
  IsExternal?: boolean;
  DeliveryMethod?: string;
};
type MediaSource = { Id: string; MediaStreams?: StreamInfo[]; DefaultAudioStreamIndex?: number; DefaultSubtitleStreamIndex?: number };
type PlayerItem = { Id: string; Name: string; OriginalTitle?: string; Type?: string; SeriesId?: string; SeriesName?: string; ParentIndexNumber?: number; IndexNumber?: number;
  ImageTags?: { Primary?: string }; UserData?: { PlaybackPositionTicks?: number } };
type Segments = { intro: { start: number; end: number } | null; credits: { start: number; end: number } | null };
type Details = PlayerItem & { MediaSources?: MediaSource[] };
const ROMANIAN = new Set(['ron', 'rum', 'ro', 'ro-ro']);
const TEXT_SUBS = new Set(['subrip', 'srt', 'webvtt', 'vtt', 'ass', 'ssa', 'mov_text', 'ttml']);

function languageLabel(value?: string) {
  const s = (value || '').toLowerCase();
  if (ROMANIAN.has(s)) return 'Română';
  if (['eng', 'en'].includes(s)) return 'English';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(s) || 'Unknown'; }
  catch { return value || 'Unknown'; }
}
const formatTime = (s: number) => {
  if (!Number.isFinite(s)) return '00:00';
  const n = Math.max(0, Math.floor(s));
  return (n >= 3600 ? `${Math.floor(n / 3600)}:` : '') +
    `${Math.floor((n % 3600) / 60)}:${String(n % 60).padStart(2, '0')}`;
};
function isSubtitleUsable(s: StreamInfo) { return s.Type === 'Subtitle' && TEXT_SUBS.has((s.Codec || '').toLowerCase()); }

declare global {
  interface Window {
    crimsonfinFullscreen?: {
      set: (enabled: boolean) => Promise<void>;
      onExit: (callback: () => void) => () => void;
    };
  }
}

export function Player({ item, onClose, onNext }: { item: PlayerItem; onClose: () => void; onNext?: (next: PlayerItem) => void }) {
  const mediaTitle = useMediaTitle(item);
  const prefs = usePrefs();
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const exitDialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Details | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const windowFullscreenRef = useRef(false);
  const [quality, setQuality] = useState(12_000_000);
  const [audioChoice, setAudioChoice] = useState('auto');
  const [subtitleChoice, setSubtitleChoice] = useState('auto');
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [autoSync, setAutoSync] = useState(true);
  const [syncState, setSyncState] = useState<{ url: string; ready: boolean } | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [idle, setIdle] = useState(false);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const lastSubtitleRef = useRef('auto');
  const [clock, setClock] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const resumeRef = useRef(Math.max(0, (item.UserData?.PlaybackPositionTicks || 0) / 10_000_000));
  const resumePlayingRef = useRef(true);
  const trackBasesRef = useRef(new WeakMap<TextTrackCue, { start: number; end: number }>());

  useEffect(() => {
    const abort = new AbortController();
    setDetail(null);
    fetch('/api/items/' + encodeURIComponent(item.Id), {
      credentials: 'same-origin', signal: abort.signal,
      headers: { accept: 'application/json' }
    }).then(async response => {
      if (!response.ok) throw new Error('Playback track information is unavailable.');
      return response.json();
    }).then((value: Details) => {
      if (abort.signal.aborted) return;
      setDetail(value);
      if (!value.MediaSources?.[0]?.Id) {
        setLoading(false);
        setStatus('No playable stream is available for this title.');
      }
    }).catch(err => {
      if (!abort.signal.aborted) {
        setLoading(false);
        setStatus(err instanceof Error ? err.message : 'Unable to load media tracks');
      }
    });
    return () => abort.abort();
  }, [item.Id]);

  const source = detail?.MediaSources?.[0];
  const streams = source?.MediaStreams || [];
  const audioTracks = useMemo(() => streams.filter(s => s.Type === 'Audio'), [streams]);
  const subtitleTracks = useMemo(() => streams.filter(isSubtitleUsable), [streams]);
  // 'Auto' follows the remembered subtitle language (set in the main menu, Settings, or the player).
  const autoSubtitle = prefs.subtitleLanguage === 'off' ? undefined
    : subtitleTracks.find(s => languageKey(s.Language) === prefs.subtitleLanguage);
  const activeSubtitle = subtitleChoice === 'auto'
    ? autoSubtitle?.Index.toString() ?? 'off'
    : subtitleChoice;
  const selectedSubtitle = subtitleTracks.find(s => String(s.Index) === activeSubtitle);

  const audioIndex = audioChoice === 'auto'
    ? audioTracks.find(track => track.Index === source?.DefaultAudioStreamIndex)?.Index ?? audioTracks[0]?.Index
    : Number(audioChoice);
  const syncUrl = autoSync && source?.Id && selectedSubtitle && audioIndex !== undefined
    ? `/api/subtitle-sync/${encodeURIComponent(item.Id)}/${encodeURIComponent(source.Id)}/${selectedSubtitle.Index}/${audioIndex}`
    : null;
  const alignedSubtitle = syncState?.url === syncUrl && syncState?.ready;

  // Remember an explicit subtitle choice as the preferred language for next time.
  function chooseSubtitle(value: string) {
    setSubtitleChoice(value);
    if (value === 'off') setPrefs({ subtitleLanguage: 'off' });
    else if (value !== 'auto') {
      const lang = languageKey(subtitleTracks.find(s => String(s.Index) === value)?.Language);
      if (lang) setPrefs({ subtitleLanguage: lang });
    }
  }

  // Intro / credits markers (when the server has them) and the next episode of a series.
  const segments = useQuery({ queryKey: ['segments', item.Id], staleTime: Infinity, retry: 0,
    queryFn: () => api<Segments>(`/api/items/${encodeURIComponent(item.Id)}/segments`) }).data;
  const episodes = useQuery({ queryKey: ['player-episodes', item.SeriesId], staleTime: 5 * 60_000,
    enabled: item.Type === 'Episode' && !!item.SeriesId,
    queryFn: () => api<PageResult>(`/api/series/${encodeURIComponent(item.SeriesId!)}/episodes`) }).data;
  const nextEpisode = useMemo(() => {
    const list = episodes?.Items ?? [];
    const at = list.findIndex(e => e.Id === item.Id);
    return at >= 0 ? list[at + 1] : undefined;
  }, [episodes, item.Id]);
  const [ended, setEnded] = useState(false);
  const [dismissedNext, setDismissedNext] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const credits = segments?.credits;
  const inCredits = !!credits && clock >= credits.start && (!duration || clock < duration - 1);
  const showNext = !!nextEpisode && !!onNext && !dismissedNext && (ended || inCredits);
  const autoNext = showNext && prefs.autoplayNext;
  useEffect(() => {
    if (!autoNext) return;
    setCountdown(10);
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [autoNext]);
  useEffect(() => { if (autoNext && countdown <= 0 && nextEpisode) onNext?.(nextEpisode); }, [autoNext, countdown, nextEpisode, onNext]);
  const intro = segments?.intro;
  const inIntro = !!intro && clock >= intro.start && clock < intro.end - 1;
  function skipIntro() {
    const v = videoRef.current;
    if (v && intro) { v.currentTime = intro.end; setClock(intro.end); }
  }

  const audioTrack = audioTracks.find(t => t.Index === audioIndex);
  const channels = audioTrack?.DisplayTitle?.match(/\b(\d\.\d)\b/)?.[1];
  // Prefer 'English 5.1'; without a language code fall back to Jellyfin's display title.
  const audioLabel = !audioTrack ? '' : audioTrack.Language ? [languageLabel(audioTrack.Language), channels].filter(Boolean).join(' ')
    : (audioTrack.DisplayTitle || audioTrack.Codec || '').split(' - ').slice(0, 2).join(' ').slice(0, 28);

  useEffect(() => {
    if (!syncUrl) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function check() {
      try {
        const response = await fetch(syncUrl!, { signal: abort.signal, cache: 'no-store' });
        await response.body?.cancel();
        if (abort.signal.aborted) return;
        if (response.status === 200) setSyncState({ url: syncUrl!, ready: true });
        else if (response.status === 202 && ++attempts < 24) {
          setSyncState({ url: syncUrl!, ready: false });
          timer = setTimeout(check, 10000);
        } else setSyncState(null);
      } catch {
        if (!abort.signal.aborted) setSyncState(null);
      }
    }
    void check();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [syncUrl]);

  function savePosition() {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.currentTime) && v.currentTime >= 0) resumeRef.current = v.currentTime;
    resumePlayingRef.current = !v.paused;
  }
  function jump(seconds: number) {
    const v = videoRef.current;
    if (!v) return;
    const target = Math.max(0, v.currentTime + seconds);
    v.currentTime = Number.isFinite(v.duration) ? Math.min(target, v.duration) : target;
    setClock(v.currentTime);
  }
  function delayBy(seconds: number) {
    setSubtitleDelay(d => Math.max(-15, Math.min(15, Math.round((d + seconds) * 4) / 4)));
  }
  // Always use compatible HLS for Jellyfin's MKV, DTS and E-AC-3 sources.
  // Direct-playing those files in Chromium can silently remove audio.
  function chooseAudio(value: string) {
    savePosition();
    setAudioChoice(value);
  }

  const toggleFullscreen = useCallback(async () => {
    const screen = screenRef.current;
    if (!screen) return;
    if (document.fullscreenElement === screen) {
      await document.exitFullscreen();
      return;
    }

    const desktop = window.crimsonfinFullscreen;
    if (!windowFullscreenRef.current && !desktop && !isTv && !/Electron\//i.test(navigator.userAgent)) {
      try {
        await screen.requestFullscreen();
        return;
      } catch {
        // A browser embedding policy can block native fullscreen.
      }
    }
    const enabled = !windowFullscreenRef.current;
    windowFullscreenRef.current = enabled;
    setFullscreen(enabled);
    await desktop?.set(enabled).catch(() => {});
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(windowFullscreenRef.current || document.fullscreenElement === screenRef.current);
    };
    const desktop = window.crimsonfinFullscreen;
    const unsubscribe = desktop?.onExit(() => {
      windowFullscreenRef.current = false;
      setFullscreen(false);
    });
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      unsubscribe?.();
      if (windowFullscreenRef.current) void desktop?.set(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!source?.Id) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let started = false;
    let disposed = false;
    const uri = buildHlsUrl(item.Id, source.Id, quality, audioChoice);

    function report(event: 'Playing' | 'Progress' | 'Stopped') {
      if (!started && event !== 'Playing') return;
      fetch('/api/playback', {
        method: 'POST', credentials: 'same-origin', keepalive: event === 'Stopped',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId: item.Id, positionTicks: Math.round((video!.currentTime || 0) * 10_000_000),
          isPaused: video!.paused, event, method: 'Transcode'
        })
      }).catch(() => {});
    }
    const onPlaying = () => {
      started = true;
      setEnded(false);
      setPlaying(true);
      setLoading(false);
      setStatus('');
      report('Playing');
    };
    const onPaused = () => { setPlaying(false); report('Progress'); };
    const showPlaybackError = (message: string) => {
      setLoading(false);
      setStatus(message);
    };
    const onError = () => showPlaybackError('Unable to play this stream. Try a lower quality.');
    const onTime = () => {
      if (Number.isFinite(video.currentTime)) setClock(Math.floor(video.currentTime));
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    };
    const restorePosition = () => {
      if (disposed) return;
      const position = resumeRef.current;
      if (position > 0.2 && Number.isFinite(video.duration) && video.duration > position) {
        try { video.currentTime = position; } catch {}
      }
    };
    const startPlayback = () => {
      setLoading(false);
      restorePosition();
      if (resumePlayingRef.current) video.play().catch(err => {
        if (disposed || err?.name === 'AbortError') return;
        if (err?.name === 'NotAllowedError') setStatus('Press Play to begin.');
        else onError();
      });
    };
    const onEnded = () => { setEnded(true); report('Stopped'); };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPaused);
    video.addEventListener('error', onError);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', restorePosition);
    video.addEventListener('canplay', startPlayback, { once: true });
    video.addEventListener('ended', onEnded);
    setPlaying(false);
    setLoading(true);
    setStatus('');

    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, backBufferLength: 30, maxBufferLength: 45, lowLatencyMode: false });
      hls.on(Hls.Events.ERROR, (_event, info) => {
        if (!disposed && info.fatal) showPlaybackError(`Stream error (${info.type}). ${info.details || 'Could not load video.'}`);
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(uri));
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = uri;
    } else showPlaybackError('HLS playback is unavailable in this browser.');

    const progress = setInterval(() => report('Progress'), 15_000);
    return () => {
      disposed = true;
      if (Number.isFinite(video.currentTime) && video.currentTime > 0) resumeRef.current = video.currentTime;
      resumePlayingRef.current = !video.paused;
      if (started) report('Stopped');
      clearInterval(progress);
      for (const [event, handler] of [
        ['playing', onPlaying], ['pause', onPaused], ['error', onError],
        ['timeupdate', onTime], ['loadedmetadata', restorePosition],
        ['canplay', startPlayback], ['ended', onEnded]
      ] as const) video.removeEventListener(event, handler);
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [item.Id, source?.Id, quality, audioChoice]);

  // Shift browser-rendered WebVTT cues without transcoding the video or
  // changing the saved subtitle file. Negative = show subtitle earlier.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    const adjust = () => {
      for (let index = 0; index < tracks.length; index++) {
        const track = tracks[index];
        const shouldShow = !!selectedSubtitle && track.language === (selectedSubtitle.Language || 'und')
          && track.label.endsWith(' · ' + selectedSubtitle.Index);
        track.mode = shouldShow ? 'showing' : 'disabled';
        if (!shouldShow || !track.cues) continue;
        for (let i = 0; i < track.cues.length; i++) {
          const cue = track.cues[i];
          if (!trackBasesRef.current.has(cue)) {
            trackBasesRef.current.set(cue, { start: cue.startTime, end: cue.endTime });
          }
          const original = trackBasesRef.current.get(cue)!;
          const start = Math.max(0, original.start + subtitleDelay);
          const end = Math.max(start + 0.05, original.end + subtitleDelay);
          if (Math.abs(cue.startTime - start) > 0.001) cue.startTime = start;
          if (Math.abs(cue.endTime - end) > 0.001) cue.endTime = end;
        }
      }
    };
    const timer = setInterval(adjust, 750);
    adjust();
    return () => clearInterval(timer);
  }, [activeSubtitle, selectedSubtitle?.Index, subtitleDelay, source?.Id, alignedSubtitle]);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const exitDialog = exitDialogRef.current;
      if (e.key === 'Escape') {
        if (e.repeat) { e.preventDefault(); return; }
        if (e.defaultPrevented) return;
        if (windowFullscreenRef.current || document.fullscreenElement === screenRef.current) {
          e.preventDefault();
          void toggleFullscreen();
          return;
        }
        if (showOptions) { e.preventDefault(); setShowOptions(false); return; }
        if (document.fullscreenElement || !exitDialog || exitDialog.open) return;
        e.preventDefault();
        exitDialog.showModal();
        return;
      }
      if (exitDialog?.open) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const onButton = target?.tagName === 'BUTTON';
      const key = e.key.toLowerCase();
      // Space/Enter on a focused button should press that button, not toggle playback.
      if ((key === ' ' || key === 'k') && !onButton) { e.preventDefault(); togglePlay(); }
      else if (key === 'f') { e.preventDefault(); void toggleFullscreen(); }
      else if (key === 'm') { e.preventDefault(); toggleMute(); }
      else if (key === 'c') { e.preventDefault(); toggleSubtitles(); }
      else if (key === 'n' && nextEpisode && onNext) { e.preventDefault(); onNext(nextEpisode); }
      else if (onButton) return;
      else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-10); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); jump(10); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); changeVolume(0.1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); changeVolume(-0.1); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  // Controls hide after a few seconds of no mouse/remote activity while playing.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), isTv ? 5000 : 3000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake, true);
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted, source?.Id]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v || !source) return;
    if (v.paused) v.play().catch(err => { if (err?.name !== 'AbortError') setStatus('Playback could not start.'); });
    else v.pause();
  }
  function toggleMute() { setMuted(m => !m); }
  function changeVolume(delta: number) {
    setMuted(false);
    setVolume(v => Math.max(0, Math.min(1, Math.round((v + delta) * 10) / 10)));
  }
  function toggleSubtitles() {
    if (activeSubtitle === 'off') {
      // Prefer the last explicit track, then the 'auto' language match, then the first usable track.
      const last = lastSubtitleRef.current;
      const remembered = last !== 'off' && last !== 'auto' && subtitleTracks.some(s => String(s.Index) === last) ? last : null;
      const next = remembered ?? (autoSubtitle ? 'auto' : subtitleTracks[0] ? String(subtitleTracks[0].Index) : null);
      if (next) setSubtitleChoice(next);
    }
    else { lastSubtitleRef.current = subtitleChoice; setSubtitleChoice('off'); }
  }

  const mediaId = source?.Id;
  const fullscreenLabel = fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
  const subtitleLabel = selectedSubtitle ? `Subtitles: ${languageLabel(selectedSubtitle.Language)} (C)` : 'Subtitles off (C)';
  const max = Math.max(1, duration);
  const hidden = idle && playing && !showOptions && !status;
  const cueClass = `cue-${prefs.subtitleSize} cue-bg-${prefs.subtitleBackground}`;
  return <div className={`player ${cueClass}${hidden ? ' idle' : ''}`} role="dialog" aria-label={`Playing ${mediaTitle}`} aria-modal="true">
    <div className={fullscreen ? 'player-screen is-fullscreen' : 'player-screen'} ref={screenRef}
      onClick={e => { if (!isTv && e.target === videoRef.current) togglePlay(); }}
      onDoubleClick={e => { if (!isTv && e.target === videoRef.current) void toggleFullscreen(); }}>
      <video ref={videoRef} playsInline preload="metadata">
        {mediaId && subtitleTracks.map(stream => (
          <track key={`${stream.Index}-${stream.Index === selectedSubtitle?.Index && alignedSubtitle ? syncUrl : 'original'}`} kind="subtitles"
            srcLang={stream.Language || 'und'}
            label={`${stream.DisplayTitle || languageLabel(stream.Language)} · ${stream.Index}`}
            src={stream.Index === selectedSubtitle?.Index && alignedSubtitle && syncUrl
              ? syncUrl : `/jellyfin/Videos/${encodeURIComponent(item.Id)}/${encodeURIComponent(mediaId)}/Subtitles/${stream.Index}/Stream.vtt`}/>
        ))}
      </video>
      {(status || loading) && <div className="player-message" role="status">
        {status ? <><Clapperboard aria-hidden/><span>{status}</span></> : <span className="spinner" aria-label="Preparing video"/>}
      </div>}

      <header className="player-top">
        <button className="player-icon" title="Back (Esc)" aria-label="Back to library" onClick={onClose}><ArrowLeft aria-hidden/></button>
        <div className="player-title"><strong>{mediaTitle}</strong>
          {item.SeriesName && <small>{item.Name}</small>}</div>
        <span className="player-badge"><i className="dot dot-green" aria-hidden/>{loading ? 'Preparing…' : [audioLabel, `${quality / 1_000_000} Mbps`].filter(Boolean).join(' · ')}</span>
      </header>

      <div className="player-bottom">
        <div className="seek" onMouseMove={e => {
          if (isTv) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
          setHover({ x, time: (x / r.width) * max });
        }} onMouseLeave={() => setHover(null)}>
          {hover && duration > 0 && <span className="seek-preview" style={{ left: hover.x }}>{formatTime(hover.time)}</span>}
          <input type="range" min={0} max={max} step={0.25} value={Math.min(clock, max)} aria-label="Playback position"
            aria-valuetext={`${formatTime(clock)} of ${formatTime(duration)}`}
            style={{ '--played': `${(Math.min(clock, max) / max) * 100}%` } as React.CSSProperties}
            onChange={e => { const v = videoRef.current; if (v) v.currentTime = Number(e.target.value); setClock(Number(e.target.value)); }}/>
        </div>
        <div className="player-controls">
          <div className="group">
            <button className="player-icon main" title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}
              autoFocus={isTv} onClick={togglePlay}>{playing ? <Pause fill="currentColor" aria-hidden/> : <Play fill="currentColor" aria-hidden/>}</button>
            <button className="player-icon" title="Back 10 seconds (←)" aria-label="Back 10 seconds" onClick={() => jump(-10)}><RotateCcw aria-hidden/></button>
            <button className="player-icon" title="Forward 10 seconds (→)" aria-label="Forward 10 seconds" onClick={() => jump(10)}><RotateCw aria-hidden/></button>
            {!isTv && <span className="volume">
              <button className="player-icon" title={muted ? 'Unmute (M)' : 'Mute (M)'} aria-label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
                {muted || volume === 0 ? <VolumeX aria-hidden/> : <Volume2 aria-hidden/>}</button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume"
                style={{ '--played': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
                onChange={e => { setMuted(false); setVolume(Number(e.target.value)); }}/>
            </span>}
            <span className="time">{formatTime(clock)} / {formatTime(duration)}</span>
          </div>
          <div className="group">
            {nextEpisode && onNext && <button className="player-icon" title="Next episode (N)" aria-label="Next episode" onClick={() => onNext(nextEpisode)}>
              <SkipForward aria-hidden/>{isTv && <span>Next</span>}</button>}
            <button className={selectedSubtitle ? 'player-icon on' : 'player-icon'} title={subtitleLabel} aria-label={subtitleLabel}
              aria-pressed={!!selectedSubtitle} onClick={toggleSubtitles}><Captions aria-hidden/>{isTv && <span>{selectedSubtitle ? languageLabel(selectedSubtitle.Language) : 'Off'}</span>}</button>
            <button className={showOptions ? 'player-icon on' : 'player-icon'} title="Audio, subtitles & quality" aria-label="Audio, subtitles and quality"
              aria-expanded={showOptions} onClick={() => setShowOptions(s => !s)}><Settings2 aria-hidden/>{isTv && <span>Tracks</span>}</button>
            <button className="player-icon" title={fullscreenLabel} aria-label={fullscreenLabel} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize aria-hidden/> : <Maximize aria-hidden/>}</button>
          </div>
        </div>
      </div>

      {inIntro && !showNext && <button className="skip-intro" autoFocus={isTv} onClick={skipIntro}>Skip intro</button>}

      {showNext && nextEpisode && <section className="up-next" aria-label="Up next" aria-live="polite">
        <span className="up-next-art"><img src={itemArt(nextEpisode, 'Primary', 400)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }}/></span>
        <span className="up-next-text">
          <small>{autoNext ? `Next episode in ${Math.max(0, countdown)}s` : 'Next episode'}</small>
          <strong>S{nextEpisode.ParentIndexNumber} · E{nextEpisode.IndexNumber}  {nextEpisode.Name}</strong>
        </span>
        <span className="actions">
          <button className="btn small primary" autoFocus={isTv} onClick={() => onNext?.(nextEpisode)}><Play fill="currentColor" aria-hidden/> Play now</button>
          <button className="btn small" onClick={() => setDismissedNext(true)}>{autoNext ? 'Cancel' : 'Dismiss'}</button>
        </span>
      </section>}

      {showOptions && <section className="player-panel" aria-label="Playback options">
        <header><strong>Playback options</strong>
          <button className="player-icon" aria-label="Close options" onClick={() => setShowOptions(false)}><X aria-hidden/></button></header>
        <label className="field"><span><Volume2 aria-hidden/> Audio</span>
          <select value={audioChoice} onChange={e => chooseAudio(e.target.value)} disabled={!source}>
            <option value="auto">Default track</option>
            {audioTracks.map(a => <option key={a.Index} value={String(a.Index)}>
              {languageLabel(a.Language)} · {a.DisplayTitle || a.Codec || 'Audio'} {a.IsDefault ? '(Default)' : ''}
            </option>)}
          </select></label>
        <label className="field"><span><Captions aria-hidden/> Subtitles</span>
          <select value={subtitleChoice} onChange={e => chooseSubtitle(e.target.value)} disabled={!source}>
            <option value="auto">{prefs.subtitleLanguage === 'off'
              ? 'Auto · subtitles off'
              : `Auto · prefer ${languageLabel(prefs.subtitleLanguage)}`}</option>
            <option value="off">Off</option>
            {subtitleTracks.map(s => <option key={s.Index} value={String(s.Index)}>
              {languageLabel(s.Language)} · {s.DisplayTitle || s.Codec || 'Subtitles'}
            </option>)}
          </select></label>
        <label className="field"><span><SlidersHorizontal aria-hidden/> Quality</span>
          <select value={quality} onChange={e => { savePosition(); setQuality(Number(e.target.value)); }}>
            <option value={4_000_000}>4 Mbps · Data saver</option>
            <option value={8_000_000}>8 Mbps · HD</option>
            <option value={12_000_000}>12 Mbps · Full HD</option>
            <option value={20_000_000}>20 Mbps · High</option>
          </select></label>
        <div className="sync">
          <div className="sync-head"><span>Subtitle timing</span><strong>{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(2)} s</strong></div>
          <label className="check"><input type="checkbox" checked={autoSync}
            onChange={e => { setAutoSync(e.target.checked); setSyncState(null); }}/><span className="box" aria-hidden>✓</span>Auto-sync to dialogue</label>
          {syncState && syncState.url === syncUrl && <small role="status">
            {alignedSubtitle ? 'Timing adjusted to the selected audio.' : 'Analyzing dialogue timing…'}</small>}
          <div className="sync-buttons">
            <button className="btn small" onClick={() => delayBy(-0.5)} title="Show captions 0.5 s earlier">− 0.5 s</button>
            <input type="range" min={-10} max={10} step={0.25} value={subtitleDelay} aria-label="Subtitle timing offset in seconds"
              style={{ '--played': `${((subtitleDelay + 10) / 20) * 100}%` } as React.CSSProperties}
              onChange={e => setSubtitleDelay(Number(e.target.value))}/>
            <button className="btn small" onClick={() => delayBy(0.5)} title="Show captions 0.5 s later">+ 0.5 s</button>
            <button className="btn small" onClick={() => setSubtitleDelay(0)}>Reset</button>
          </div>
          <small>Negative shows captions earlier, positive later. Only the display changes, not the subtitle file.</small>
        </div>
      </section>}
    </div>
    <dialog ref={exitDialogRef} className="dialog" aria-labelledby="player-exit-title">
      <h2 id="player-exit-title">Leave playback?</h2>
      <div className="actions">
        <button className="btn" autoFocus onClick={() => exitDialogRef.current?.close()}>Keep watching</button>
        <button className="btn primary" onClick={onClose}>Back to library</button>
      </div>
    </dialog>
  </div>;
}
