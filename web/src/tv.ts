export const isTv = navigator.userAgent.includes('CrimsonFinTV/');

const selector = 'button, a[href], input, select, textarea, [tabindex]';
const directions = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
} as const;

function focusable(element: HTMLElement) {
  return element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0
    && getComputedStyle(element).visibility === 'visible';
}
function region() {
  return document.querySelector<HTMLElement>('dialog[open]') || document.querySelector<HTMLElement>('.player-page, .details-panel');
}
function controls() {
  return [...(region() || document).querySelectorAll<HTMLElement>(selector)].filter(focusable);
}
function focus(element?: HTMLElement) {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function enableTvNavigation() {
  if (!isTv) return;
  document.documentElement.classList.add('crimsonfin-tv');
  let previousRegion: HTMLElement | null = null;
  const restore = new Map<HTMLElement, HTMLElement>();
  const ensureFocus = () => {
    const currentRegion = region();
    const active = document.activeElement;
    if (currentRegion !== previousRegion) {
      const prior = previousRegion;
      previousRegion = currentRegion;
      if (prior && restore.has(prior)) {
        const target = restore.get(prior)!;
        if (target.isConnected && focusable(target) && (!currentRegion || currentRegion.contains(target))) focus(target);
        restore.delete(prior);
      }
      if (currentRegion && active instanceof HTMLElement && !currentRegion.contains(active)) restore.set(currentRegion, active);
    }
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !focused.matches(selector) || !focusable(focused)
      || (currentRegion && !currentRegion.contains(focused))) {
      focus(controls().find(el => el.matches('.player-fullscreen, .login-card input, .btn-primary')) || controls()[0]);
    }
  };
  const observer = new MutationObserver(ensureFocus);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'disabled'] });
  document.addEventListener('keydown', event => {
    const active = document.activeElement;
    if (event.key === 'Escape') {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
      const details = document.querySelector<HTMLButtonElement>('.details-panel .modal-close');
      if (dialog || details) {
        event.preventDefault();
        event.stopPropagation();
        if (dialog) dialog.close();
        else details?.click();
      }
      return;
    }
    if (event.key === 'MediaPlayPause' || event.key === 'MediaPlay' || event.key === 'MediaPause') {
      const video = document.querySelector('video');
      if (video) {
        event.preventDefault();
        if (event.key === 'MediaPlay' || (event.key === 'MediaPlayPause' && video.paused)) void video.play().catch(() => {});
        else video.pause();
      }
      return;
    }
    if (!(event.key in directions) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (active instanceof HTMLInputElement &&
      ((active.type === 'range' && ['ArrowLeft', 'ArrowRight'].includes(event.key))
        || (['text', 'search', 'password', 'email'].includes(active.type) && ['ArrowLeft', 'ArrowRight'].includes(event.key)))) {
      event.stopPropagation();
      return;
    }
    const list = controls();
    event.preventDefault();
    event.stopPropagation();
    if (!(active instanceof HTMLElement) || !list.includes(active)) {
      focus(list[0]);
      return;
    }
    const [dx, dy] = directions[event.key as keyof typeof directions];
    const rect = active.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    let next: HTMLElement | undefined;
    let score = Infinity;
    for (const element of list) {
      const other = element.getBoundingClientRect();
      const horizontal = other.left + other.width / 2 - x;
      const vertical = other.top + other.height / 2 - y;
      const forward = dx * horizontal + dy * vertical;
      if (forward < 1) continue;
      const cross = Math.abs(dy * horizontal + dx * vertical);
      const rank = forward + 4 * cross;
      if (rank < score) { score = rank; next = element; }
    }
    focus(next);
  }, true);
}
