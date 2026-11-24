import { QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export type Account = { id: string; name: string; isAdmin: boolean };
export type Item = {
  ImageTags?: { Primary?: string; Thumb?: string }; BackdropImageTags?: string[];
  Id: string; Name: string; Type: string; Overview?: string; ProductionYear?: number;
  CommunityRating?: number; RunTimeTicks?: number; Genres?: string[]; DateCreated?: string;
  UserData?: { IsFavorite?: boolean; PlaybackPositionTicks?: number; PlayedPercentage?: number; Played?: boolean };
  IndexNumber?: number; IndexNumberEnd?: number; ParentIndexNumber?: number;
  SeriesId?: string; SeriesName?: string; ChildCount?: number;
  MediaSources?: { Container?: string; MediaStreams?: { Codec?: string; Type?: string; DisplayTitle?: string; Language?: string }[] }[];
};
export type PageResult = { Items: Item[]; TotalRecordCount: number };
export type RequestEntry = {
  id: string; user_name: string; title: string; kind: 'movie' | 'series'; year?: number; notes: string;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled'; created_at: number;
  download_state?: string | null; download_detail?: string | null; release_name?: string | null; destination?: string | null;
};
export type Release = { id: string; name: string; size: string; seeders: number | null; downloadable?: boolean };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin', ...init,
      signal: init.signal || AbortSignal.timeout(20000),
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers }
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('The server took too long to respond. Check your connection and try again.');
    }
    throw error;
  }
  let data: any;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status });
  return data as T;
}
export const statusOf = (error: unknown) =>
  error && typeof error === 'object' && 'status' in error ? (error as { status?: number }).status : undefined;

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 40_000, refetchOnWindowFocus: false } } });

export type ArtKind = 'Primary' | 'Backdrop' | 'Thumb';
export const art = (id: string, kind: ArtKind = 'Primary', width?: number) =>
  `/jellyfin/Items/${encodeURIComponent(id)}/Images/${kind}?maxWidth=${width ?? (kind === 'Backdrop' ? 1600 : 540)}&quality=84`;

/** Landscape artwork for an item: episode stills, else the backdrop (falls back to the series). */
export function wideArt(item: Item): string[] {
  if (item.Type === 'Episode') {
    return [item.ImageTags?.Primary ? art(item.Id, 'Primary', 720) : '', item.SeriesId ? art(item.SeriesId, 'Backdrop', 720) : '']
      .filter(Boolean);
  }
  return [art(item.Id, 'Backdrop', 720), art(item.Id, 'Thumb', 720)];
}

export function runtime(ticks?: number) {
  if (!ticks) return '';
  const minutes = Math.round(ticks / 600_000_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}
export function minutesLeft(item: Item) {
  const total = item.RunTimeTicks || 0, at = item.UserData?.PlaybackPositionTicks || 0;
  if (!total || !at) return '';
  const left = Math.max(1, Math.round((total - at) / 600_000_000));
  return left >= 60 ? `${Math.floor(left / 60)}h ${String(left % 60).padStart(2, '0')}m left` : `${left} min left`;
}
export function episodeCode(item: Item) {
  if (item.Type !== 'Episode') return '';
  const end = item.IndexNumberEnd && item.IndexNumberEnd !== item.IndexNumber ? `–E${item.IndexNumberEnd}` : '';
  return `S${item.ParentIndexNumber ?? '?'} · E${item.IndexNumber ?? '?'}${end}`;
}
export function progressOf(item: Item) {
  const pct = item.UserData?.PlayedPercentage;
  if (pct && pct > 0) return Math.min(100, pct);
  const total = item.RunTimeTicks || 0, at = item.UserData?.PlaybackPositionTicks || 0;
  return total && at ? Math.min(100, (at / total) * 100) : 0;
}
export const isPlayable = (item: Item) => item.Type !== 'Series';

// Never display LAN/Tailscale addresses in the app UI. The friendly label describes
// the route the user took; it does not conceal the network destination from the OS.
export const connectionLabel = (() => {
  const host = window.location.hostname.toLowerCase();
  const local = host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.') ||
    host.endsWith('.local') || host.startsWith('192.168.') || host.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  return local ? 'Local' : 'Remote';
})();

export function useDebounced<T>(value: T, ms = 260) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

/**
 * Accent colour sampled from a title's artwork (same-origin, so the canvas isn't tainted).
 * Returns a readable, saturated colour plus a text colour for buttons filled with it.
 */
export function useArtworkAccent(url?: string) {
  const [accent, setAccent] = useState<{ color: string; text: string } | null>(null);
  useEffect(() => {
    setAccent(null);
    if (!url) return;
    let live = true;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!live) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24; canvas.height = 14;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let best = { score: -1, h: 0, s: 0 };
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          const score = s * (1 - Math.abs(l - 0.5) * 1.6);
          if (score > best.score) best = { score, h, s };
        }
        if (best.score < 0.08) return; // greyscale artwork: keep the theme accent
        const color = `hsl(${Math.round(best.h * 360)} ${Math.round(Math.max(0.55, best.s) * 100)}% 72%)`;
        setAccent({ color, text: '#0e0d10' });
      } catch { /* cross-origin or decode failure: keep theme accent */ }
    };
    image.src = url;
    return () => { live = false; };
  }, [url]);
  return accent;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
