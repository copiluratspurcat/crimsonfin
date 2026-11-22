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
let updateStatus = { state: 'disabled', message: 'Updates require a Windows installer or Linux AppImage.' };
function sendUpdate(state, message, extra = {}) {
  updateStatus = { state, message, ...extra };
  if (win && !win.isDestroyed()) win.webContents.send('updates:status', updateStatus);
}
function setupAutoUpdater() {
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
  win = new BrowserWindow({width:1440,height:900,minWidth:920,minHeight:620,backgroundColor:'#0a090b',icon:path.join(__dirname,'..','assets','crimsonfin.png'),titleBarStyle:'hidden',titleBarOverlay:process.platform==='win32'?{color:'#0a090b',symbolColor:'#f2e9e9',height:42}:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
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
