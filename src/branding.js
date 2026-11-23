// Theme branding is kept independent from playback and Jellyfin images.
// SVG markup is inline so inherited CSS variables can recolor the real logo.
export const THEME_COLORS = Object.freeze({
  "crimson": {
    "high": "#ff9cab",
    "mid": "#ef3e63",
    "low": "#a41340",
    "frame": "#170911",
    "play": "#fff4f6"
  },
  "ocean": {
    "high": "#8eecff",
    "mid": "#28b9e8",
    "low": "#086897",
    "frame": "#071923",
    "play": "#f0fbff"
  },
  "violet": {
    "high": "#e5cfff",
    "mid": "#a87bfa",
    "low": "#6437b6",
    "frame": "#130a27",
    "play": "#fff9ff"
  },
  "emerald": {
    "high": "#b2ffe0",
    "mid": "#43d6a2",
    "low": "#147757",
    "frame": "#081d15",
    "play": "#effff8"
  },
  "gold": {
    "high": "#ffe4a7",
    "mid": "#edb95d",
    "low": "#a16a1c",
    "frame": "#24180b",
    "play": "#fffbf1"
  },
  "mono": {
    "high": "#ffffff",
    "mid": "#bfc9d8",
    "low": "#586a7e",
    "frame": "#111720",
    "play": "#ffffff"
  }
});
export function validTheme(theme) {
  return Object.hasOwn(THEME_COLORS, theme) ? theme : 'crimson';
}
export function brandMarkSvg(prefix = 'crimsonfin') {
  const safe = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'crimsonfin';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="theme-brand-mark" viewBox="0 0 512 512" role="img" aria-label="CrimsonFin logo" focusable="false">
<defs>
<linearGradient id="${safe}-fill" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" style="stop-color:var(--logo-high,#ff9cab)"/>
<stop offset=".45" style="stop-color:var(--logo-mid,#ef3e63)"/>
<stop offset="1" style="stop-color:var(--logo-low,#a41340)"/>
</linearGradient>
<linearGradient id="${safe}-sheen" x1="0" x2="1" y1="0" y2="1">
<stop offset="0" stop-color="#ffffff" stop-opacity=".65"/>
<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</linearGradient>
</defs>
<rect x="20" y="20" width="472" height="472" rx="122" style="fill:var(--logo-frame,#170911)"/>
<rect x="33" y="33" width="446" height="446" rx="108" fill="url(#${safe}-fill)"/>
<path d="M74 182Q74 91 194 73" fill="none" stroke="url(#${safe}-sheen)" stroke-width="17" stroke-linecap="round"/>
<path d="M163 131C195 111 225 105 258 105c83 0 147 45 165 115" fill="none" stroke="#000000" stroke-opacity=".32" stroke-width="28" stroke-linecap="round"/>
<path d="M349 349a134 134 0 0 1-204-25" fill="none" stroke="#000000" stroke-opacity=".32" stroke-width="28" stroke-linecap="round"/>
<path d="M210 160c0-16 17-26 31-18l155 96c14 9 14 28 0 36l-155 96c-14 9-31-1-31-17z" fill="#000000" opacity=".28" transform="translate(0 12)"/>
<path d="M190 154c0-19 21-31 37-21l175 108c16 10 16 31 0 41L227 390c-16 10-37-2-37-21z" style="fill:var(--logo-play,#fff4f6)"/>
<path d="M190 154c0-19 21-31 37-21l175 108c16 10 16 31 0 41L227 390c-16 10-37-2-37-21z" fill="url(#${safe}-sheen)" opacity=".34"/>
<circle cx="400" cy="107" r="17" style="fill:var(--logo-high,#ff9cab)" opacity=".86"/>
</svg>`;
}
// Browser-tab icon also matches the selected palette. Native .exe/.deb icons
// are build-time assets and deliberately remain the CrimsonFin red icon.
export function themedFaviconSvg(theme) {
  const c = THEME_COLORS[validTheme(theme)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c.high}"/><stop offset=".55" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.low}"/></linearGradient></defs><rect x="5" y="5" width="118" height="118" rx="29" fill="${c.frame}"/><rect x="10" y="10" width="108" height="108" rx="26" fill="url(#f)"/><path d="M46 32c0-5 6-8 10-5l48 29c5 3 5 9 0 12L56 98c-4 3-10 0-10-5z" fill="${c.play}"/></svg>`;
}
export function setThemeFavicon(doc, theme) {
  const icon = doc.querySelector('link[rel="icon"]');
  if (icon) {
    icon.type = 'image/svg+xml';
    icon.href = `data:image/svg+xml,${encodeURIComponent(themedFaviconSvg(theme))}`;
  }
}
