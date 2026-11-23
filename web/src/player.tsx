import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { buildHlsUrl } from './hls-url';
import { ArrowLeft, Captions, ChevronDown, Clapperboard, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Settings2, SlidersHorizontal, Volume2 } from 'lucide-react';

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
type PlayerItem = { Id: string; Name: string; SeriesName?: string; UserData?: { PlaybackPositionTicks?: number } };
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

export function Player({ item, onClose }: { item: PlayerItem; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const exitDialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Details | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [quality, setQuality] = useState(12_000_000);
  const [audioChoice, setAudioChoice] = useState('auto');
  const [subtitleChoice, setSubtitleChoice] = useState('auto');
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [showOptions, setShowOptions] = useState(true);
  const [clock, setClock] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const resumeRef = useRef(Math.max(0, (item.UserData?.PlaybackPositionTicks || 0) / 10_000_000));
  const resumePlayingRef = useRef(true);
  const trackBasesRef = useRef(new Map<TextTrackCue, { start: number; end: number }>());

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
  const autoSubtitle = subtitleTracks.find(s => ROMANIAN.has((s.Language || '').toLowerCase()));
  const activeSubtitle = subtitleChoice === 'auto'
    ? autoSubtitle?.Index.toString() ?? 'off'
    : subtitleChoice;
  const selectedSubtitle = subtitleTracks.find(s => String(s.Index) === activeSubtitle);

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
    setFullscreenError('');
    try {
      if (document.fullscreenElement === screen) await document.exitFullscreen();
      else await screen.requestFullscreen();
    } catch {
      setFullscreenError('Could not switch fullscreen mode.');
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === screenRef.current);
      setFullscreenError('');
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
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
    const onEnded = () => report('Stopped');
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
  }, [activeSubtitle, selectedSubtitle?.Index, subtitleDelay, source?.Id]);

  useEffect(() => {
    trackBasesRef.current.clear();
  }, [source?.Id]);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const exitDialog = exitDialogRef.current;
      if (e.key === 'Escape') {
        if (e.repeat) { e.preventDefault(); return; }
        if (e.defaultPrevented) return;
        if (document.fullscreenElement === screenRef.current) {
          e.preventDefault();
          void toggleFullscreen();
          return;
        }
        if (document.fullscreenElement || !exitDialog || exitDialog.open) return;
        e.preventDefault();
        exitDialog.showModal();
        return;
      }
      if (exitDialog?.open) return;
      if (e.target instanceof HTMLElement &&
          ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-10); }
      if (e.key === 'ArrowRight') { e.preventDefault(); jump(10); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [toggleFullscreen]);

  const mediaId = source?.Id;
  const fullscreenLabel = fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  return <div className="player-page" role="dialog" aria-label={`Playing ${item.Name}`} aria-modal="true">
    <header className="player-top">
      <button className="player-back" title="Return to library" onClick={onClose}><ArrowLeft size={22}/></button>
      <div className="player-title"><span className="player-eyebrow">NOW PLAYING</span><strong>{item.SeriesName || item.Name}</strong><small>{item.SeriesName ? item.Name : 'CrimsonFin Theater'}</small></div>
      <span className="player-badge"><span className="player-live"/> HLS · AAC audio</span>
      <button className="player-settings-button" title="Toggle player settings" onClick={() => setShowOptions(s => !s)}><Settings2 size={18}/> Audio & subtitles <ChevronDown size={14}/></button>
    </header>

    <div className="player-screen" ref={screenRef}>
      <video ref={videoRef} controls controlsList={document.fullscreenEnabled ? 'nofullscreen' : undefined} playsInline preload="metadata">
        {mediaId && subtitleTracks.map(stream => (
          <track key={stream.Index} kind="subtitles"
            srcLang={stream.Language || 'und'}
            label={`${stream.DisplayTitle || languageLabel(stream.Language)} · ${stream.Index}`}
            src={`/jellyfin/Videos/${encodeURIComponent(item.Id)}/${encodeURIComponent(mediaId)}/Subtitles/${stream.Index}/Stream.vtt`}/>
        ))}
      </video>
      {document.fullscreenEnabled && <button className="player-fullscreen" title={fullscreenLabel}
        aria-label={fullscreenLabel} onClick={toggleFullscreen}>
        {fullscreen ? <Minimize size={19}/> : <Maximize size={19}/>}
      </button>}
      {(fullscreenError || status) && <div className="player-message" role="status">
        <Clapperboard size={21}/><span>{fullscreenError || status}</span>
      </div>}
    </div>

    <div className="player-dock">
      <div className="player-timeline">
        <span>{formatTime(clock)}</span>
        <input type="range" min={0} max={Math.max(1, duration)} step={0.25} value={Math.min(clock, Math.max(1, duration))}
          aria-label="Playback position" onChange={e => { const v=videoRef.current; if (v) v.currentTime=Number(e.target.value); setClock(Number(e.target.value)); }}/>
        <span>{formatTime(duration)}</span>
      </div>
      <div className="player-transport">
        <div className="player-transport-left">
          <button title="Go back 10 seconds" onClick={() => jump(-10)}><RotateCcw size={18}/> <span>10</span></button>
          <button title={playing ? 'Pause' : 'Play'} className="player-playbutton" onClick={() => {
            const v = videoRef.current;
            if (!v || !source) return;
            if (v.paused) v.play().catch(err => {
              if (err?.name !== 'AbortError') setStatus('Playback could not start.');
            });
            else v.pause();
          }}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button>
          <button title="Go forward 10 seconds" onClick={() => jump(10)}><RotateCw size={18}/> <span>10</span></button>
          <span className="player-current-mode" role="status">
            {loading ? 'Preparing video…' : playing ? 'Playing · HLS' : 'Paused · HLS'}
          </span>
        </div>
        <div className="player-transport-right">
          <button title="Adjust subtitles" onClick={() => setShowOptions(s => !s)}><Captions size={19}/> Tracks & sync</button>
        </div>
      </div>
      {showOptions && <div className="player-control-grid">
        <label className="player-field"><span><Volume2 size={14}/> AUDIO TRACK</span>
          <select value={audioChoice} onChange={e => chooseAudio(e.target.value)} disabled={!source}>
            <option value="auto">Default track</option>
            {audioTracks.map(a => <option key={a.Index} value={String(a.Index)}>
              {languageLabel(a.Language)} · {a.DisplayTitle || a.Codec || 'Audio'} {a.IsDefault ? '(Default)' : ''}
            </option>)}
          </select>
        </label>
        <label className="player-field"><span><Captions size={14}/> SUBTITLES</span>
          <select value={subtitleChoice} onChange={e => { setSubtitleChoice(e.target.value); }} disabled={!source}>
            <option value="auto">Auto · Prefer Romanian</option>
            <option value="off">Off</option>
            {subtitleTracks.map(s => <option key={s.Index} value={String(s.Index)}>
              {languageLabel(s.Language)} · {s.DisplayTitle || s.Codec || 'Subtitles'}
            </option>)}
          </select>
        </label>
        <label className="player-field"><span><SlidersHorizontal size={14}/> QUALITY</span>
          <select value={quality} onChange={e => { savePosition(); setQuality(Number(e.target.value)); }}>
            <option value={4_000_000}>4 Mbps · Data saver</option>
            <option value={8_000_000}>8 Mbps · HD</option>
            <option value={12_000_000}>12 Mbps · Full HD</option>
            <option value={20_000_000}>20 Mbps · High</option>
          </select>
        </label>

        <div className="player-sync-control">
          <div className="player-sync-top"><span><Captions size={14}/> SUBTITLE TIMING OFFSET</span><strong>{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(2)}s</strong></div>
          <div className="player-sync-inputs">
            <button onClick={() => delayBy(-0.5)} title="Show captions 0.5 seconds earlier">− 0.5s</button>
            <input type="range" min={-10} max={10} step={0.25} value={subtitleDelay}
              aria-label="Subtitle timing offset in seconds" onChange={e => setSubtitleDelay(Number(e.target.value))}/>
            <button onClick={() => delayBy(0.5)} title="Show captions 0.5 seconds later">+ 0.5s</button>
            <button onClick={() => setSubtitleDelay(0)} title="Reset subtitle timing">Reset</button>
          </div>
          <small>Negative shows captions earlier; positive shows them later. Only the playback display changes, not the subtitle file.</small>
        </div>
      </div>}
    </div>
    <dialog ref={exitDialogRef} className="player-exit-dialog" aria-labelledby="player-exit-title">
      <h2 id="player-exit-title">Leave playback?</h2>
      <div className="player-exit-actions">
        <button className="btn btn-ghost" autoFocus onClick={() => exitDialogRef.current?.close()}>Keep watching</button>
        <button className="btn btn-primary" onClick={onClose}>Return to library</button>
      </div>
    </dialog>
  </div>;
}
