import { useSyncExternalStore } from 'react';

/** Display and playback preferences remembered on this device. */
export type Prefs = {
  titleLanguage: 'en' | 'ro';
  /** Preferred subtitle language: an ISO 639 code ('ro', 'en', 'fr', …) or 'off'. */
  subtitleLanguage: string;
  subtitleSize: 'normal' | 'large' | 'xlarge';
  subtitleBackground: 'solid' | 'shadow' | 'none';
  autoplayNext: boolean;
};
const defaults: Prefs = { titleLanguage: 'ro', subtitleLanguage: 'ro', subtitleSize: 'normal', subtitleBackground: 'solid', autoplayNext: true };
const key = 'crimsonfin.prefs';
const listeners = new Set<() => void>();
let current: Prefs = load();

function load(): Prefs {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...defaults }; }
}
export function getPrefs() { return current; }
export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(key, JSON.stringify(current)); } catch {}
  listeners.forEach(l => l());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

/** ISO 639-1/639-2 codes that mean the same language (Jellyfin reports either). */
const aliases: Record<string, string[]> = {
  ro: ['ro', 'ron', 'rum', 'ro-ro'], en: ['en', 'eng'], fr: ['fr', 'fra', 'fre'], de: ['de', 'deu', 'ger'],
  es: ['es', 'spa'], it: ['it', 'ita'], hu: ['hu', 'hun'], ja: ['ja', 'jpn'], pt: ['pt', 'por'], ru: ['ru', 'rus']
};
/** Normalise a track language to the short code used in preferences. */
export function languageKey(value?: string) {
  const v = (value || '').trim().toLowerCase().replace(/_/g, '-');
  const base = v.split('-')[0];
  return Object.keys(aliases).find(k => aliases[k].includes(base)) || v;
}
export const subtitleLanguages: [string, string][] = [
  ['ro', 'Romanian'], ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'],
  ['hu', 'Hungarian'], ['ja', 'Japanese'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['off', 'Off']
];
