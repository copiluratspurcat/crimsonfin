const { app, BrowserWindow, ipcMain, shell, safeStorage, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { autoUpdater } = require('electron-updater');

app.setName('CrimsonFin');
let win;
let session = null;
const dataPath = () => path.join(app.getPath('userData'), 'session.json');
const deviceIdPath = () => path.join(app.getPath('userData'), 'device-id');
// CrimsonFin's default server pair. Both addresses can be changed in the login UI.
// Avoid putting API keys, Jellyfin passwords, or Tailscale auth keys in source code.
const DEFAULT_CONNECTION = Object.freeze({
  local: 'http://192.168.1.105:8096',
  remote: 'https://hoesmad.tail0adc10.ts.net',
  smart: true
});
const connectionPath = () => path.join(app.getPath('userData'), 'connection.json');
function readConnection() {
  try { return {...DEFAULT_CONNECTION, ...JSON.parse(fs.readFileSync(connectionPath(), 'utf8'))}; }
  catch { return {...DEFAULT_CONNECTION}; }
}
function saveConnection(config) {
  fs.mkdirSync(app.getPath('userData'), {recursive:true});
  fs.writeFileSync(connectionPath(), JSON.stringify(config, null, 2), {mode:0o600});
}
let connection = null;
function validateConnection(input) {
  if (!input || typeof input !== 'object') throw Error('Invalid server settings.');
  const local = input.local ? normalizeServer(input.local) : '';
  const remote = input.remote ? normalizeServer(input.remote) : '';
  const smart = !!input.smart;
  if (!local && !remote) throw Error('Enter at least one Jellyfin server address.');
  return {local,remote,smart};
}
function candidates(config) {
  const ordered = config.smart ? [config.local, config.remote] : [config.remote || config.local];
  return [...new Set(ordered.filter(Boolean))];
}
function connectionMode(server, config=connection) {
  return server === config?.local ? 'local' : server === config?.remote ? 'remote' : 'custom';
}
async function probe(server, timeout=2800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await net.fetch(new URL('/System/Info/Public', server).toString(), {
      method: 'GET', signal:controller.signal, headers:{Accept:'application/json'}, cache:'no-store'
    });
    if (!response.ok) return false;
    const data=await response.json();
    return !!data && typeof data === 'object' && (data.Id || data.ServerName || data.Version);
  } catch { return false; }
  finally { clearTimeout(timer); }
}
async function findReachable(config) {
  for (const url of candidates(config)) if (await probe(url)) return url;
  throw Error('Unable to reach Jellyfin on either address. Check your home connection or Tailscale Funnel.');
}
function visibleSession() {
  return session && {server:session.server,user:session.user,mode:connectionMode(session.server)};
}

function deviceId() {
  try { return fs.readFileSync(deviceIdPath(), 'utf8'); } catch {
    const id = crypto.randomUUID(); fs.mkdirSync(app.getPath('userData'), {recursive:true});
    fs.writeFileSync(deviceIdPath(), id, {mode:0o600}); return id;
  }
}
function authHeader(token) {
  const parts = ['Client="CrimsonFin"','Device="Desktop"',`DeviceId="${deviceId()}"`,`Version="${app.getVersion()}"`];
  if (token) parts.push(`Token="${token.replace(/[^A-Za-z0-9._~-]/g,'')}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}
function normalizeServer(value) {
  const u = new URL(value.trim().replace(/\/+$/,''));
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw Error('Enter an http:// or https:// Jellyfin server address.');
  u.hash='';u.search=''; return u.toString().replace(/\/$/,'');
}
function storeSession(value) {
  if (!value) {try{fs.unlinkSync(dataPath())}catch{};return;}
  const serialized=JSON.stringify(value);
  const payload=safeStorage.isEncryptionAvailable()
    ? {protected:true, payload:safeStorage.encryptString(serialized).toString('base64')}
    : {protected:false, payload:serialized};
  fs.writeFileSync(dataPath(), JSON.stringify(payload), {mode:0o600});
}
function restoreSession() {
  try {
    const s=JSON.parse(fs.readFileSync(dataPath(),'utf8'));
    if(s.protected && !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(s.protected?safeStorage.decryptString(Buffer.from(s.payload,'base64')):s.payload);
  }catch{return null;}
}
async function request(server, pathName, token, options={}) {
  if (!pathName.startsWith('/') || pathName.startsWith('//') || /[\\\r\n]/.test(pathName)) throw Error('Invalid API path');
  const url = new URL(server + pathName);
  if (url.origin !== new URL(server).origin || !url.pathname.startsWith(new URL(server).pathname.replace(/\/$/,'')+'/')) throw Error('Invalid API origin');
  const response = await net.fetch(url.toString(), {method:options.method || 'GET', headers:{'Authorization':authHeader(token),'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{})}, body:options.body?JSON.stringify(options.body):undefined});
  const body=await response.text();
  let payload;try{payload=body?JSON.parse(body):null}catch{payload=body}
  if(!response.ok) throw Error((payload?.Message||payload?.message||`Server returned ${response.status}`).toString().slice(0,240));
  return payload;
}

// Updates are supported for installed Windows NSIS builds and Linux AppImages.
// Debian .deb packages must be updated manually from GitHub Releases.
let updaterReady = false;
let updateStatus = { state: 'disabled', message: 'Private GitHub Releases: install new versions manually from the repository Releases page.' };
function sendUpdate(state, message, extra = {}) {
  updateStatus = { state, message, ...extra };
  if (win && !win.isDestroyed()) win.webContents.send('updates:status', updateStatus);
}
function setupAutoUpdater() {
  // Private GitHub Releases cannot be queried by other users without authentication.
  // Do not ship a GitHub token in the application.
  sendUpdate('disabled', 'Automatic updates are unavailable with private GitHub Releases. Install new versions manually.');
  return;
  const supported = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE);
  if (!app.isPackaged || !supported) return;
  try {
    // app-update.yml is generated by electron-builder only after a publisher is configured.
    const updateConfig = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(updateConfig)) {
      sendUpdate('disabled', 'No update server configured. See README.'); return;
    }
    updaterReady = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => sendUpdate('checking', 'Checking for updates…'));
    autoUpdater.on('update-available', info => sendUpdate('available', `Downloading CrimsonFin ${info.version}…`, { version: info.version }));
    autoUpdater.on('update-not-available', () => sendUpdate('current', 'CrimsonFin is up to date.'));
    autoUpdater.on('download-progress', progress => sendUpdate('downloading', `Downloading update: ${Math.round(progress.percent)}%`, { percent: progress.percent }));
    autoUpdater.on('update-downloaded', info => sendUpdate('downloaded', `CrimsonFin ${info.version} is ready to install. Restart to update.`, { version: info.version }));
    autoUpdater.on('error', error => sendUpdate('error', `Update check failed: ${String(error?.message || error).slice(0,180)}`));
    setTimeout(() => autoUpdater.checkForUpdates().catch(e => sendUpdate('error', String(e.message || e))), 10000);
    const interval = setInterval(() => {
      if (!win?.isDestroyed()) autoUpdater.checkForUpdates().catch(e => sendUpdate('error', String(e.message || e)));
    }, 6 * 60 * 60 * 1000);
    interval.unref?.();
    sendUpdate('idle', 'Automatic updates are enabled.');
  } catch (error) {
    sendUpdate('error', `Unable to initialize updater: ${error.message}`);
  }
}

function makeWindow(){
  win = new BrowserWindow({width:1440,height:900,minWidth:920,minHeight:620,backgroundColor:'#0a090b',icon:path.join(__dirname,'..','assets','crimsonfin.png'),frame:process.platform!=='win32',titleBarStyle:'hidden',titleBarOverlay:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.loadFile(path.join(__dirname,'..','dist','index.html'));
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return{action:'deny'}});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://')) event.preventDefault()});
}
app.whenReady().then(()=>{
  session=restoreSession();
  try { connection=validateConnection(readConnection()); }
  catch { connection={...DEFAULT_CONNECTION}; }
  ipcMain.handle('connection:get',()=>connection);
  ipcMain.handle('connection:save',(_event,settings)=>{
    const next=validateConnection(settings);
    connection=next;saveConnection(connection);
    return connection;
  });
  ipcMain.handle('session:get',async()=>{
    if (!session) return null;
    // On every launch prefer LAN when reachable, otherwise use the HTTPS Funnel.
    // Never send the saved Jellyfin access token to an unverified endpoint.
    try {
      const next=await findReachable(connection);
      const currentInfo=await request(next,'/System/Info/Public',null);
      const priorInfo=await request(session.server,'/System/Info/Public',null).catch(()=>null);
      if (next !== session.server && priorInfo?.Id && currentInfo?.Id && priorInfo.Id!==currentInfo.Id) {
        throw Error('Configured addresses refer to different Jellyfin servers.');
      }
      // If the original server is unavailable, validate that the existing token
      // belongs to the destination before using it for ordinary API requests.
      if (next !== session.server) {
        if (!session.serverId || !currentInfo?.Id || currentInfo.Id !== session.serverId) throw Error('Server identity mismatch. Switch account and sign in again to enable Smart Connect.');
        await request(next,'/Users/Me',session.token);
        session.server=next;session.serverId=currentInfo.Id;storeSession(session);
      }
    } catch (err) {
      // Retain the existing session; the UI will display a useful error on API load.
      if (/identity mismatch|different Jellyfin servers/i.test(err.message)) throw err;
    }
    return visibleSession();
  });
  ipcMain.handle('session:login',async(_,{username,password})=>{
    const base=await findReachable(connection);
    const info=await request(base,'/System/Info/Public',null);
    const result=await request(base,'/Users/AuthenticateByName',null,{method:'POST',body:{Username:username, Pw:password}});
    if(!result?.AccessToken||!result?.User?.Id) throw Error('The server did not return a valid session.');
    session={server:base,serverId:info?.Id||null,token:result.AccessToken,user:result.User};storeSession(session);
    return visibleSession();
  });
  ipcMain.handle('session:logout',()=>{session=null;storeSession(null);return true});
  ipcMain.handle('api:request',async(_,{path:requestPath,method,body})=>{
    if(!session) throw Error('Not signed in');
    if(!['GET','POST','DELETE'].includes(method||'GET')) throw Error('Method not allowed');
    return request(session.server,requestPath,session.token,{method,body});
  });
  ipcMain.handle('api:resource',(_,{path:resourcePath})=>{
    if(!session) throw Error('Not signed in');
    if(!/^\/(Items|Videos|Audio)\/[a-f0-9-]+\//i.test(resourcePath)) throw Error('Resource not allowed');
    const url=new URL(session.server + resourcePath);
    if(url.origin!==new URL(session.server).origin)throw Error('Invalid resource');
    url.searchParams.set('api_key',session.token);
    return url.toString();
  });
  ipcMain.handle('requests:call', async (_event, payload = {}) => {
    if (!session) throw Error('Sign in to Jellyfin first.');
    const method = payload.method || 'GET';
    const endpoint = payload.endpoint;
    if (!['GET', 'POST'].includes(method) || typeof endpoint !== 'string' ||
        !/^\/api\/(?:status|catalog|requests(?:\/[a-f0-9-]{36}(?:\/(?:matches|approve|cancel|retry|start))?)?)(?:\?[A-Za-z0-9%._~&=+\-]*)?$/.test(endpoint)) {
      throw Error('Request API path is not allowed.');
    }
    if (payload.body && JSON.stringify(payload.body).length > 14000) throw Error('Request is too large.');
    const base = new URL(session.server);
    const url = new URL('/requests' + endpoint, base);
    if (url.origin !== base.origin) throw Error('Invalid request service origin.');
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 11000);
    try {
      response = await net.fetch(url.toString(), {
        method,
        headers: { 'X-Emby-Token': session.token, 'Accept':'application/json',
          ...(method==='POST'?{'Content-Type':'application/json'}:{}) },
        body: method==='POST' ? JSON.stringify(payload.body || {}) : undefined,
        redirect:'error', signal:controller.signal
      });
    } catch (error) {
      throw Error('Request service unavailable. Check the server companion and /requests reverse proxy.');
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { throw Error('The request service returned a non-JSON response. Check the reverse proxy.'); }
    if (!response.ok) throw Error(String(data.error || data.message || 'Request service error (' + response.status + ')').slice(0,260));
    return data;
  });
  ipcMain.handle('api:subtitle',async(_,{path:subtitlePath})=>{
    if(!session)throw Error('Not signed in');
    if(!/^\/Videos\/[a-f0-9-]+\/[a-f0-9-]+\/Subtitles\/\d+\/Stream\.vtt$/i.test(subtitlePath))throw Error('Invalid subtitle path');
    const url=new URL(session.server+subtitlePath);
    if(url.origin!==new URL(session.server).origin)throw Error('Invalid subtitle server');
    const response=await net.fetch(url.toString(),{headers:{Authorization:authHeader(session.token),Accept:'text/vtt'}});
    if(!response.ok)throw Error('Subtitle request failed ('+response.status+')');
    const body=await response.text();
    if(body.length>12_000_000)throw Error('Subtitle file is too large');
    return body;
  });
  // Artwork alternatives come only from providers registered with Jellyfin.
  // Never download arbitrary renderer-supplied URLs or expose server tokens.
  const artworkHosts = new Set(['image.tmdb.org','artworks.thetvdb.com','static.tvmaze.com','assets.fanart.tv','fanart.tv','images.fanart.tv']);
  const allowedPosterUrl = text => {
    try {const u=new URL(text);return u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') && artworkHosts.has(u.hostname.toLowerCase()) && !u.hash}
    catch{return false}
  };
  const artworkChoices = new Map();
  ipcMain.handle('artwork:options', async (_event, itemId) => {
    if (!session) throw Error('Sign in first');
    if(!/^[a-f0-9-]{32,36}$/i.test(String(itemId)))throw Error('Invalid media item ID');
    const result=await request(session.server,`/Items/${itemId}/RemoteImages?type=Primary&limit=20`,session.token);
    const choices=(result?.Images||[]).filter(img=>img?.Type==='Primary' && allowedPosterUrl(img.Url))
      .slice(0,16).map(img=>({Url:img.Url,Type:'Primary',Width:img.Width||0,Height:img.Height||0,ProviderName:String(img.ProviderName||'Metadata provider').slice(0,80)}));
    for(const img of choices)artworkChoices.set(img.Url,Date.now());
    if(artworkChoices.size>250)for(const [key,timestamp] of artworkChoices)if(Date.now()-timestamp>60*60*1000)artworkChoices.delete(key);
    return choices;
  });
  ipcMain.handle('artwork:image',async(_event,imageUrl)=>{
    if(!session)throw Error('Sign in first');
    if(!allowedPosterUrl(imageUrl))throw Error('Artwork host is not permitted');
    // A user can only fetch an image previously offered by their Jellyfin server.
    // Session changes clear this map to avoid crossing accounts.
    const timestamp=artworkChoices.get(imageUrl);
    if(!timestamp||Date.now()-timestamp>60*60*1000){
      // Request a fresh list before using a saved artwork override.
      // Saved poster URLs are not arbitrary network fetch capabilities.
      const safe=String(imageUrl);
      if(![...artworkChoices.keys()].includes(safe))throw Error('Artwork option expired; choose the poster again');
      throw Error('Artwork option expired; choose the poster again');
    }
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await net.fetch(imageUrl,{headers:{Accept:'image/jpeg,image/png,image/webp'},redirect:'error',signal:controller.signal});
      if(!response.ok)throw Error('Artwork provider returned '+response.status);
      const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
      if(!['image/jpeg','image/png','image/webp'].includes(mime))throw Error('Unsupported image format');
      if(Number(response.headers.get('content-length'))>3500000)throw Error('Artwork image is too large');
      const buffer=Buffer.from(await response.arrayBuffer());
      if(buffer.length>3500000)throw Error('Artwork image is too large');
      return `data:${mime};base64,${buffer.toString('base64')}`;
    }finally{clearTimeout(timer)}
  });
  // Public TV metadata. No Jellyfin token, media path, or password is sent to TVmaze.
  const tvmazeCache = new Map();
  const externalJSON = async (url) => {
    if (new URL(url).origin !== 'https://api.tvmaze.com') throw Error('Metadata host not permitted');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await net.fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:controller.signal});
      if (response.status === 404) return null;
      if (!response.ok) throw Error('Metadata provider returned '+response.status);
      const data = await response.json();return data;
    } finally {clearTimeout(timer)}
  };
  // Fetch the canonical series poster from TVmaze, matching by TVDB ID or
  // exact title and release year. Movies use Jellyfin's own remote image providers.
  const canonicalPosters = new Map();
  ipcMain.handle('artwork:verified',async(_event,itemId)=>{
    if(!session)throw Error('Sign in first');
    if(!/^[a-f0-9-]{32,36}$/i.test(String(itemId)))throw Error('Invalid item ID');
    const cacheKey=session.serverId+':'+itemId;
    const hit=canonicalPosters.get(cacheKey);
    if(hit && Date.now()<hit.until)return hit.value;
    const item=await request(session.server,`/Users/${session.user.Id}/Items/${itemId}`,session.token);
    if(!['Movie','Series'].includes(item?.Type))return null;
    const norm=t=>String(t||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
    const year=Number(item.ProductionYear)||0;
    let candidates=[];
    if(item.Type==='Series'){
      const tvdb=String(item.ProviderIds?.Tvdb||item.ProviderIds?.TheTvdb||'');
      let show=null, idMatched=false;
      if(/^\d{1,10}$/.test(tvdb)){
        show=await externalJSON('https://api.tvmaze.com/lookup/shows?thetvdb='+encodeURIComponent(tvdb)).catch(()=>null);
        idMatched=!!show?.id;
      }
      if(!show){
        const search=await externalJSON('https://api.tvmaze.com/search/shows?q='+encodeURIComponent(String(item.Name).slice(0,120))).catch(()=>[]);
        const exact=Array.isArray(search)?search.map(x=>x?.show).filter(x=>x?.id&&norm(x.name)===norm(item.Name)):[];
        const matching=year?exact.filter(x=>{const y=Number(String(x.premiered||'').slice(0,4));return !y||Math.abs(y-year)<=1}):exact;
        if(matching.length===1)show=matching[0];
      }
      if(show?.id && (idMatched||norm(show.name)===norm(item.Name))){
        const poster=show.image?.original||show.image?.medium;
        if(poster)candidates.push({url:poster,provider:'TVmaze · '+show.name});
      }
    }
    // Jellyfin's provider list is tied to this item ID. Prefer sources with
    // portrait aspect ratios and known image-provider CDN origins.
    const remote=await request(session.server,`/Items/${itemId}/RemoteImages?type=Primary&limit=20`,session.token).catch(()=>({}));
    const images=(remote.Images||[]).filter(x=>x.Type==='Primary'&&allowedPosterUrl(x.Url) && (!x.Width||!x.Height||x.Height/x.Width>1.25));
    images.sort((a,b)=>{
      const score=x=>/themoviedb|tmdb/i.test(x.ProviderName||'')?100:/tvdb|fanart/i.test(x.ProviderName||'')?50:0;
      return score(b)-score(a);
    });
    for(const img of images.slice(0,3))candidates.push({url:img.Url,provider:img.ProviderName||'Jellyfin provider'});
    let output=null;
    for(const entry of candidates.slice(0,4)){
      if(!allowedPosterUrl(entry.url))continue;
      try{
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5500);
        try{
          const resp=await net.fetch(entry.url,{headers:{Accept:'image/jpeg,image/png,image/webp'},redirect:'error',signal:controller.signal});
          if(!resp.ok)continue;
          const mime=(resp.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
          if(!['image/jpeg','image/png','image/webp'].includes(mime))continue;
          if(Number(resp.headers.get('content-length')||0)>4_000_000)continue;
          const bytes=Buffer.from(await resp.arrayBuffer());
          if(bytes.length>4_000_000)continue;
          output={image:`data:${mime};base64,${bytes.toString('base64')}`,provider:entry.provider};break;
        }finally{clearTimeout(timeout)}
      }catch{}
    }
    if(canonicalPosters.size>500)canonicalPosters.clear();
    canonicalPosters.set(cacheKey,{value:output,until:Date.now()+(output?6:1)*3600000});
    return output;
  });
  ipcMain.handle('metadata:tvmaze', async (_event, data={})=>{
    if (!session) throw Error('Sign in to use metadata lookup');
    const name=String(data.name||'').trim().slice(0,120);
    const year=Number(data.year)||0;
    const tvdb=String(data.providers?.Tvdb||data.providers?.TheTvdb||'').trim();
    if (!name || !/^[\p{L}\p{N} .,:!?()_&+\-']{1,120}$/u.test(name)) throw Error('Invalid show name');
    const key = `${name.toLowerCase()}:${year}:${tvdb}`;
    const cache=tvmazeCache.get(key);
    if(cache && cache.expires>Date.now()) return cache.data;
    let show=null;let matchedById=false;
    if (/^\d{1,10}$/.test(tvdb)) {show=await externalJSON('https://api.tvmaze.com/lookup/shows?thetvdb='+encodeURIComponent(tvdb)).catch(()=>null);matchedById=!!show?.id;}
    if (!show) show=await externalJSON('https://api.tvmaze.com/singlesearch/shows?q='+encodeURIComponent(name));
    const norm=str=>String(str||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const same=norm(show?.name)===norm(name);
    const premiered=Number(String(show?.premiered||'').slice(0,4));
    // Never auto-attach an episode list when the show match looks dubious.
    if (!show?.id || (!same && !matchedById) || (year && premiered && Math.abs(year-premiered)>2 && !matchedById)) {
      const missing={episodes:[],matched:false};tvmazeCache.set(key,{data:missing,expires:Date.now()+3600000});return missing;
    }
    const episodes=await externalJSON(`https://api.tvmaze.com/shows/${Number(show.id)}/episodes?specials=1`);
    const result={matched:true,show:String(show.name).slice(0,120),source:'TVmaze',episodes:(Array.isArray(episodes)?episodes:[]).filter(ep=>Number.isInteger(ep.season)&&Number.isInteger(ep.number)&&ep.name).slice(0,1500).map(ep=>({season:ep.season,number:ep.number,name:String(ep.name).slice(0,180)}))};
    tvmazeCache.set(key,{data:result,expires:Date.now()+24*3600000});return result;
  });
  ipcMain.handle('profile:avatar-get',async()=>{
    if(!session)throw Error('Not signed in');
    const id=String(session.user.Id);
    const url=new URL(`${session.server}/Users/${id}/Images/Primary?maxWidth=320`);
    const response=await net.fetch(url.toString(),{headers:{Authorization:authHeader(session.token)},redirect:'error'});
    if(!response.ok) return null;
    const mimetype=response.headers.get('content-type')||'';
    if(!/^image\/(?:png|jpeg|webp)/i.test(mimetype))return null;
    const raw=Buffer.from(await response.arrayBuffer());if(raw.byteLength>1000000)return null;
    return `data:${mimetype.split(';')[0]};base64,${raw.toString('base64')}`;
  });
  ipcMain.handle('profile:avatar-upload',async(_event,dataUrl)=>{
    if(!session)throw Error('Not signed in');
    if(typeof dataUrl!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)||dataUrl.length>800000)throw Error('Invalid JPG portrait');
    const buffer=Buffer.from(dataUrl.split(',')[1],'base64');
    if(buffer.length>520000)throw Error('Profile image too large');
    const url=new URL(`${session.server}/Users/${session.user.Id}/Images/Primary`);
    const result=await net.fetch(url.toString(),{method:'POST',headers:{'Authorization':authHeader(session.token),'Content-Type':'image/jpeg'},body:buffer,redirect:'error'});
    if(!result.ok){const detail=String(await result.text()).slice(0,160);throw Error(`Jellyfin ${result.status}: ${detail||'insufficient permission'}`)}
    return true;
  });
  ipcMain.handle('updates:status', () => updateStatus);
  ipcMain.handle('updates:check', async () => { if (!updaterReady) return updateStatus; try { await autoUpdater.checkForUpdates(); } catch (e) { sendUpdate('error', String(e.message || e)); } return updateStatus; });
  ipcMain.handle('updates:install', () => { if (updaterReady && updateStatus.state === 'downloaded') { setImmediate(() => autoUpdater.quitAndInstall(false, true)); return true; } return false; });
  ipcMain.handle('window:minimize',()=>win?.minimize());
  ipcMain.handle('window:maximize',()=>win?.isMaximized()?win.unmaximize():win.maximize());
  ipcMain.handle('window:close',()=>win?.close());
  makeWindow();
  setupAutoUpdater();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)makeWindow()});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
