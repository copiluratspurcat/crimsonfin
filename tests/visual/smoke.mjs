// Browser smoke test: runs the built web app against the mock gateway (tools/mock-server.mjs)
// in a real Chromium browser, once as the PC layout and once as the Android TV layout, checks
// the behaviours below and saves screenshots to tests/visual/out/ for a human (or LLM) to look at.
//
//   npm run build && npm run test:visual            (both layouts)
//   node tests/visual/smoke.mjs pc                  (one layout)
//
// Needs Chrome, Edge or Chromium installed. Set CRIMSONFIN_BROWSER to its executable if it isn't
// found automatically. Exits 1 if any check fails.
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import puppeteer from 'puppeteer-core';
import { createMockServer } from '../../tools/mock-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const modes = process.argv.slice(2).filter(m => ['pc', 'tv'].includes(m));
const failures = [];

function findBrowser() {
  const candidates = [process.env.CRIMSONFIN_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find(p => p && existsSync(p));
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function run(mode, executablePath) {
  const tv = mode === 'tv';
  const server = createMockServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: tv ? 1920 : 1440, height: tv ? 1080 : 900 });
  if (tv) await page.setUserAgent((await browser.userAgent()) + ' CrimsonFinTV/1.0'); // what the TV app's WebView sends
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const check = (name, ok, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} [${mode}] ${name}${!ok && detail ? ' — ' + detail : ''}`);
    if (!ok) failures.push(`[${mode}] ${name}${detail ? ' — ' + detail : ''}`);
  };
  const shot = async name => { await wait(500); await page.screenshot({ path: path.join(OUT, `${mode}-${name}.png`) }); };
  const evaluate = (fn, ...args) => page.evaluate(fn, ...args);
  const clickText = (selector, text) => evaluate((selector, text) => {
    const el = [...document.querySelectorAll(selector)].find(e => e.textContent.trim().startsWith(text) && e.getClientRects().length);
    el?.click(); return !!el;
  }, selector, text);
  const tab = async name => { const ok = await clickText('.topnav button', name); await wait(800); return ok; };

  try {
    // Start with a manual subtitle preference to verify the language switch replaces it.
    await page.goto(base, { waitUntil: 'networkidle0' });
    await evaluate(() => localStorage.setItem('crimsonfin.prefs', JSON.stringify({ subtitleLanguage: 'off', titleLanguage: 'en' })));
    await page.reload({ waitUntil: 'networkidle0' }); await wait(600);

    // Both title variants are served by the mock under the same item ID.
    const languageSwitch = '[role="switch"][aria-label="Romanian media titles"]';
    await page.waitForSelector(languageSwitch);
    await page.focus(languageSwitch);
    await page.keyboard.press('Enter');
    check('title language switch updates hero and cards', await evaluate(() =>
      document.querySelector('.spotlight h1')?.textContent === 'Portul noaptea' &&
      [...document.querySelectorAll('.card-text strong')].some(node => node.textContent === 'Portul noaptea')));
    await page.reload({ waitUntil: 'networkidle0' });
    check('Romanian title and subtitle preferences survive reload', await evaluate(selector =>
      document.querySelector(selector)?.getAttribute('aria-checked') === 'true' &&
      JSON.parse(localStorage.getItem('crimsonfin.prefs')).subtitleLanguage === 'ro' &&
      document.querySelector('.spotlight h1')?.textContent === 'Portul noaptea', languageSwitch));
    await page.focus(languageSwitch);
    await page.keyboard.press('Enter');
    check('English updates the title and subtitle preference', await evaluate(() =>
      document.querySelector('.spotlight h1')?.textContent === 'The Harbour at Night' &&
      JSON.parse(localStorage.getItem('crimsonfin.prefs')).subtitleLanguage === 'en'));

    // Home
    const rows = await evaluate(() => [...document.querySelectorAll('.row h2')].map(h => h.textContent.trim()));
    check('home shows Continue watching', rows.includes('Continue watching'), JSON.stringify(rows));
    if (tv) {
      check('TV layout is active', await evaluate(() => document.documentElement.classList.contains('crimsonfin-tv')));
      const before = await evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await wait(300);
      check('remote arrows move focus', before !== await evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
    }
    await shot('01-home');

    // Movies: paged library loads more as you scroll
    check('Movies tab opens', await tab('Movies'));
    const cards = () => evaluate(() => document.querySelectorAll('.view:not([hidden]) .poster-grid .poster-card').length);
    const first = await cards();
    for (let i = 0; i < 6; i++) {
      if (tv) { for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowDown'); }
      else await evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await wait(500);
    }
    const later = await cards();
    check('library loads more pages on scroll', first > 0 && later > first, `${first} -> ${later}`);
    await evaluate(() => window.scrollTo(0, 0));
    await shot('02-movies');
    for (const [name, file] of [['Shows', '03-shows'], ['My list', '04-mylist'], ['Requests', '05-requests']]) {
      check(`${name} tab opens`, await tab(name)); await shot(file);
    }

    await page.type('input[aria-label="Search FileList"]', 'Dune');
    await page.click('button[aria-label="Search FileList"]');
    await page.waitForSelector('.filelist-summary');
    check('FileList shows readable titles, quality, sizes and useful seeder labels', await evaluate(() => {
      const [first, second, third] = [...document.querySelectorAll('.filelist-summary')];
      return first?.querySelector('strong')?.textContent === 'Dune Part Two' &&
        first.textContent.includes('4K · Blu-ray · Remux · 52 GB') &&
        first.textContent.includes('57 seeders') && first.textContent.includes('Best seeded') &&
        second?.textContent.includes('2 seeders') && second.textContent.includes('Few seeders') &&
        third?.textContent.includes('Seed count unavailable');
    }));

    // Search
    if (tv) {
      await tab('Search');
      await evaluate(() => { for (const k of 'nor') [...document.querySelectorAll('.key')].find(b => b.textContent === k)?.click(); });
      await wait(900);
      const found = await evaluate(() => document.body.innerText.includes('Northbound'));
      check('TV on-screen keyboard search finds results', found);
      await shot('06-search');
    } else {
      await tab('Home');
      await page.focus('.search-field input'); await page.keyboard.type('ne'); await wait(900);
      const options = await evaluate(() => [...document.querySelectorAll('.search-results [role=option]')].map(o => o.textContent));
      check('search dropdown shows matches', options.some(o => o.includes('Neon Hours')), JSON.stringify(options));
      await shot('06-search-dropdown');
      // Enter right after typing must search for the typed text, not open a result for "ne".
      await page.keyboard.type('on hours'); await page.keyboard.press('Enter'); await wait(900);
      const headings = await evaluate(() => [...document.querySelectorAll('h1,h2')].filter(h => h.getClientRects().length).map(h => h.textContent));
      check('Enter searches for what was typed', headings.some(h => h.includes('neon hours')), JSON.stringify(headings.slice(0, 3)));
    }

    // Continue watching: remove an item with the card menu
    await tab('Home'); await evaluate(() => window.scrollTo(0, 420)); await wait(300);
    const continueTitles = () => evaluate(() => {
      const row = [...document.querySelectorAll('.row')].find(r => r.querySelector('h2')?.textContent === 'Continue watching');
      return row ? [...row.querySelectorAll('.card-text strong')].map(s => s.textContent) : [];
    });
    const titlesBefore = await continueTitles();
    if (tv) { await page.focus('.row .wide-card:nth-child(2) .card-menu'); await page.keyboard.press('Enter'); }
    else { await page.hover('.row .wide-card:nth-child(2)'); await wait(250); await page.click('.row .wide-card:nth-child(2) .card-menu'); }
    await wait(400);
    await shot('07-card-menu');
    await clickText('.card-menu-panel button', 'Remove from Continue'); await wait(1200);
    const titlesAfter = await continueTitles();
    check('card menu removes from Continue watching', titlesAfter.length === titlesBefore.length - 1 && !titlesAfter.includes(titlesBefore[1]),
      `${JSON.stringify(titlesBefore)} -> ${JSON.stringify(titlesAfter)}`);

    // Settings, Downloads, Admin
    if (tv) await page.click('.nav-icon');
    else { await page.click('.account-button'); await wait(300); await clickText('.menu button', 'Settings'); }
    await wait(600); await shot('08-settings');
    check('Downloads page opens', await clickText('.rail-item', 'Downloads')); await wait(600); await shot('09-downloads');
    await page.click('.delete-torrent');
    check('torrent confirmation identifies the release and focuses Cancel', await evaluate(() =>
      document.querySelector('dialog[open]')?.textContent.includes('Dune.Part.Two') &&
      document.activeElement?.textContent === 'Cancel'));
    await clickText('dialog[open] button', 'Cancel');
    check('Cancel leaves both torrents in place', await evaluate(() => document.querySelectorAll('.transfer').length === 2));
    await page.click('.delete-torrent');
    await clickText('dialog[open] button', 'Delete torrent and files');
    await page.waitForFunction(() => document.querySelectorAll('.transfer').length === 1);
    check('Confirm removes only the selected torrent', await evaluate(() =>
      document.querySelector('.transfer strong')?.textContent.includes('Severance')));
    check('Admin page opens', await clickText('.rail-item', 'Admin')); await wait(600); await shot('10-admin');

    // Series details
    await tab('Shows');
    await evaluate(() => [...document.querySelectorAll('.view:not([hidden]) .poster-card .card-hit')].find(b => b.textContent.includes('Northbound'))?.click());
    await wait(1500);
    check('English mode uses the localized Jellyfin name', await evaluate(() => document.querySelector('.details h1')?.textContent === 'Northbound'));
    check('series page lists episodes', await evaluate(() => document.querySelectorAll('.episode').length) > 0);
    await shot('11-details');
    await evaluate(() => document.querySelector('.episode-menu')?.click()); await wait(400);
    const items = await evaluate(() => [...document.querySelectorAll('.card-menu-panel button')].map(b => b.textContent.trim()));
    check('episode menu has no dead "Go to series"', items.length > 0 && !items.some(t => t.includes('Go to series')), JSON.stringify(items));
    await page.keyboard.press('Escape'); await wait(200);

    // Player (the mock serves no video; controls, segments and Up next still work)
    await evaluate(() => [...document.querySelectorAll('.episode')][1]?.click()); await wait(2500);
    check('Skip intro appears in the intro', await evaluate(() => !!document.querySelector('.skip-intro')));
    await shot('12-player');
    const cc = () => evaluate(() => document.querySelector('.player [aria-pressed][aria-label*="ubtitle"]')?.getAttribute('aria-pressed'));
    check('Auto retries a broken subtitle with a same-language track and loads its cues', await evaluate(() => {
      const track = document.querySelector('.player video track');
      return track?.src.endsWith('/5/Stream.vtt') && track.track.mode === 'showing' && track.track.cues?.length === 1;
    }));
    const optionsButton = '[aria-label="Audio, subtitles and quality"]';
    await page.click(optionsButton);
    const subtitles = '.player-panel .field select';
    const selectSubtitle = value => evaluate((selector, value) => {
      const select = document.querySelectorAll(selector)[1];
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, subtitles, value);
    await selectSubtitle('off');
    await selectSubtitle('auto');
    await page.click('[aria-label="Close options"]');
    const ccStates = [await cc()];
    for (let i = 0; i < 2; i++) { await page.keyboard.press('c'); await wait(300); ccStates.push(await cc()); }
    check('C toggles subtitles even with the preference Off', ccStates.join() === 'false,true,false', ccStates.join());
    if (!tv) await page.focus(optionsButton);
    await evaluate(() => document.querySelector('video').dispatchEvent(new Event('ended'))); await wait(1200);
    check('Up next appears after an episode', await evaluate(() => !!document.querySelector('.up-next')));
    const focusStayed = await evaluate(selector => document.activeElement?.matches(selector),
      tv ? '.up-next button.primary' : optionsButton);
    // TV: the remote should land on "Play now". PC: focus must not move (Space would start it).
    check(tv ? 'Up next focuses Play now on TV' : 'Up next leaves keyboard focus alone', focusStayed);
    await shot('13-up-next');

    check('no JavaScript errors', pageErrors.length === 0, pageErrors.join(' | '));
  } catch (error) {
    check('smoke run completed', false, error.message);
    await shot('error').catch(() => {});
  } finally {
    await browser.close();
    server.close();
  }
}

const executablePath = findBrowser();
if (!executablePath) {
  console.error('No Chrome/Edge/Chromium found. Set CRIMSONFIN_BROWSER to the browser executable.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
for (const mode of modes.length ? modes : ['pc', 'tv']) await run(mode, executablePath);
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed', `· screenshots in ${path.relative(process.cwd(), OUT)}`);
process.exit(failures.length ? 1 : 0);
