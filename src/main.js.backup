document.body.classList.toggle('crimson-windows', window.crimson?.platform === 'win32');
import Hls from 'hls.js';
import './style.css';
import './theme-branding.css';
import './harmony.css';
import './requests.css';
import { brandMarkSvg, validTheme, setThemeFavicon } from './branding.js';
import appPackage from '../package.json';
import { episodeNeedsLookup, applyEpisodeTitles, hasRepeatedEpisodeTitles } from './episodeMetadata.js';
import { chooseImageSource, posterLooksLandscape, rankArtwork } from './artwork.js';

const APP_VERSION = appPackage.version;
const requestApi=(endpoint,method='GET',body)=>window.crimson.requests(endpoint,method,body);
let requestRefreshTimer=null;


const $ = (q, root=document) => root.querySelector(q);
const esc = (value='') => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',film:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4"/>',tv:'<rect x="2" y="6" width="20" height="15" rx="2"/><path d="m8 2 4 4 4-4"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',play:'<path d="m8 5 12 7-12 7z"/>',arrow:'<path d="m5 12 14 0m-7-7 7 7-7 7"/>',back:'<path d="m14 5-7 7 7 7"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.3.8a8.5 8.5 0 0 0-2.6-1.5L13.7 2h-4l-.4 2.8a8.5 8.5 0 0 0-2.6 1.5l-2.3-.8-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.3-.8a8.5 8.5 0 0 0 2.6 1.5l.4 2.8h4l.4-2.8a8.5 8.5 0 0 0 2.6-1.5l2.3.8 2-3.5z"/>',logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/>',plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="m5 12 5 5L20 7"/>',volume:'<path d="M11 5 6 9H3v6h3l5 4zM15 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',close:'<path d="m5 5 14 14M19 5 5 19"/>',min:'<path d="M5 12h14"/>',max:'<rect x="5" y="5" width="14" height="14" rx="1"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',spark:'<path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',captions:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 10H7v4h3m7-4h-3v4h3"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/>'};
const icon=(name,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.info}</svg>`;
const state={session:null,views:[],section:'home',items:[],hero:null,detail:null,search:'',favs:[],imageUrls:new Map(),artworkCache:new Map(),player:null,hls:null,playTimer:null,searchTimer:null,episodeTitles:new Map()};
// All preferences are local to this device; access credentials are never exported.
const DEFAULT_PREFS={soundProfile:'minimal',soundVolume:35,animation:true,spoilerFree:true,subtitleSize:28,subtitleColor:'#ffffff',subtitlePosition:7,subtitleOutline:true,subtitleLanguage:'',audioLanguage:'',speed:1,quality:0,artworkQuality:'high',autoPosterRepair:true,theme:'crimson',onlineEpisodeTitles:true,autoNext:true};
function readPrefs(userId){
  try {
    const key=userId?'crimsonfin.preferences.'+userId:'crimsonfin.preferences';
    const saved=localStorage.getItem(key)||localStorage.getItem('crimsonfin.preferences');
    const lastTheme=localStorage.getItem('crimsonfin.lastTheme');
    return {...DEFAULT_PREFS, ...(lastTheme?{theme:validTheme(lastTheme)}:{}), ...JSON.parse(saved||'{}')};
  }catch{return {...DEFAULT_PREFS}}
}
let prefs=readPrefs();
const THEME_NAMES={crimson:'Crimson Red',ocean:'Deep Ocean',violet:'Ultraviolet',emerald:'Emerald',gold:'Golden Hour',mono:'Monochrome'};
function applyTheme(){
  const theme = validTheme(prefs.theme);
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('crimsonfin.lastTheme', theme); } catch {} // appearance only
  setThemeFavicon(document, theme);
}
applyTheme();
// Cached client-side metadata only. We never rewrite filenames or Jellyfin's database.
const metadataCache = new Map();
async function lookupEpisodeTitles(series, episodes) {
  if (!prefs.onlineEpisodeTitles || !series?.Name || !episodes?.length) return episodes;
  if (!episodes.some(ep => episodeNeedsLookup(ep, series.Name)) && !hasRepeatedEpisodeTitles(episodes)) return episodes;
  const key = String(series.Id);
  try {
    let remote = metadataCache.get(key);
    if (!remote) {
      remote = await window.crimson.episodeMetadata.lookup({name:series.Name, year:series.ProductionYear || null, providers:series.ProviderIds || {}});
      metadataCache.set(key, remote);
    }
    return applyEpisodeTitles(episodes,remote,series.Name);
  } catch { return episodes; }
}
async function refreshAvatar() {
  const nodes = document.querySelectorAll('[data-user-avatar]');
  if (!nodes.length || !state.session?.user?.Id) return;
  const userId = state.session.user.Id;
  const local = localStorage.getItem('crimsonfin.avatar.' + userId);
  let picture = local;
  if (!picture) { try { picture = await window.crimson.profile.getAvatar(); } catch {} }
  nodes.forEach(node=>{ if (picture && picture.startsWith('data:image/')) { node.style.backgroundImage=`url("${picture}")`;node.classList.add('has-avatar'); }
    else {node.style.backgroundImage='';node.classList.remove('has-avatar');} });
}
async function setProfilePicture(file, mode='server') {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8_000_000) throw Error('Choose a PNG, JPG or WebP smaller than 8 MB.');
  const image = await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas'); canvas.width=320; canvas.height=320;
    const ctx=canvas.getContext('2d'); if (!ctx) throw Error('Unable to process the image.');
    const side=Math.min(image.width,image.height), sx=(image.width-side)/2, sy=(image.height-side)/2;
    ctx.drawImage(image,sx,sy,side,side,0,0,320,320);
    const data=canvas.toDataURL('image/jpeg',0.82);
    if (data.length > 700_000) throw Error('Image is too large after processing.');
    const key='crimsonfin.avatar.'+state.session.user.Id;
    if (mode==='server') {
      try { await window.crimson.profile.uploadAvatar(data); localStorage.removeItem(key); toast('Profile picture synced to Jellyfin'); }
      catch (err) { throw Error(`Jellyfin rejected the avatar: ${err.message}. Choose "This device only" instead.`); }
    } else { localStorage.setItem(key,data); toast('Profile picture saved on this device'); }
    await refreshAvatar();
  } finally {image.close?.()}
}

function savePrefs(){const userId=state.session?.user?.Id;localStorage.setItem(userId?'crimsonfin.preferences.'+userId:'crimsonfin.preferences',JSON.stringify(prefs))}
function updatePreference(name,value){if(!(name in DEFAULT_PREFS))return;prefs[name]=value;savePrefs();document.documentElement.classList.toggle('no-motion',!prefs.animation);applyTheme()}
document.documentElement.classList.toggle('no-motion',!prefs.animation);
function languageMatches(stream,wanted){return !wanted||String(stream?.Language||'').toLowerCase().startsWith(wanted.toLowerCase())}
function setSubtitleStyle(){document.documentElement.style.setProperty('--subtitle-size',Math.max(14,Math.min(54,Number(prefs.subtitleSize)||28))+'px');document.documentElement.style.setProperty('--subtitle-color',/^#[0-9a-f]{6}$/i.test(prefs.subtitleColor)?prefs.subtitleColor:'#ffffff');document.documentElement.style.setProperty('--subtitle-bottom',Math.max(1,Math.min(30,Number(prefs.subtitlePosition)||7))+'%');document.documentElement.classList.toggle('subtitle-no-outline',!prefs.subtitleOutline)}
setSubtitleStyle();
const params=(obj)=>new URLSearchParams(Object.entries(obj).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>[k,String(v)])).toString();
const api=(path,method,body)=>window.crimson.api(path,method,body);

const ticksToSeconds=n=>Math.floor((Number(n)||0)/10000000);
const runtime=n=>{let s=ticksToSeconds(n);return s?`${Math.floor(s/3600)?Math.floor(s/3600)+'h ':''}${Math.floor((s%3600)/60)}m`:''};
// Source images are tied to the actual Jellyfin item ID and image tag.
// An override is saved only for the current Jellyfin account, device and server.
const artworkStorageKey=()=>`crimsonfin.artwork.${state.session?.user?.Id||'none'}.${state.session?.serverId||state.session?.server||'none'}`;
function readArtworkOverrides(){try{return JSON.parse(localStorage.getItem(artworkStorageKey())||'{}')}catch{return {}}}
function saveArtworkOverride(id,url){const data=readArtworkOverrides();if(url)data[id]=url;else delete data[id];localStorage.setItem(artworkStorageKey(),JSON.stringify(data));state.artworkCache.clear();}
function localPosterData(override){return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{1,500000}$/.test(String(override||''))?override:null}

const imagePath=(item,type='Primary',width=600)=>{
  const source=chooseImageSource(item,type);if(!source)return null;
  const qp={maxWidth:width,quality:prefs.artworkQuality==='high'?90:77,tag:source.tag};
  if(type==='Backdrop')qp.imageIndex=source.index||0;
  return `/Items/${source.id}/Images/${source.type}?${params(qp)}`;
};
async function imageUrl(item,type='Primary',width=600){
  if (type==='Primary') {
    const override=readArtworkOverrides()[item?.Id];
    if(override && override !== '__jellyfin_original__'){
      const local=localPosterData(override);if(local)return local;
      const key='override:'+item.Id;
      if(!state.artworkCache.has(key))state.artworkCache.set(key,(async()=>{
        try {
          const options=await window.crimson.artwork.options(item.Id);
          if(!options.some(candidate=>candidate.Url===override))return null;
          return await window.crimson.artwork.image(override);
        }catch{return null}
      })());
      const chosen=await state.artworkCache.get(key);
      if(chosen)return chosen;
    }
  }
  const path=imagePath(item,type,width);if(!path)return null;
  if(!state.imageUrls.has(path))state.imageUrls.set(path,window.crimson.resource(path));
  return state.imageUrls.get(path);
}
const preloadImage=src=>new Promise(resolve=>{
  const test=new Image();const timer=setTimeout(()=>{test.onload=test.onerror=null;resolve(null)},6500);
  test.onload=()=>{clearTimeout(timer);resolve({width:test.naturalWidth,height:test.naturalHeight})};
  test.onerror=()=>{clearTimeout(timer);resolve(null)};test.src=src;
});
let artworkRepairPending=0;const maxAutoRepairs=3;
async function bestAlternative(item){
  if(!item?.Id||!['Movie','Series'].includes(item.Type))return null;
  const key='verified:'+item.Id;
  if(state.artworkCache.has(key))return state.artworkCache.get(key);
  const pending=(async()=>{
    try {
      const candidate=await window.crimson.artwork.verified(item.Id);
      if(!candidate?.image)return null;
      const dims=await preloadImage(candidate.image);
      if(!dims || dims.height/dims.width < 1.2)return null;
      return {url:candidate.image,provider:candidate.provider||'Verified poster'};
    }catch{return null}
  })();
  state.artworkCache.set(key,pending);
  const result=await pending;
  state.artworkCache.set(key,result);
  return result;
}

function toast(message){const el=document.createElement('div');el.className='toast';el.innerHTML=`${icon('info',17)}<span>${esc(message)}</span>`;document.body.appendChild(el);setTimeout(()=>{el.classList.add('leaving');setTimeout(()=>el.remove(),350)},3800)}
// Lightweight UI feedback, synthesized locally — no network or audio files.
let soundsEnabled=true;
try{soundsEnabled=localStorage.getItem('crimsonfin.uiSounds')!=='off'}catch{}
let uiAudioContext=null;
function playUiSound(kind='tap'){
  if(!soundsEnabled)return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    if(!uiAudioContext)uiAudioContext=new Ctx();
    if(uiAudioContext.state==='suspended')uiAudioContext.resume().catch(()=>{});
    const now=uiAudioContext.currentTime;
    const osc=uiAudioContext.createOscillator();
    const gain=uiAudioContext.createGain();
    osc.type='sine';
    const profile=prefs.soundProfile; const start=(kind==='nav'?500:kind==='confirm'?610:440)*(profile==='arcade'?1.5:profile==='cinematic'?0.66:1);
    osc.frequency.setValueAtTime(start,now);
    osc.frequency.exponentialRampToValueAtTime(start*(kind==='confirm'?1.34:0.76),now+0.085);
    gain.gain.setValueAtTime(0.0001,now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001,Math.min(.09,(Number(prefs.soundVolume)||0)/100*.09)),now+0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+0.115);
    osc.connect(gain);gain.connect(uiAudioContext.destination);
    osc.start(now);osc.stop(now+0.12);
    osc.onended=()=>{osc.disconnect();gain.disconnect()};
  }catch{}
}
function refreshSoundToggle(){
  const b=document.getElementById('soundToggle');if(!b)return;
  b.setAttribute('aria-pressed',String(soundsEnabled));
  b.classList.toggle('is-muted',!soundsEnabled);
  b.title=soundsEnabled?'Mute interface sounds':'Enable interface sounds';
  b.querySelector('span').textContent=soundsEnabled?'Sounds on':'Sounds off';
}
const root=$('#app');
function chrome(){return `<div class="window-drag"></div><div class="window-controls"><button data-window="minimize" aria-label="Minimize">${icon('min',14)}</button><button data-window="maximize" aria-label="Maximize">${icon('max',13)}</button><button data-window="close" class="control-close" aria-label="Close">${icon('close',14)}</button></div>`}
function logo(){return `<div class="brand-symbol">${brandMarkSvg("crimson-app")}</div><div class="brand-word">CRIMSON<span>FIN</span><small>YOUR CINEMA. REIMAGINED.</small></div>`}
async function login(){
root.innerHTML=`${chrome()}<main class="login-layout"><div class="login-art"><div class="ambient-circle a"></div><div class="ambient-circle b"></div><div class="grain"></div><div class="login-art-inner"><div class="art-pill">${icon('spark',14)} CRIMSONCONNECT</div><h1>YOUR WORLD.<br><em>IN MOTION.</em></h1><p>Your Jellyfin library follows you home and away. Secure remote access, without installing a VPN.</p><div class="art-meta"><div class="wave-line"></div><span>YOUR CINEMA. ANYWHERE.</span></div></div></div><div class="login-panel"><div class="login-panel-inner"><div class="login-brand">${logo()}</div><div class="login-copy"><div class="eyebrow">SMART CONNECT • v${esc(APP_VERSION)}</div><h2>Let's get you<br><span>connected.</span></h2><p>CrimsonFin tries your home server first, then switches to your remote HTTPS address.</p></div><form id="loginForm"><label class="smart-check"><input type="checkbox" id="smartMode" checked> Automatically choose local or remote</label><div class="smart-connection-fields"><label for="localServer">HOME SERVER ADDRESS</label><div class="input-wrap">${icon('home',18)}<input id="localServer" placeholder="http://192.168.1.105:8096" autocomplete="url" spellcheck="false"></div><label for="remoteServer">REMOTE HTTPS ADDRESS</label><div class="input-wrap">${icon('tv',18)}<input id="remoteServer" placeholder="https://example.ts.net" autocomplete="url" spellcheck="false"></div></div><label for="user">USERNAME</label><div class="input-wrap">${icon('home',18)}<input id="user" placeholder="Your Jellyfin username" required autocomplete="username"></div><label for="password">PASSWORD</label><div class="input-wrap">${icon('settings',18)}<input type="password" id="password" placeholder="Your Jellyfin password" autocomplete="current-password"></div><div id="loginError" class="form-error" role="alert"></div><button type="submit" class="btn btn-primary login-submit">SMART CONNECT ${icon('arrow',18)}</button></form><div class="login-footer"><span class="status-dot"></span> LOCAL FIRST • REMOTE FALLBACK <span class="sep">•</span> JELLYFIN AUTH REQUIRED</div></div></div></main>`;
const error=$('#loginError');
try {
  const conf=await window.crimson.connection.get();
  $('#localServer').value=conf.local||'';
  $('#remoteServer').value=conf.remote||'';
  $('#smartMode').checked=conf.smart;
} catch(err) { error.textContent='Unable to load connection settings: '+err.message; }
$('#loginForm').onsubmit=async e=>{
  e.preventDefault();const btn=$('.login-submit');btn.disabled=true;btn.innerHTML=`<span class="spinner"></span> FINDING YOUR SERVER...`;error.textContent='';
  try{
    await window.crimson.connection.save({local:$('#localServer').value.trim(),remote:$('#remoteServer').value.trim(),smart:$('#smartMode').checked});
    state.session=await window.crimson.login($('#user').value,$('#password').value);
    await loadApp();
  }catch(err){error.textContent=err.message;btn.disabled=false;btn.innerHTML=`SMART CONNECT ${icon('arrow',18)}`;}
};
}
function shell(){root.innerHTML=`${chrome()}<div class="shell"><aside class="sidebar"><div class="sidebar-brand">${logo()}</div><div class="side-caption">DISCOVER</div><nav class="side-nav" id="mainNav"><button data-nav="home">${icon('home')}<span>Home</span></button><button data-nav="movies">${icon('film')}<span>Movies</span></button><button data-nav="series">${icon('tv')}<span>TV Shows</span></button><button data-nav="search">${icon('search')}<span>Search</span></button><button data-nav="favorites">${icon('heart')}<span>Favorites</span></button><button data-nav="settings">${icon('settings')}<span>Settings</span></button></nav><div class="side-caption library-caption">YOUR LIBRARIES</div><nav class="side-nav library-nav" id="libraryNav"></nav><div class="sidebar-bottom"><div class="server-status"><span class="live-dot"></span><div><strong>${state.session.mode==='local'?'LOCAL CONNECTION':state.session.mode==='remote'?'REMOTE CONNECTION':'SERVER CONNECTED'}</strong><small id="serverName">${esc(state.session.server.replace(/^https?:\/\//,''))}</small></div></div><button id="logout" class="logout-button">${icon('logout',18)}<span>Switch account</span></button></div></aside><main class="main"><header class="topbar"><div class="crumb"><span class="crumb-marker"></span><span id="breadcrumb">YOUR SPACE</span></div><div class="top-actions"><button class="search-trigger" id="searchTrigger">${icon('search',17)}<span>Search your library</span><kbd>Ctrl K</kbd></button><button id="soundToggle" type="button" class="sound-toggle" title="Toggle interface sounds" aria-label="Toggle interface sounds" aria-pressed="true">${icon('volume',18)}<span>Sounds</span></button><button type="button" class="avatar" id="profileButton" data-user-avatar aria-label="Choose your profile picture" title="Edit profile picture">${esc((state.session.user?.Name||'U').slice(0,1).toUpperCase())}</button></div></header><div id="content" class="content"></div><footer class="bottom-footer">CRIMSONFIN <span>✦</span> <span class="app-version" title="Installed app version">v${esc(APP_VERSION)}</span> <span>✦</span> MADE FOR MOVIE NIGHTS <span class="footer-right">YOUR MEDIA. YOUR WAY.</span></footer></main></div><div id="modalRoot"></div>`;
$('#logout').onclick=async()=>{closePlayer();await window.crimson.logout();state.session=null;state.views=[];state.imageUrls.clear();state.artworkCache.clear();metadataCache.clear();await login()};
$('#searchTrigger').onclick=()=>navigate('search');
$('#profileButton').onclick=async()=>{await navigate('settings');$('#profileSettings')?.scrollIntoView({behavior:prefs.animation?'smooth':'instant',block:'center'});};
refreshAvatar().catch(()=>{});
refreshSoundToggle();
const lib=$('#libraryNav');lib.innerHTML=state.views.map((v,i)=>`<button data-nav="lib:${esc(v.Id)}">${icon(v.CollectionType==='tvshows'?'tv':'film',18)}<span>${esc(v.Name)}</span></button>`).join('');
updateNavigation();
}
function updateNavigation(){document.querySelectorAll('[data-nav]').forEach(btn=>btn.classList.toggle('active',btn.dataset.nav===state.section));const title=state.section==='home'?'YOUR SPACE':state.section==='movies'?'THE MOVIE COLLECTION':state.section==='series'?'SERIES & SHOWS':state.section==='favorites'?'YOUR FAVORITES':state.section==='search'?'EXPLORE':state.section==='settings'?'PREFERENCES':state.section==='requests'?'MEDIA REQUESTS':state.views.find(x=>'lib:'+x.Id===state.section)?.Name?.toUpperCase()||'EXPLORE';$('#breadcrumb').textContent=title;}
async function detectRequestsService(){
  if(!state.session || !$('#mainNav') || $('#mainNav [data-nav="requests"]'))return;
  try {
    const status=await requestApi('/api/status');
    if(!status || !Array.isArray(status.drives)) return;
    const settings=$('#mainNav [data-nav="settings"]');
    const button=document.createElement('button');
    button.type='button';button.dataset.nav='requests';
    button.innerHTML=`${icon('plus')}<span>Media Requests</span>`;
    settings?.before(button);
  } catch { /* Do not show an unusable menu when the companion is offline. */ }
}
async function loadApp(){prefs=readPrefs(state.session.user.Id);applyTheme();setSubtitleStyle();document.documentElement.classList.toggle('no-motion',!prefs.animation);try{state.views=(await api(`/Users/${state.session.user.Id}/Views`))?.Items||[]}catch{state.views=[]}shell();void detectRequestsService();await navigate('home')}
function loading(){return `<div class="loading-screen"><div class="loading-ring"></div><p>CURATING YOUR EXPERIENCE</p></div>`}
async function navigate(section){if(requestRefreshTimer){clearInterval(requestRefreshTimer);requestRefreshTimer=null;}state.section=section;state.detail=null;updateNavigation();const content=$('#content');content.innerHTML=loading();content.scrollTop=0;try{if(section==='home')await home();else if(section==='search')searchPage();else if(section==='settings')settingsPage();else if(section==='requests')await requestsPage();else if(section==='favorites')await listing('YOUR WATCHLIST','Your favorites, all in one place.',{Filters:'IsFavorite',Recursive:true});else if(section==='movies')await listing('MOVIE COLLECTION','Every story starts somewhere.',{IncludeItemTypes:'Movie',Recursive:true});else if(section==='series')await listing('YOUR SERIES','One more episode. We won’t tell.',{IncludeItemTypes:'Series',Recursive:true});else {const id=section.replace('lib:','');const view=state.views.find(x=>x.Id===id);await listing(view?.Name||'LIBRARY','Explore your collection.',{ParentId:id,Recursive:true})}}catch(err){content.innerHTML=`<div class="empty-state">${icon('info',36)}<h2>Couldn't load this page</h2><p>${esc(err.message)}</p><button class="btn btn-outline" data-action="retry">Try again</button></div>`}}
// CrimsonFin Requests: the UI never receives RSS/qBittorrent passwords, URLs or
// API keys. The companion service authenticates every action with Jellyfin.
const requestBytes=n=>{if(!Number.isFinite(Number(n))||Number(n)<0)return '—';const v=Number(n);if(v===0)return '0 B';const units=['B','KB','MB','GB','TB','PB'];const power=Math.min(5,Math.floor(Math.log(v)/Math.log(1024)));return (v/1024**power).toFixed(power>0?1:0)+' '+units[power]};
const requestStatusLabel=s=>({pending_approval:'Waiting for approval',searching:'Searching RSS',waiting_feed:'Waiting for feed',awaiting_selection:'Release selection needed',queued:'Queued',downloading:'Downloading',completed:'Download complete',failed:'Failed',cancelled:'Cancelled'})[s]||s;
let requestCatalog=[];
function diskCards(drives){
  if(!drives?.length)return '<div class="request-muted">No server drives configured.</div>';
  return drives.map(d=>{
    if(d.error)return `<article class="req-disk"><strong>${esc(d.name)}</strong><small>${esc(d.error)}</small></article>`;
    const pct=d.total?Math.max(0,Math.min(100,d.used/d.total*100)):0;
    return `<article class="req-disk"><div class="req-disk-title"><strong>${esc(d.name)}</strong><b>${esc(requestBytes(d.free))} free</b></div><div class="req-progress"><span style="width:${pct.toFixed(1)}%"></span></div><small>${esc(requestBytes(d.used))} used of ${esc(requestBytes(d.total))}</small></article>`;
  }).join('');
}
function requestRows(items,admin){
  if(!items.length)return `<div class="req-empty">${icon('spark',26)}<strong>No requests yet</strong><p>Choose a movie or series above to start the queue.</p></div>`;
  return items.map(r=>{
    const percent=r.percent==null?null:Math.max(0,Math.min(100,Number(r.percent)||0));
    const label=r.kind==='Series'?`TV SERIES${r.season?' • SEASON '+r.season:''}`:'MOVIE';
    const actions=[];
    if(admin&&r.status==='pending_approval') actions.push(`<button class="req-action primary" data-request-action="approve" data-id="${esc(r.id)}">Approve</button>`);
    if(admin&&['pending_approval','awaiting_selection','waiting_feed','searching','failed'].includes(r.status)) actions.push(`<button class="req-action" data-request-action="matches" data-id="${esc(r.id)}">Choose RSS release</button>`);
    if(admin&&['failed','awaiting_selection','waiting_feed'].includes(r.status)) actions.push(`<button class="req-action" data-request-action="retry" data-id="${esc(r.id)}">Retry matching</button>`);
    if((admin||r.requester_id===state.session?.user?.Id)&&['pending_approval','searching','waiting_feed','awaiting_selection','queued'].includes(r.status)) actions.push(`<button class="req-action" data-request-action="cancel" data-id="${esc(r.id)}">Cancel</button>`);
    return `<article class="req-item"><div class="req-item-top"><div class="req-item-icon">${icon(r.kind==='Series'?'tv':'film',23)}</div><div class="req-item-heading"><div class="req-kind">${label}${r.year?' • '+r.year:''}</div><h3>${esc(r.title)}</h3><p>Requested by <strong>${esc(r.requester_name)}</strong> · ${esc((r.created_at||'').replace('T',' ').slice(0,16))}</p></div><span class="req-state" data-stage="${esc(r.status)}">${esc(requestStatusLabel(r.status))}</span></div>
    ${['downloading','completed','queued'].includes(r.status)?`<div class="req-transfer"><div class="req-progress"><span style="width:${percent==null?0:percent.toFixed(1)}%"></span></div><div class="req-transfer-info"><span>${percent==null?'Preparing transfer':percent.toFixed(1)+'%'}${r.status==='queued'?' · queued':''}</span><span>${esc(requestBytes(r.bytes_done))}${r.bytes_total?' / '+esc(requestBytes(r.bytes_total)):''}</span></div></div>`:''}
    ${r.drive_name?`<p class="req-note">Saving to ${esc(r.drive_name)} · ${r.kind==='Movie'?'Movies':'TV Shows'}</p>`:''}
    ${r.error?`<p class="req-note">${esc(r.error)}</p>`:''}${r.download_name&&r.status==='completed'?`<p class="req-note">File: ${esc(r.download_name)}</p>`:''}
    <div class="req-item-actions">${actions.join('')}</div><div id="req-matches-${esc(r.id)}" class="req-matches" hidden></div></article>`;
  }).join('');
}
async function requestsPage(){
 const content=$('#content');
 content.innerHTML=`<div class="requests-view"><div class="req-hero"><div><div class="eyebrow">THE NEXT MOVIE NIGHT STARTS HERE</div><h1>Request <em>something great.</em></h1><p>Find a movie or a TV series and send it to your server. Everyone can see who requested it and follow download progress.</p></div><div class="req-hero-mark">${icon('plus',50)}</div></div>
 <div id="req-alert" class="req-alert" role="status" hidden></div><div class="req-top-grid"><section class="req-panel"><div class="req-title"><h2>New media request</h2><span class="req-pill">${icon('spark',13)} JELLYFIN ACCOUNT</span></div>
 <form id="requestForm"><div class="req-field-row"><label>CONTENT TYPE<select id="requestKind"><option value="Movie">Movie</option><option value="Series">TV Series</option></select></label><label>RELEASE YEAR (OPTIONAL)<input id="requestYear" type="number" min="1880" max="2100" placeholder="2026"></label><label id="requestSeasonField" hidden>SEASON (OPTIONAL)<input id="requestSeason" type="number" min="1" max="100" placeholder="1"></label></div><label class="req-full-field">TITLE<input id="requestTitle" required maxlength="140" minlength="2" placeholder="Enter a movie or show title" autocomplete="off"></label><div class="req-form-actions"><button class="btn btn-outline" type="button" id="findMovie">Search movie catalog</button><button class="btn btn-primary" type="submit">${icon('plus',17)} Submit request</button></div></form><div id="catalogResults" class="req-catalog"></div><p class="req-subnote">Your server owner controls trusted RSS feeds and approvals. Downloads only begin when a suitable feed release is available.</p></section>
 <section class="req-panel"><div class="req-title"><h2>Server storage</h2><span class="req-pill">${icon('refresh',13)} LIVE</span></div><div id="req-disks"><div class="request-muted">Checking server drives…</div></div><div id="req-mode" class="req-storage-footer"></div></section></div>
 <div class="req-heading"><div><div class="eyebrow">TRANSPARENT DOWNLOAD QUEUE</div><h2>Community requests</h2><p>Requests are linked to the Jellyfin account that submitted them.</p></div><button id="requestRefresh" class="btn btn-outline" type="button">${icon('refresh',16)} Refresh</button></div><div id="req-list"><div class="request-muted">Loading requests…</div></div></div>`;
 let admin=false,refreshBusy=false,requestTmdbId=null;
 const showMessage=(message,isError=false)=>{const node=$('#req-alert');if(!node)return;node.hidden=false;node.textContent=message;node.classList.toggle('is-error',isError)};
 const updateKind=()=>{$('#requestSeasonField').hidden=$('#requestKind').value!=='Series';requestTmdbId=null;$('#catalogResults').replaceChildren()};
 $('#requestKind').addEventListener('change',updateKind);updateKind();
 const refresh=async()=>{
   if(state.section!=='requests'||refreshBusy)return;
   refreshBusy=true;
   try{
     const [status,list]=await Promise.all([requestApi('/api/status'),requestApi('/api/requests')]);
     if(state.section!=='requests')return;
     admin=!!status.admin;
     $('#req-disks').innerHTML=diskCards(status.drives);
     $('#req-mode').textContent=`${status.auto_approve?'Automatic matching enabled':'Administrator approval required'} · ${status.feed_configured?'RSS feed configured':'RSS feed not configured'} · Refreshes every 10 seconds`;
     $('#findMovie').disabled=!status.catalog_enabled;
     $('#findMovie').title=status.catalog_enabled?'Search the movie and TV catalog':'Server owner can enable TMDB_READ_TOKEN for catalog search';
     $('#req-list').innerHTML=requestRows(list.items||[],admin);
   }catch(error){
     if(state.section!=='requests')return;
     $('#req-list').innerHTML=`<div class="req-error"><strong>Requests service is not connected.</strong><p>${esc(error.message)}</p><p>Ask the server owner to start the companion service and configure the /requests reverse proxy.</p></div>`;
     $('#req-disks').innerHTML='<span class="request-muted">Storage information unavailable.</span>';
     $('#findMovie').disabled=true;
   } finally{refreshBusy=false;}
 };
 $('#requestForm').addEventListener('submit',async event=>{
   event.preventDefault();
   const button=event.submitter || $('#requestForm button[type="submit"]');button.disabled=true;
   try{
     const data={title:$('#requestTitle').value.trim(),kind:$('#requestKind').value,year:$('#requestYear').value||null,season:$('#requestKind').value==='Series'?$('#requestSeason').value||null:null,tmdb_id:requestTmdbId};
     const result=await requestApi('/api/requests','POST',data);
     showMessage(result.status==='pending_approval'?'Request sent! The server administrator can approve it.':'Request sent! Searching the trusted RSS feed now.');
     $('#requestForm').reset();requestTmdbId=null;$('#catalogResults').replaceChildren();updateKind();await refresh();
   }catch(error){showMessage(error.message,true)}finally{button.disabled=false;}
 });
 $('#findMovie').addEventListener('click',async()=>{
   const text=$('#requestTitle').value.trim(),kind=$('#requestKind').value;
   if(text.length<2)return showMessage('Enter at least two letters to search.',true);
   const holder=$('#catalogResults');holder.innerHTML='<div class="request-muted">Searching the catalog…</div>';
   try{
     const data=await requestApi('/api/catalog?q='+encodeURIComponent(text)+'&kind='+kind);
     requestCatalog=data.items||[];
     holder.innerHTML=requestCatalog.length?requestCatalog.map((item,index)=>`<button class="req-catalog-item" type="button" data-catalog="${index}"><strong>${esc(item.title)} ${item.year?'('+item.year+')':''}</strong><small>${esc(item.overview||'Select this title')}</small></button>`).join(''):'<div class="request-muted">No catalog results. You can still enter the title manually.</div>';
   }catch(error){holder.innerHTML=`<div class="req-error">${esc(error.message)}</div>`;}
 });
 $('#catalogResults').addEventListener('click',event=>{
   const hit=event.target.closest('[data-catalog]');if(!hit)return;
   const choice=requestCatalog[Number(hit.dataset.catalog)];if(!choice)return;
   $('#requestTitle').value=choice.title;$('#requestYear').value=choice.year||'';requestTmdbId=choice.id;
   $('#catalogResults').innerHTML=`<span class="req-picked">${icon('check',15)} Selected ${esc(choice.title)}. Press Submit request.</span>`;
 });
 $('#requestRefresh').onclick=refresh;
 $('#req-list').addEventListener('click',async event=>{
   const button=event.target.closest('[data-request-action]');if(!button)return;
   const ident=button.dataset.id,action=button.dataset.requestAction;
   if(!/^[a-f0-9-]{36}$/.test(ident))return;
   button.disabled=true;
   try{
     if(action==='matches'){
       const data=await requestApi(`/api/requests/${ident}/matches`);
       const box=document.getElementById('req-matches-'+ident);if(!box)return;
       box.hidden=false;
       box.innerHTML=data.items?.length?`<div class="req-match-label">AVAILABLE RSS ENTRIES — ADMIN ONLY</div>${data.items.map((item,index)=>`<button type="button" class="req-match" data-select-release="${esc(item.entry_id)}" data-request-id="${ident}"><strong>${esc(item.title)}</strong><small>${esc(item.kind==='torrent'?'Download client':'Direct media file')} · ${item.score}% title match</small></button>`).join('')}`:'<p>No matching releases found in the configured RSS feed yet.</p>';
     }else{
       if(action==='cancel'&&!window.confirm('Cancel this pending request?'))return;
       await requestApi(`/api/requests/${ident}/${action}`,'POST',{});
       showMessage('Request updated.');await refresh();
     }
   }catch(error){showMessage(error.message,true)}finally{button.disabled=false;}
 });
 $('#req-list').addEventListener('click',async event=>{
   const button=event.target.closest('[data-select-release]');if(!button)return;
   button.disabled=true;
   try{
     await requestApi(`/api/requests/${button.dataset.requestId}/start`,'POST',{entry_id:button.dataset.selectRelease});
     showMessage('The server has queued this release for download.');await refresh();
   }catch(error){showMessage(error.message,true)}finally{button.disabled=false;}
 });
 await refresh();
 if(state.section==='requests')requestRefreshTimer=setInterval(refresh,10000);
}

function settingsPage(){
  const text=(name,title,html)=>`<label class="pref-row"><span><strong>${title}</strong><small>${name}</small></span>${html}</label>`;
  $('#content').innerHTML=`<div class="v1-settings"><div class="eyebrow">CRIMSONFIN v${esc(APP_VERSION)} • CONTROL CENTER</div><h1>Make it <em>yours.</em></h1><p>Preferences are stored on this computer and do not include your Jellyfin password or tokens.</p><div class="settings-panels"><section><h2>🎨 Appearance & sound</h2><div class="theme-palette" role="group" aria-label="Theme preview">${Object.keys(THEME_NAMES).map(key=>`<button type="button" class="theme-swatch theme-${key}" data-theme-choice="${key}" aria-label="${esc(THEME_NAMES[key])}" aria-pressed="${String(prefs.theme===key)}" title="${esc(THEME_NAMES[key])}"><span></span><small>${esc(THEME_NAMES[key])}</small></button>`).join('')}</div>${text('Choose your color palette','Theme',`<select data-pref="theme">${Object.entries(THEME_NAMES).map(([value,title])=>`<option value="${value}">${esc(title)}</option>`).join('')}</select>`)}${text('Better quality artwork uses more bandwidth','Artwork resolution',`<select data-pref="artworkQuality"><option value="high">High definition</option><option value="standard">Data saver</option></select>`)}${text('Try verified online posters for series and Jellyfin provider posters for movies even if current artwork has the wrong portrait image','Auto-repair artwork',`<input data-pref="autoPosterRepair" type="checkbox">`)}${text('Minimal / Cinematic / Arcade','Interface sound profile',`<select data-pref="soundProfile"><option value="minimal">Minimal</option><option value="cinematic">Cinematic</option><option value="arcade">Arcade</option></select>`)}${text('0–100%','Sound volume',`<input data-pref="soundVolume" type="range" min="0" max="100">`)}${text('Motion-aware interface','Enable animations',`<input data-pref="animation" type="checkbox">`)}${text('Avoid descriptions of unwatched episodes','Hide episode spoilers',`<input data-pref="spoilerFree" type="checkbox">`)}</section><section><h2>▶ Playback</h2>${text('Automatically offer to play the next episode','Next episode',`<input data-pref="autoNext" type="checkbox">`)}${text('Default playback speed','Playback speed',`<select data-pref="speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>`)}${text('Maximum requested streaming bitrate','Streaming quality',`<select data-pref="quality"><option value="0">Auto / Original (up to 120 Mbps)</option><option value="4">4 Mbps</option><option value="8">8 Mbps</option><option value="12">12 Mbps</option><option value="20">20 Mbps</option><option value="40">40 Mbps</option><option value="60">60 Mbps</option><option value="80">80 Mbps</option></select>`)}${text('Look up generic/duplicate episode names via TVmaze','Online episode titles',`<input data-pref="onlineEpisodeTitles" type="checkbox">`)}${text('Examples: en, ja, ro','Preferred audio language',`<input data-pref="audioLanguage" placeholder="Auto / en / ja" maxlength="12">`)}${text('Examples: en, ro','Preferred subtitle language',`<input data-pref="subtitleLanguage" placeholder="Auto / ro" maxlength="12">`)}</section><section><h2>💬 Subtitles</h2>${text('14–54 pixels','Font size',`<input data-pref="subtitleSize" type="range" min="14" max="54">`)}${text('Subtitle text color','Color',`<input data-pref="subtitleColor" type="color">`)}${text('Distance from bottom, in percent','Subtitle position',`<input data-pref="subtitlePosition" type="range" min="1" max="30">`)}${text('High contrast shadow','Outline',`<input data-pref="subtitleOutline" type="checkbox">`)}</section><section id="profileSettings"><h2>👤 Your profile picture</h2><div class="profile-preview"><div class="avatar profile-avatar" data-user-avatar>${esc((state.session.user?.Name||'U').slice(0,1).toUpperCase())}</div><div><strong>${esc(state.session.user?.Name||'Current user')}</strong><small>Choose a square photo or upload one; pictures are cropped automatically.</small></div></div><label class="profile-upload">Photo <input type="file" accept="image/png,image/jpeg,image/webp" id="avatarFile"></label><div class="profile-actions"><button class="btn btn-primary" type="button" id="avatarSync">Save to my Jellyfin profile</button><button class="btn btn-outline" type="button" id="avatarLocal">Use on this device only</button><button class="btn btn-quiet" type="button" id="avatarReset">Reset local picture</button></div><p class="settings-note">Jellyfin profile images sync across compatible devices if your account has upload permission. Local images only appear on this computer.</p></section><section><h2>🌐 Network & maintenance</h2><div class="pref-row"><span><strong>Current connection</strong><small>${esc(state.session.mode||'server')} • ${esc(state.session.server)}</small></span></div><div class="pref-row"><span><strong>Installed version</strong><small>Compare this with the latest GitHub Release to confirm an update.</small></span><strong class="settings-version">v${esc(APP_VERSION)}</strong></div><button class="btn btn-outline" type="button" id="clearPosters">Reset my poster choices</button><button class="btn btn-outline" id="testRequests">Check Media Requests connection</button><button class="btn btn-outline" id="checkUpdates">Check for updates</button><button class="btn btn-outline" id="exportPrefs">Export non-sensitive settings</button><label class="btn btn-outline import-label">Import settings<input type="file" accept="application/json,.json" id="importPrefs" hidden></label><p class="settings-note">This project currently publishes private GitHub Releases, so install updates manually from your private repository. Automatic updates are disabled.</p></section></div></div>`;
  refreshAvatar().catch(()=>{});
  const avatarFile=$('#avatarFile');
  $('#avatarSync').onclick=async()=>{try{if(!avatarFile.files?.length)throw Error('Select an image first.');await setProfilePicture(avatarFile.files[0],'server')}catch(e){toast(e.message)}};
  $('#avatarLocal').onclick=async()=>{try{if(!avatarFile.files?.length)throw Error('Select an image first.');await setProfilePicture(avatarFile.files[0],'local')}catch(e){toast(e.message)}};
  $('#avatarReset').onclick=()=>{localStorage.removeItem('crimsonfin.avatar.'+state.session.user.Id);refreshAvatar().catch(()=>{});toast('Local picture cleared')};
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.onclick=()=>{updatePreference('theme',b.dataset.themeChoice);settingsPage()});
  document.querySelectorAll('[data-pref]').forEach(el=>{
    const name=el.dataset.pref;el.type==='checkbox'?el.checked=!!prefs[name]:el.value=String(prefs[name]);
    el.addEventListener('change',()=>{let val=el.type==='checkbox'?el.checked:el.type==='range'||el.type==='number'||name==='speed'||name==='quality'?Number(el.value):el.value;updatePreference(name,val);setSubtitleStyle();if(name==='theme')settingsPage();else if(name==='autoPosterRepair'||name==='artworkQuality'){state.imageUrls.clear();navigate(state.section)}else toast('Preference saved')});
  });
  $('#clearPosters').onclick=()=>{if(confirm('Clear custom poster selections for this account on this device?')){localStorage.removeItem(artworkStorageKey());state.artworkCache.clear();toast('Saved poster choices cleared');}};
  $('#testRequests').onclick=async()=>{try{await requestApi('/api/status');await detectRequestsService();toast('Media Requests service is ready. Open it from the sidebar.')}catch(e){toast('Media Requests unavailable: '+e.message)}};
  $('#checkUpdates').onclick=async()=>{try{const result=await window.crimson.updates.check();toast(result?.message||'Update check requested')}catch(err){toast(err.message)}};
  $('#exportPrefs').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,preferences:prefs},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='CrimsonFin-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
  $('#importPrefs').onchange=async e=>{try{const file=e.target.files?.[0];if(!file||file.size>100000)throw Error('Choose a settings file smaller than 100 KB');const obj=JSON.parse(await file.text());if(!obj||typeof obj.preferences!=='object')throw Error('Invalid settings file');for(const [key,val] of Object.entries(obj.preferences))if(key in DEFAULT_PREFS&&typeof val===typeof DEFAULT_PREFS[key])prefs[key]=val;savePrefs();setSubtitleStyle();applyTheme();settingsPage();toast('Settings imported')}catch(err){toast(err.message)}};
}
async function getItems(query){const u=state.session.user.Id;const qs=params({UserId:u,Fields:'Overview,Genres,PrimaryImageAspectRatio,MediaSources',SortBy:'SortName',SortOrder:'Ascending',Limit:200,...query});return (await api(`/Users/${u}/Items?${qs}`))?.Items||[]}
function itemPoster(item,i=0){return `<button class="poster-card" style="--tile-index:${i%12}" data-item="${esc(item.Id)}"><div class="poster-image" data-image="${esc(item.Id)}" data-imagetype="Primary"><div class="poster-placeholder">${icon(item.Type==='Series'?'tv':'film',38)}</div><div class="poster-shine"></div><span class="poster-hover-icon">${icon('play',24)}</span></div><div class="poster-text"><strong>${esc(item.Name)}</strong><span>${item.ProductionYear||item.Type||''}${item.Type==='Series'?' · SERIES':''}</span></div></button>`}
// Resume cards represent episodes, but their headline should identify the show.
// Jellyfin's /Items/Resume response normally includes SeriesName, IndexNumber,
// ParentIndexNumber and UserData.PlaybackPositionTicks on episode items.
function continueWatchingPoster(item,i=0){
  if(item.Type!=='Episode')return itemPoster(item);
  const seriesName=item.SeriesName || item.Series?.Name || 'TV series';
  const season=Number.isInteger(item.ParentIndexNumber)?`S${String(item.ParentIndexNumber).padStart(2,'0')}`:'';
  const episode=Number.isInteger(item.IndexNumber)?`E${String(item.IndexNumber).padStart(2,'0')}`:'';
  const number=[season,episode].filter(Boolean).join('');
  const episodeName=item.DisplayEpisodeName||item.Name||'Untitled episode';
  const episodeLabel=[number,episodeName].filter(Boolean).join(' · ');
  const position=Number(item.UserData?.PlaybackPositionTicks)||0;
  const duration=Number(item.RunTimeTicks)||0;
  const percent=duration>0?Math.min(100,Math.max(0,(position/duration)*100)):0;
  return `<button class="poster-card continue-card" style="--tile-index:${i%12}" data-item="${esc(item.Id)}" aria-label="Continue ${esc(seriesName)}: ${esc(episodeLabel)}"><div class="poster-image" data-image="${esc(item.Id)}" data-imagetype="Primary"><div class="poster-placeholder">${icon('tv',38)}</div><div class="poster-shine"></div><span class="poster-hover-icon">${icon('play',24)}</span>${percent>0?`<div class="resume-progress" role="progressbar" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="Episode watched"><span style="width:${percent.toFixed(2)}%"></span></div>`:''}</div><div class="poster-text"><strong title="${esc(seriesName)}">${esc(seriesName)}</strong><span class="continue-episode" title="${esc(episodeLabel)}">${esc(episodeLabel)}</span></div></button>`;
}

function row(title,subtitle,items,tag='COLLECTION',cardRenderer=itemPoster){if(!items?.length)return '';return `<section class="media-row"><div class="row-heading"><div><div class="row-kicker">${esc(tag)}</div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><div class="row-count">${items.length} TITLES <span class="row-divider"></span> ${icon('arrow',18)}</div></div><div class="poster-track">${items.map(cardRenderer).join('')}</div></section>`}
// Slow external lookups run in the background, only for visible posters.
const artworkTasks=[];
const artworkVisible=('IntersectionObserver' in window)?new IntersectionObserver(entries=>{
  for(const entry of entries){
    if(!entry.isIntersecting)continue;
    artworkVisible.unobserve(entry.target);
    const task=artworkTasks.find(t=>t.node===entry.target);
    if(task){artworkTasks.splice(artworkTasks.indexOf(task),1);void repairPoster(task.node,task.item,task.id)}
  }
},{rootMargin:'220px'}):null;
function scheduleArtworkRepair(node,item,id){
  if(artworkVisible){artworkTasks.push({node,item,id});artworkVisible.observe(node)}
  else void repairPoster(node,item,id);
}
async function repairPoster(node,item,id){
  while(artworkRepairPending>=maxAutoRepairs&&node.isConnected){await new Promise(resolve=>setTimeout(resolve,150))}
  if(!node.isConnected||readArtworkOverrides()[id])return;
  artworkRepairPending++;
  try{
    const candidate=await bestAlternative(item);
    if(candidate&&node.isConnected&&node.dataset.image===id&&!readArtworkOverrides()[id]){
      node.style.backgroundImage=`url("${candidate.url}")`;
      node.classList.add('has-image');
    }
  }finally{artworkRepairPending--}
}
// Lazy, bounded poster loading. Never hold the page behind dozens of 6.5s image probes.
const pendingPosterLoads = [];
const posterLoadNodes = new WeakSet();
let activePosterLoads = 0;
const POSTER_LOAD_LIMIT = 5;
function drainPosterLoads(){
  while(activePosterLoads<POSTER_LOAD_LIMIT && pendingPosterLoads.length){
    const work=pendingPosterLoads.shift();
    if(!work.node.isConnected)continue;
    activePosterLoads++;
    void loadPoster(work.node,work.item,work.id,work.type).finally(()=>{
      activePosterLoads--; drainPosterLoads();
    });
  }
}
async function loadPoster(node,item,id,type){
  try {
    const width=node.classList.contains('hero-backdrop')?1600:400;
    const url=await imageUrl(item,type,width);
    if(!node.isConnected||node.dataset.image!==id||!url)return;
    // Let Chromium fetch and decode images without an extra blocking preload request.
    node.style.backgroundImage=`url("${url.replace(/"/g,'%22')}")`;
    node.classList.add('has-image');
    if(type==='Primary' && ['Series','Movie'].includes(item.Type) &&
       prefs.autoPosterRepair && !readArtworkOverrides()[id]) {
      scheduleArtworkRepair(node,item,id);
    }
  }catch{/* Keep the placeholder when a poster fails. */}
}
const posterObserver=('IntersectionObserver' in window)?new IntersectionObserver(entries=>{
  for(const entry of entries){
    if(!entry.isIntersecting)continue;
    posterObserver.unobserve(entry.target);
    const node=entry.target;
    if(!node.isConnected)continue;
    const item=state.items.find(x=>x.Id===node.dataset.image)||
      (state.hero?.Id===node.dataset.image?state.hero:null)||
      (state.detail?.Id===node.dataset.image?state.detail:null);
    if(item)pendingPosterLoads.push({node,item,id:node.dataset.image,type:node.dataset.imagetype||'Primary'});
  }
  drainPosterLoads();
},{rootMargin:'250px'}):null;
function hydrateImages(container=$('#content')){
  if(!container)return Promise.resolve();
  for(const node of container.querySelectorAll('[data-image]')){
    if(posterLoadNodes.has(node))continue;
    posterLoadNodes.add(node);
    if(posterObserver)posterObserver.observe(node);
    else {
      const item=state.items.find(x=>x.Id===node.dataset.image)||
        (state.hero?.Id===node.dataset.image?state.hero:null)||
        (state.detail?.Id===node.dataset.image?state.detail:null);
      if(item)pendingPosterLoads.push({node,item,id:node.dataset.image,type:node.dataset.imagetype||'Primary'});
    }
  }
  drainPosterLoads();
  return Promise.resolve();
}
async function showArtworkPicker(id){
  const item=state.items.find(x=>x.Id===id)||state.detail;
  if(!item||!['Series','Movie'].includes(item.Type))return;
  const modal=$('#modalRoot');
  modal.innerHTML=`<div class="artwork-picker-backdrop"><section class="artwork-picker" role="dialog" aria-modal="true" aria-label="Choose poster artwork"><div class="artwork-picker-title"><div><div class="eyebrow">COVER ART</div><h2>Choose artwork for ${esc(item.Name)}</h2><p>Select a poster from the image providers configured on your Jellyfin server. Only your local CrimsonFin display changes.</p></div><button class="btn btn-outline" type="button" id="closeArtwork">Close</button></div><div class="artwork-picker-options" id="artworkOptions">${loading()}</div><label class="btn btn-outline" style="margin-right:12px;cursor:pointer">Use my own poster (JPG/PNG/WebP)<input type="file" id="posterUpload" accept="image/jpeg,image/png,image/webp" hidden></label><button class="btn btn-outline" type="button" id="originalArtwork">Use Jellyfin's original artwork</button></section></div>`;
  const close=()=>{modal.replaceChildren()};$('#closeArtwork').onclick=close;
  $('.artwork-picker-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('artwork-picker-backdrop'))close()});
  $('#originalArtwork').onclick=async()=>{saveArtworkOverride(item.Id,'__jellyfin_original__');close();await hydrateImages();toast('Using Jellyfin original artwork for this title')};
  $('#posterUpload').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5_000_000)throw Error('Choose a JPG, PNG or WebP under 5 MB.');
      const bitmap=await createImageBitmap(file);
      try {
        const canvas=document.createElement('canvas');canvas.width=600;canvas.height=900;
        const ctx=canvas.getContext('2d');
        const cropWidth=Math.min(bitmap.width,bitmap.height*2/3),cropHeight=Math.min(bitmap.height,bitmap.width*3/2);
        ctx.drawImage(bitmap,(bitmap.width-cropWidth)/2,(bitmap.height-cropHeight)/2,cropWidth,cropHeight,0,0,600,900);
        const data=canvas.toDataURL('image/jpeg',0.78);
        if(data.length>500000)throw Error('Poster is too large after resizing.');
        saveArtworkOverride(item.Id,data);close();await hydrateImages();toast('Custom poster saved on this device');
      }finally{bitmap.close?.()}
    }catch(error){toast(error.message)}
  });
  const holder=$('#artworkOptions');
  try {
    const options=rankArtwork(await window.crimson.artwork.options(item.Id)).slice(0,12);
    if(!options.length){holder.innerHTML='<p>No alternative posters available from Jellyfin. In Jellyfin, open the title → Edit Images to set a correct poster.</p>';return;}
    holder.innerHTML='<p>Loading artwork options…</p>';
    const choices=await Promise.all(options.map(async image=>{try{return {...image,preview:await window.crimson.artwork.image(image.Url)}}catch{return null}}));
    if(!modal.querySelector('#artworkOptions'))return;
    holder.innerHTML=choices.filter(x=>x?.preview).map((x,i)=>`<button class="artwork-choice" type="button" data-artwork-index="${i}" aria-label="Select poster from ${esc(x.ProviderName||'Jellyfin provider')}"><img loading="lazy" src="${x.preview}" alt="Alternative poster for ${esc(item.Name)}"><span>${esc(x.ProviderName||'Jellyfin metadata')}</span></button>`).join('')||'<p>Poster previews could not be loaded. Try refreshing artwork in Jellyfin.</p>';
    const all=choices.filter(x=>x?.preview);
    holder.querySelectorAll('[data-artwork-index]').forEach(button=>button.onclick=async()=>{
      const selected=all[Number(button.dataset.artworkIndex)];
      if(!selected)return;
      saveArtworkOverride(item.Id,selected.Url);close();
      await hydrateImages();toast('Artwork changed for this device');
    });
  }catch(err){holder.innerHTML=`<p>Could not load alternate artwork: ${esc(err.message)}. Try Edit Images in Jellyfin.</p>`}
}
async function home(){const u=state.session.user.Id;const [latest,resume,recent]=await Promise.allSettled([api(`/Users/${u}/Items/Latest?${params({Limit:24,Fields:'Overview,Genres,MediaSources',IncludeItemTypes:'Movie,Series'})}`),api(`/Users/${u}/Items/Resume?${params({Limit:16,Recursive:true,Fields:'Overview,Genres,MediaSources'})}`),getItems({Recursive:true,IncludeItemTypes:'Movie,Series',SortBy:'DateCreated',SortOrder:'Descending',Limit:30})]);const fresh=latest.status==='fulfilled'?latest.value||[]:[];let continuing=resume.status==='fulfilled'?resume.value?.Items||[]:[];const recently=recent.status==='fulfilled'?recent.value||[]:[];
if(prefs.onlineEpisodeTitles){
  const bySeries=new Map();for(const ep of continuing.filter(x=>x.Type==='Episode'&&x.SeriesId)){if(!bySeries.has(ep.SeriesId))bySeries.set(ep.SeriesId,[]);bySeries.get(ep.SeriesId).push(ep)}
  // Use only metadata from already-loaded cache for instant home rendering.
  const titles=new Map();
  for(const [seriesId,episodes] of bySeries){const hit=metadataCache.get(String(seriesId));if(!hit)continue;for(const ep of applyEpisodeTitles(episodes,hit,episodes[0]?.SeriesName))titles.set(ep.Id,ep)}
  continuing=continuing.map(ep=>titles.get(ep.Id)||ep);
}
state.items=[...new Map([...fresh,...continuing,...recently].map(x=>[x.Id,x])).values()];state.hero=fresh.find(x=>x.BackdropImageTags?.length)||recently.find(x=>x.BackdropImageTags?.length)||fresh[0]||recently[0];let feature=state.hero;$('#content').innerHTML=`${feature?`<section class="hero"><div class="hero-backdrop" data-image="${esc(feature.Id)}" data-imagetype="Backdrop"></div><div class="hero-vignette"></div><div class="hero-content"><div class="hero-badge"><span class="red-bar"></span> FEATURED IN YOUR LIBRARY <span class="badge-star">✦</span></div><h1>${esc(feature.Name)}</h1><div class="hero-meta"><span>${esc(feature.ProductionYear||'YOUR COLLECTION')}</span><span class="meta-bullet"></span><span>${runtime(feature.RunTimeTicks)||esc(feature.Type)}</span>${feature.OfficialRating?`<span class="rating">${esc(feature.OfficialRating)}</span>`:''}</div><p>${esc(feature.Overview||'Discover a great story from your personal Jellyfin library.')}</p><div class="hero-buttons"><button class="btn btn-primary" data-action="play" data-id="${esc(feature.Id)}">${icon('play',19)} PLAY NOW</button><button class="btn btn-glass" data-item="${esc(feature.Id)}">${icon('info',19)} MORE INFO</button></div></div><div class="hero-number">01 <span>/ FEATURED</span></div></section>`:`<section class="welcome-hero"><div class="eyebrow">WELCOME HOME</div><h1>Your next favorite<br><em>starts here.</em></h1><p>Connect a media library in Jellyfin to fill this space with your favorites.</p></section>`}<div class="home-sections">${row('Continue watching','Pick up right where you left off.',continuing,'PICK UP WHERE YOU LEFT OFF',continueWatchingPoster)}${row('Recently added','Fresh from your personal collection.',fresh.length?fresh:recently,'JUST DROPPED')}${row('Explore your collection','Everything you love in one place.',recently,'HANDPICKED FOR YOU')}${row('Unwatched for you','Discover something you haven’t started yet.',recently.filter(x=>!x.UserData?.Played),'READY TO WATCH')}</div>`;await hydrateImages();if(prefs.onlineEpisodeTitles)void enrichContinueWatching(continuing,u);}
async function enrichContinueWatching(continuing,userId){
  const groups=new Map();
  for(const ep of continuing){if(ep.Type!=='Episode'||!ep.SeriesId)continue;
    if(!groups.has(ep.SeriesId))groups.set(ep.SeriesId,[]);groups.get(ep.SeriesId).push(ep)}
  for(const [seriesId,episodes] of [...groups.entries()].slice(0,4)) {
    if(state.section!=='home')break;
    if (!episodes.some(ep=>episodeNeedsLookup(ep,ep.SeriesName))&&!hasRepeatedEpisodeTitles(episodes))continue;
    try {
      const series=await api(`/Users/${userId}/Items/${seriesId}`);
      const result=await lookupEpisodeTitles(series,episodes);
      if(state.section!=='home')break;
      for(const ep of result.filter(x=>x.DisplayEpisodeName)){
        const target=document.querySelector(`.continue-card[data-item="${CSS.escape(ep.Id)}"] .continue-episode`);
        if(!target)continue;
        const season=Number.isInteger(ep.ParentIndexNumber)?`S${String(ep.ParentIndexNumber).padStart(2,'0')}`:'';
        const num=Number.isInteger(ep.IndexNumber)?`E${String(ep.IndexNumber).padStart(2,'0')}`:'';
        target.textContent=[season+num,ep.DisplayEpisodeName].filter(Boolean).join(' · ');
        target.title=target.textContent;
      }
    } catch { /* Offline metadata never blocks the home screen. */ }
  }
}

async function listing(title,subtitle,query){state.items=await getItems(query);$('#content').innerHTML=`<section class="listing-page"><div class="listing-header"><div class="eyebrow"><span class="red-bar"></span> THE COLLECTION</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="listing-meta"><span>${state.items.length} TITLES</span><span class="red-diamond">◆</span><span>YOUR PERSONAL LIBRARY</span></div></div>${state.items.length?`<div class="poster-grid">${state.items.map(itemPoster).join('')}</div>`:`<div class="empty-state">${icon('film',34)}<h2>Nothing here yet</h2><p>Your library will show up when you add media to Jellyfin.</p></div>`}</section>`;await hydrateImages()}
function searchPage(){state.items=[];$('#content').innerHTML=`<section class="search-page"><div class="eyebrow"><span class="red-bar"></span> EXPLORE YOUR WORLD</div><h1>What are we <em>watching?</em></h1><p>Every great story is just a search away.</p><div class="big-search">${icon('search',23)}<input id="searchBox" autofocus placeholder="Search movies and TV series..." value="${esc(state.search)}"><span>ESC TO CLEAR</span></div><div class="search-filters"><select id="searchType" aria-label="Type"><option value="Movie,Series">Movies & series</option><option value="Movie">Movies only</option><option value="Series">Series only</option></select><select id="searchWatched" aria-label="Watched"><option value="all">All titles</option><option value="unwatched">Unwatched</option><option value="watched">Watched</option></select><select id="searchSort" aria-label="Sort"><option value="name">Title</option><option value="year">Newest year</option></select></div><div id="searchResults" class="search-results"><div class="empty-search">${icon('spark',32)}<p>YOUR NEXT DISCOVERY AWAITS.</p></div></div></section>`;$('#searchBox').focus();$('#searchBox').addEventListener('input',e=>{state.search=e.target.value;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(runSearch,220)});document.querySelectorAll('.search-filters select').forEach(el=>el.addEventListener('change',runSearch));if(state.search)runSearch()}
async function runSearch(){const text=state.search.trim();if(!text){$('#searchResults').innerHTML=`<div class="empty-search">${icon('spark',32)}<p>YOUR NEXT DISCOVERY AWAITS.</p></div>`;return}const expected=text;try{const items=await getItems({Recursive:true,SearchTerm:text,Limit:80,IncludeItemTypes:$('#searchType')?.value||'Movie,Series'});if(expected!==state.search.trim())return;state.items=[...new Map(items.filter(item=>item.Type==='Movie'||item.Type==='Series').map(item=>[item.Id,item])).values()];let visible=state.items.filter(x=>$('#searchWatched')?.value==='watched'?x.UserData?.Played:$('#searchWatched')?.value==='unwatched'?!x.UserData?.Played:true);if($('#searchSort')?.value==='year')visible.sort((a,b)=>(b.ProductionYear||0)-(a.ProductionYear||0));$('#searchResults').innerHTML=`<div class="result-count">${visible.length} RESULTS FOR “${esc(text)}”</div>${visible.length?`<div class="poster-grid">${visible.map(itemPoster).join('')}</div>`:'<div class="empty-state"><h2>No matches found</h2><p>Try another title or keyword.</p></div>'}`;await hydrateImages($('#searchResults'))}catch(err){toast(err.message)}}
async function openDetail(id){const content=$('#content');const previous=content.innerHTML;content.innerHTML=loading();try{let item=await api(`/Users/${state.session.user.Id}/Items/${id}`);state.detail=item;state.items=[...state.items.filter(i=>i.Id!==id),item];let children=[];if(item.Type==='Series'){try{children=(await api(`/Shows/${id}/Seasons?${params({UserId:state.session.user.Id,Fields:'Overview'})}`))?.Items||[]}catch{}}else if(item.Type==='Season'){try{children=(await api(`/Shows/${item.SeriesId}/Episodes?${params({UserId:state.session.user.Id,SeasonId:id,Fields:'Overview,MediaSources'})}`))?.Items||[]}catch{}}
state.items=[...state.items.filter(i=>i.Id!==id),...children,item];
const image=item.BackdropImageTags?.length?'Backdrop':'Primary';content.innerHTML=`<section class="detail-page"><div class="detail-backdrop" data-image="${esc(item.Id)}" data-imagetype="${image}"></div><div class="detail-shade"></div><div class="detail-layout"><button class="detail-back btn-quiet" id="goBack">${icon('back',17)} BACK TO BROWSING</button><div class="detail-cover" data-image="${esc(item.Id)}" data-imagetype="Primary" aria-label="Poster for ${esc(item.Name)}"></div><div class="detail-body"><div class="eyebrow"><span class="red-bar"></span> ${esc(item.Type==='Movie'?'FEATURE FILM':item.Type==='Series'?'ORIGINAL SERIES':item.Type||'FROM YOUR LIBRARY')}</div><h1>${esc(item.Name)}</h1><div class="detail-meta"><span>${item.ProductionYear||''}</span><span>${runtime(item.RunTimeTicks)}</span>${item.OfficialRating?`<span class="rating">${esc(item.OfficialRating)}</span>`:''}<span>${esc((item.Genres||[]).slice(0,2).join(' / '))}</span></div><p class="detail-overview">${esc(item.Overview||'No description is available for this title.')}</p><div class="hero-buttons">${!['Series','Folder','CollectionFolder'].includes(item.Type)?`<button class="btn btn-primary" data-action="play" data-id="${esc(item.Id)}">${icon('play',19)} PLAY ${item.UserData?.PlaybackPositionTicks?'AGAIN':'NOW'}</button>`:''}<button class="btn btn-glass" data-action="favorite" data-id="${esc(item.Id)}">${icon(item.UserData?.IsFavorite?'check':'plus',19)} ${item.UserData?.IsFavorite?'IN YOUR LIST':'MY LIST'}</button>${['Movie','Series'].includes(item.Type)?`<button class="btn btn-glass" type="button" data-action="artwork" data-id="${esc(item.Id)}">${icon('film',18)} CHANGE POSTER</button>`:''}</div><div class="detail-genre">${(item.Genres||[]).map(g=>`<span>${esc(g)}</span>`).join('')}</div></div></div></section>${children.length?`<div class="detail-children">${row(item.Type==='Series'?'Seasons':'Episodes','Keep the story going.',children,'EXPLORE MORE')}</div>`:''}`;$('#goBack').onclick=()=>navigate(state.section);
if(item.Type==='Series'&&children.length){
 const area=$('.detail-children');area.insertAdjacentHTML('afterbegin',`<div class="episode-tools"><h2>EPISODE GUIDE</h2><label>Season <select id="seriesSeason">${children.map((x,i)=>`<option value="${esc(x.Id)}" ${i===0?'selected':''}>${esc(x.Name)}</option>`).join('')}</select></label><button id="markSeasonWatched" class="btn btn-outline">Mark season watched</button></div><div id="episodeList" class="episode-list"></div>`);
 const fetchEpisodes=async()=>{const currentSection=state.section;const season=$('#seriesSeason')?.value;if(!season)return;const holder=$('#episodeList');holder.innerHTML=loading();try{const eps=(await api(`/Shows/${item.Id}/Episodes?${params({UserId:state.session.user.Id,SeasonId:season,Fields:'Overview,MediaSources',Limit:200})}`))?.Items||[];
 const enriched=await lookupEpisodeTitles(item,eps);
 if(state.section!==currentSection||state.detail?.Id!==item.Id)return;
 state.items=[...new Map([...state.items,...enriched].map(i=>[i.Id,i])).values()];
 holder.innerHTML=enriched.map(ep=>`<div class="episode-card"><div class="ep-thumb" data-image="${esc(ep.Id)}" data-imagetype="Primary"></div><div><strong>${esc(ep.IndexNumber||'')} · ${esc(ep.DisplayEpisodeName||ep.Name)}</strong><p>${prefs.spoilerFree&&!ep.UserData?.Played?'Description hidden to avoid spoilers.':esc(ep.Overview||'No description available.').slice(0,380)}</p><small>${runtime(ep.RunTimeTicks)} ${ep.UserData?.Played?'• WATCHED':''} ${ep.DisplayEpisodeSource?'· TVmaze metadata':''}</small></div><button class="btn btn-primary" data-action="play" data-id="${esc(ep.Id)}">${icon('play',15)} PLAY</button></div>`).join('')||'<p>No episodes in this season.</p>';if(enriched.some(ep=>ep.DisplayEpisodeSource))holder.insertAdjacentHTML('afterbegin','<p class="metadata-credit">Episode names provided by TVmaze • titles are shown only in CrimsonFin, not changed in Jellyfin.</p>');await hydrateImages(holder)}catch(err){holder.textContent=err.message}};
 $('#seriesSeason').onchange=fetchEpisodes;$('#markSeasonWatched').onclick=async()=>{const season=$('#seriesSeason').value;if(!confirm('Mark all episodes in this season as watched?'))return;try{const eps=(await api(`/Shows/${item.Id}/Episodes?${params({UserId:state.session.user.Id,SeasonId:season,Limit:200})}`))?.Items||[];for(const ep of eps)await api(`/Users/${state.session.user.Id}/PlayedItems/${ep.Id}`,'POST');await fetchEpisodes();toast('Season marked watched')}catch(err){toast(err.message)}};
 fetchEpisodes();
}
await hydrateImages();}catch(err){content.innerHTML=previous;toast(err.message)}}
async function toggleFavorite(id){const item=state.detail;if(!item)return;const next=!item.UserData?.IsFavorite;try{await api(`/Users/${state.session.user.Id}/FavoriteItems/${id}`,next?'POST':'DELETE');item.UserData={...item.UserData,IsFavorite:next};const btn=$('[data-action="favorite"]');if(btn)btn.innerHTML=`${icon(next?'check':'plus',19)} ${next?'IN YOUR LIST':'MY LIST'}`;toast(next?'Added to your list':'Removed from your list')}catch(err){toast(err.message)}}
// Player state is isolated so changing an audio track can restart the stream without
// accidentally starting two position-reporting timers.
const playerProfile={Name:'CrimsonFin Desktop',MaxStreamingBitrate:120000000,
  DirectPlayProfiles:[{Container:'mp4,m4v,mov',Type:'Video',VideoCodec:'h264',AudioCodec:'aac,mp3'}],
  TranscodingProfiles:[{Container:'ts',Type:'Video',AudioCodec:'aac',VideoCodec:'h264',Protocol:'hls',Context:'Streaming',MaxAudioChannels:'6'}],
  SubtitleProfiles:[{Format:'vtt',Method:'External'},{Format:'srt',Method:'External'},{Format:'ass',Method:'Encode'},{Format:'sub',Method:'Encode'}]};
const streamName=(stream)=>[stream.DisplayTitle,stream.Language?.toUpperCase(),stream.Codec?.toUpperCase(),stream.Channels?`${stream.Channels}ch`:'',stream.IsDefault?'Default':''].filter(Boolean).join(' · ')||`Track ${stream.Index}`;
const timeLabel=s=>{s=Math.max(0,Math.floor(Number(s)||0));return `${Math.floor(s/3600)?String(Math.floor(s/3600)).padStart(2,'0')+':':''}${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};
function playerSelectOptions(streams,chosen){return streams.map(s=>`<option value="${s.Index}" ${s.Index===chosen?'selected':''}>${esc(streamName(s))}</option>`).join('')}
async function play(id){try{
  let item=state.detail?.Id===id?state.detail:await api(`/Users/${state.session.user.Id}/Items/${id}`);
  if(item.Type==='Series'){const episodes=(await api(`/Shows/${id}/Episodes?${params({UserId:state.session.user.Id,Limit:1,Fields:'MediaSources'})}`))?.Items||[];if(!episodes.length){toast('This series has no playable episodes.');return}item=episodes[0]}
  if(!['Movie','Episode','Video','MusicVideo'].includes(item.Type)){toast('Select a playable movie or episode.');return}
  closePlayer();
  const info=await api(`/Items/${item.Id}/PlaybackInfo`,'POST',{UserId:state.session.user.Id,DeviceProfile:{...playerProfile,MaxStreamingBitrate:prefs.quality>0?Number(prefs.quality)*1000000:120000000},MaxStreamingBitrate:prefs.quality>0?Number(prefs.quality)*1000000:120000000});
  const source=info?.MediaSources?.[0]||item.MediaSources?.[0];if(!source)throw Error('The server did not provide any playable media sources.');
  const streams=source.MediaStreams||[];
  const audios=streams.filter(x=>x.Type==='Audio');const subtitles=streams.filter(x=>x.Type==='Subtitle');
  const audio=(prefs.audioLanguage&&audios.find(x=>languageMatches(x,prefs.audioLanguage)))||audios.find(x=>x.IsDefault)||audios[0];
  const preferredSubtitle=(prefs.subtitleLanguage&&subtitles.find(x=>languageMatches(x,prefs.subtitleLanguage)&&x.IsExternal&&x.SupportsExternalStream))||subtitles.find(x=>x.IsDefault&&x.IsExternal&&x.SupportsExternalStream)||null;
  const modal=$('#modalRoot');modal.innerHTML=`<div class="player-overlay"><div class="player-top"><div class="player-label"><div class="eyebrow">NOW PLAYING ON CRIMSONFIN</div><h2>${esc(item.Name)}</h2></div><button class="player-close" id="playerClose" aria-label="Close player">${icon('close',22)}</button></div><div class="video-box"><video id="video" autoplay playsinline controls></video><div class="subtitle-overlay" id="subtitleOverlay" aria-live="off"></div><div class="video-loading"><div class="loading-ring"></div></div></div><section class="player-settings" aria-label="Playback controls"><div class="player-settings-header"><strong>PLAYBACK OPTIONS</strong><span id="playerStatus">Preparing playback...</span></div><div class="player-settings-grid"><label>Audio track<select id="audioSelect">${playerSelectOptions(audios,audio?.Index)}</select></label><label>Subtitles<select id="subtitleSelect"><option value="off">Off</option>${playerSelectOptions(subtitles,preferredSubtitle?.Index)}</select></label><label>Subtitle offset <small>(seconds)</small><div class="offset-control"><button type="button" id="subtitleMinus" aria-label="Subtitles 0.5 seconds earlier">−</button><input type="number" id="subtitleOffset" value="0" min="-60" max="60" step="0.5" aria-label="Subtitle timing offset in seconds"><button type="button" id="subtitlePlus" aria-label="Subtitles 0.5 seconds later">+</button></div></label><label>Playback speed<select id="playbackSpeed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><div class="seek-settings"><label>Playback position</label><div class="seek-control"><button type="button" id="seekBack">−10s</button><button type="button" id="seekForward">+10s</button><span id="playerPosition">00:00 / 00:00</span></div></div></div><div class="player-extras"><button id="pipButton" type="button">Picture-in-Picture</button><button id="statsButton" type="button">Playback diagnostics</button><label class="hls-level-label" hidden>Video rendition <select id="hlsLevel" hidden aria-label="HLS video quality"><option value="-1">Auto</option></select></label><button id="nextEpisode" type="button" hidden>Next episode →</button></div><div class="player-diagnostics" id="playerDiagnostics" hidden></div><div class="player-note" id="playerNote">External subtitles are shown with adjustable timing. Embedded subtitles may require server transcoding.</div></section><div class="player-bottom"><span class="live-dot"></span> STREAMING FROM YOUR JELLYFIN SERVER <span class="player-format" id="playerFormat">ADAPTIVE STREAM</span></div></div>`;
  const video=$('#video');const player={video,item,source,sourceId:source.Id,playSessionId:info.PlaySessionId,audios,subtitles,audioIndex:audio?.Index,subtitleIndex:preferredSubtitle?.Index??-1,subtitleOffset:0,subtitleTrack:null,subtitleBlob:null,direct:false,started:false,generation:0};state.player=player;
  $('#playerClose').onclick=closePlayer;
 video.playbackRate=Number(prefs.speed)||1;$('#playbackSpeed').value=String(prefs.speed);$('#playbackSpeed').onchange=e=>{video.playbackRate=Number(e.target.value);updatePreference('speed',video.playbackRate)};
 $('#pipButton').onclick=async()=>{try{if(!document.pictureInPictureEnabled)throw Error('Picture-in-Picture is unavailable on this system');if(document.pictureInPictureElement)await document.exitPictureInPicture();else await video.requestPictureInPicture()}catch(err){toast(err.message)}};
 $('#statsButton').onclick=()=>{const output=$('#playerDiagnostics');output.hidden=!output.hidden;const codec=player.source.MediaStreams?.map(x=>x.Type+': '+x.Codec).join(' / ')||'Unknown';const frames=video.getVideoPlaybackQuality?.();output.textContent=`${player.direct?'Direct play':'Transcoded HLS'} • Source: ${codec} • Output ${video.videoWidth}×${video.videoHeight} • ${frames?frames.droppedVideoFrames+' dropped / '+frames.totalVideoFrames+' frames • ':''}${Math.round(video.playbackRate*100)}% speed • ${state.session.mode} server`};
 if(item.Type==='Episode'&&item.SeriesId){try{const episodes=(await api(`/Shows/${item.SeriesId}/Episodes?${params({UserId:state.session.user.Id,Limit:200,Fields:'MediaSources'})}`))?.Items||[];const ix=episodes.findIndex(x=>x.Id===item.Id);if(ix>=0&&episodes[ix+1]){player.nextId=episodes[ix+1].Id;const next=$('#nextEpisode');next.hidden=false;next.onclick=()=>play(player.nextId)}}catch{}}
 video.addEventListener('ended',()=>{reportPlayer(player,'stop');if(player.nextId&&prefs.autoNext){const next=$('#nextEpisode');if(next){next.textContent='Playing next episode in 8s — click to play now';next.classList.add('ready');const intended=player;setTimeout(()=>{if(state.player===intended&&player.video.ended&&prefs.autoNext)play(player.nextId)},8000);}}});
  $('#audioSelect').onchange=()=>{const index=Number($('#audioSelect').value);if(!Number.isInteger(index))return;player.audioIndex=index;const at=video.currentTime;const wasPaused=video.paused;startPlayerStream(player,at,wasPaused).catch(e=>toast(e.message))};
  $('#subtitleSelect').value=String(player.subtitleIndex===-1?'off':player.subtitleIndex);
  $('#subtitleSelect').onchange=()=>{const value=$('#subtitleSelect').value;player.subtitleIndex=value==='off'?-1:Number(value);applySubtitle(player).catch(e=>{$('#playerNote').textContent=e.message;toast(e.message)})};
  const adjust=(delta)=>{const inp=$('#subtitleOffset');inp.value=String(Math.max(-60,Math.min(60,(Number(inp.value)||0)+delta)));inp.dispatchEvent(new Event('change'))};
  $('#subtitleMinus').onclick=()=>adjust(-.5);$('#subtitlePlus').onclick=()=>adjust(.5);
  $('#subtitleOffset').onchange=()=>{const inp=$('#subtitleOffset');player.subtitleOffset=Math.max(-60,Math.min(60,Number(inp.value)||0));inp.value=String(player.subtitleOffset);renderSubtitles(player)};
  const seek=(amount)=>{if(Number.isFinite(video.duration)){video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+amount))}else video.currentTime=Math.max(0,video.currentTime+amount)};
  $('#seekBack').onclick=()=>seek(-10);$('#seekForward').onclick=()=>seek(10);
  video.addEventListener('timeupdate',()=>{if(state.player!==player)return;$('#playerPosition').textContent=`${timeLabel(video.currentTime)} / ${timeLabel(video.duration)}`;renderSubtitles(player)});
  video.addEventListener('seeked',()=>{reportPlayer(player,'progress');renderSubtitles(player)});
  video.addEventListener('pause',()=>reportPlayer(player,'progress'));
  video.addEventListener('play',()=>{if(!player.started){player.started=true;reportPlayer(player,'start')}});
  video.addEventListener('error',()=>{if(state.player===player){$('#playerStatus').textContent='Playback error';$('.video-loading')?.remove();toast('The server could not play this format. Check transcoding settings.')}});
  state.playTimer=setInterval(()=>{if(state.player===player&&!video.paused)reportPlayer(player,'progress')},15000);
  await startPlayerStream(player,ticksToSeconds(item.UserData?.PlaybackPositionTicks));
  if(player.subtitleIndex!==-1)await applySubtitle(player);
}catch(err){toast(`Couldn't start playback: ${err.message}`)}}
async function reportPlayer(p,type){if(!p)return;const body={ItemId:p.item.Id,MediaSourceId:p.sourceId,PlaySessionId:p.playSessionId,PositionTicks:Math.floor((p.video.currentTime||0)*10000000),IsPaused:p.video.paused,CanSeek:true,PlayMethod:p.direct?'DirectPlay':'Transcode'};try{await api(`/Sessions/Playing${type==='start'?'':type==='stop'?'/Stopped':'/Progress'}`,'POST',body)}catch{}}
async function startPlayerStream(p,position=0,paused=false){
  if(state.player!==p)return;
  const generation=++p.generation;
  const source=p.source;const defaultAudio=p.audios.find(x=>x.IsDefault)||p.audios[0];
  const videoCodec=source.MediaStreams?.find(s=>s.Type==='Video')?.Codec;
  const audioCodec=p.audios.find(s=>s.Index===p.audioIndex)?.Codec || defaultAudio?.Codec;
  const codecOk=String(videoCodec).toLowerCase()==='h264'&&['aac','mp3','mp2',''].includes(String(audioCodec||'').toLowerCase());
  const rateCap=Number(prefs.quality)>0?Number(prefs.quality)*1000000:120000000;
  const direct=Boolean(source.SupportsDirectPlay)&&/^(mp4|m4v|mov)$/i.test(source.Container||'')&&codecOk&&!!p.video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')&&(!defaultAudio||p.audioIndex===defaultAudio.Index)&&(!source.Bitrate||source.Bitrate<=rateCap);
  p.direct=direct;$('#playerFormat').textContent=direct?'DIRECT PLAY':'ADAPTIVE STREAM';$('#playerStatus').textContent='Loading stream...';
  const query=params({MediaSourceId:p.sourceId,PlaySessionId:p.playSessionId,Static:direct?'true':undefined,
    AudioStreamIndex:p.audioIndex,VideoCodec:direct?undefined:'h264',AudioCodec:direct?undefined:'aac',
    VideoBitrate:direct?undefined:Math.max(2000000,Math.min(rateCap-192000,source.Bitrate||20000000)),AudioBitrate:direct?undefined:192000,MaxStreamingBitrate:direct?undefined:rateCap,
    TranscodingContainer:direct?undefined:'ts',SegmentContainer:direct?undefined:'ts',MinSegments:direct?undefined:1,
    BreakOnNonKeyFrames:direct?undefined:'true',StartTimeTicks:direct?undefined:Math.floor(position*10000000)});
  const url=await window.crimson.resource(`/Videos/${p.item.Id}/${direct?'stream':'master.m3u8'}?${query}`);
  if(state.player!==p||p.generation!==generation)return;
  const priorRate=p.video.playbackRate||Number(prefs.speed)||1;p.video.pause();state.hls?.destroy();state.hls=null;
  p.video.removeAttribute('src');p.video.load();p.video.playbackRate=priorRate;
  if(!direct&&Hls.isSupported()){const hls=new Hls({enableWorker:true,maxBufferLength:50,maxMaxBufferLength:90,startLevel:-1,capLevelToPlayerSize:false});state.hls=hls;hls.loadSource(url);hls.attachMedia(p.video);
    hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(state.player!==p)return;const select=$('#hlsLevel');if(!select)return;select.parentElement.hidden=false;select.hidden=false;select.innerHTML='<option value="-1">Auto (adaptive)</option>'+hls.levels.map((level,index)=>`<option value="${index}">${level.height||'?'}p · ${level.bitrate?Math.round(level.bitrate/1000000*10)/10+' Mbps':'unknown bitrate'}</option>`).join('');select.value='-1';select.onchange=()=>{hls.currentLevel=Number(select.value)};});
    hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal&&state.player===p&&p.generation===generation){$('#playerStatus').textContent=`Stream error: ${data.details}`;if(data.type===Hls.ErrorTypes.NETWORK_ERROR)hls.startLoad();else toast('Playback failed: '+data.details)}})}else p.video.src=url;
  p.video.addEventListener('loadedmetadata',()=>{if(state.player!==p||p.generation!==generation)return;
    // HLS starts at the requested server offset, while direct play uses native seeking.
    if(direct&&position>0){try{p.video.currentTime=position}catch{}}
    $('#playerStatus').textContent='Ready';$('.video-loading')?.remove();if(!paused)p.video.play().catch(()=>{});
  },{once:true});
}
function subtitleStreamUrl(p,stream){
  // Jellyfin converts text subtitles to WebVTT on this endpoint. Fetch via IPC
  // to avoid Electron file:// CORS issues; no token is exposed to DOM markup.
  return `/Videos/${encodeURIComponent(p.item.Id)}/${encodeURIComponent(p.sourceId)}/Subtitles/${stream.Index}/Stream.vtt`;
}
async function applySubtitle(p){
  if(state.player!==p)return;
  const generation=p.subtitleGeneration=(p.subtitleGeneration||0)+1;
  p.subtitleTrack=null;if(p.subtitleBlob){URL.revokeObjectURL(p.subtitleBlob);p.subtitleBlob=null}
  for(const t of [...p.video.querySelectorAll('track')])t.remove();
  $('#subtitleOverlay').textContent='';
  if(p.subtitleIndex<0){$('#playerNote').textContent='Subtitles disabled.';return}
  const stream=p.subtitles.find(s=>s.Index===p.subtitleIndex);if(!stream)throw Error('Subtitle stream not found.');
  $('#playerNote').textContent='Loading '+streamName(stream)+'...';
  try{
    const vtt=await window.crimson.subtitle(subtitleStreamUrl(p,stream));
    if(state.player!==p||generation!==p.subtitleGeneration)return;
    if(!/^\s*WEBVTT/.test(vtt))throw Error('The server did not return WebVTT captions.');
    p.subtitleBlob=URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
    const track=document.createElement('track');track.kind='subtitles';track.label=streamName(stream);track.srclang=stream.Language||'und';track.src=p.subtitleBlob;p.video.appendChild(track);
    track.addEventListener('load',()=>{if(state.player!==p||generation!==p.subtitleGeneration)return;p.subtitleTrack=track.track;p.subtitleTrack.mode='hidden';$('#playerNote').textContent='Subtitle timing is adjustable using the offset buttons.';renderSubtitles(p)});
    track.addEventListener('error',()=>{$('#playerNote').textContent='Unable to load this subtitle track.'});
    track.track.mode='hidden';
  }catch(e){if(state.player===p&&generation===p.subtitleGeneration)$('#playerNote').textContent='Subtitle unavailable: '+e.message;throw e}
}
function renderSubtitles(p){if(state.player!==p)return;const overlay=$('#subtitleOverlay');if(!overlay)return;
  const cues=p.subtitleTrack?.cues;const at=p.video.currentTime-p.subtitleOffset;
  if(!cues||p.subtitleIndex<0){overlay.textContent='';return}
  const lines=[];for(const cue of cues){if(cue.startTime<=at&&at<cue.endTime)lines.push(cue.text)}
  // Text-only output: never interpret subtitle data as HTML.
  overlay.textContent=lines.join('\n').replace(/<[^>]*>/g,'');
}
function closePlayer(){if(state.playTimer)clearInterval(state.playTimer);state.playTimer=null;
  const p=state.player;state.player=null;if(p){reportPlayer(p,'stop');p.video.pause();p.video.removeAttribute('src');p.video.load();if(p.subtitleBlob)URL.revokeObjectURL(p.subtitleBlob)}
  state.hls?.destroy();state.hls=null;$('#modalRoot')?.replaceChildren()}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(!button||button.disabled)return;
  if(button.id==='soundToggle'){
    soundsEnabled=!soundsEnabled;
    try{localStorage.setItem('crimsonfin.uiSounds',soundsEnabled?'on':'off')}catch{}
    refreshSoundToggle();playUiSound('confirm');return;
  }
  playUiSound(button.matches('[data-nav],#searchTrigger')?'nav':button.matches('.btn-primary')?'confirm':'tap');
},true);
document.addEventListener('click',e=>{const win=e.target.closest('[data-window]');if(win){window.crimson.window(win.dataset.window);return}const nav=e.target.closest('[data-nav]');if(nav){navigate(nav.dataset.nav);return}const action=e.target.closest('[data-action]');if(action){if(action.dataset.action==='play')play(action.dataset.id);if(action.dataset.action==='favorite')toggleFavorite(action.dataset.id);if(action.dataset.action==='retry')navigate(state.section);if(action.dataset.action==='artwork')showArtworkPicker(action.dataset.id);return}const item=e.target.closest('[data-item]');if(item)openDetail(item.dataset.item)});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(state.session)navigate('search')}if(e.key==='Escape'){if($('#modalRoot .artwork-picker-backdrop'))$('#modalRoot').replaceChildren();else if(state.player)closePlayer();else if(document.activeElement?.id==='searchBox'){state.search='';document.activeElement.value='';runSearch();document.activeElement.blur()}}if(state.player&&e.key==='ArrowRight'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();state.player.video.currentTime+=10}if(state.player&&e.key==='ArrowLeft'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();state.player.video.currentTime=Math.max(0,state.player.video.currentTime-10)}if(e.code==='Space'&&state.player&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();const v=state.player.video;v.paused?v.play():v.pause()}});
const splashStarted=performance.now();
function dismissSplash(){
  const splash=document.getElementById('startup-splash');if(!splash)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(()=>{splash.classList.add('splash-exit');setTimeout(()=>splash.remove(),reduced?40:650)},Math.max(0,(reduced?100:1750)-(performance.now()-splashStarted)));
}
// Never obscure the player indefinitely if a slow server is offline.
setTimeout(dismissSplash,3500);
(async()=>{try{state.session=await window.crimson.session();if(state.session)await loadApp();else login()}catch(err){toast(err.message);login()}finally{dismissSplash()}})();

// Desktop update status; shown unobtrusively in the lower-right corner.
// Windows NSIS installers and Linux AppImages can download/install updates.
function renderUpdateNotice(status) {
  let notice = document.getElementById('crimsonUpdateNotice');
  if (!['available','downloading','downloaded','error'].includes(status?.state)) {
    notice?.remove(); return;
  }
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'crimsonUpdateNotice';
    notice.className = 'crimson-update-notice';
    document.body.appendChild(notice);
  }
  notice.replaceChildren();
  const msg = document.createElement('span');
  msg.textContent = status.message || 'CrimsonFin update';
  notice.appendChild(msg);
  if (status.state === 'downloaded') {
    const button = document.createElement('button');
    button.type = 'button';button.textContent = 'Restart & install';
    button.addEventListener('click', () => window.crimson.updates.install());
    notice.appendChild(button);
  }
  if (status.state === 'error') {
    const dismiss = document.createElement('button');
    dismiss.type='button';dismiss.textContent='Dismiss';
    dismiss.addEventListener('click', () => notice.remove());
    notice.appendChild(dismiss);
  }
}
if (window.crimson?.updates) {
  window.crimson.updates.onStatus(renderUpdateNotice);
  window.crimson.updates.status().then(renderUpdateNotice).catch(()=>{});
}
