const {contextBridge, ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('crimson',{
  session:()=>ipcRenderer.invoke('session:get'),
  connection:{get:()=>ipcRenderer.invoke('connection:get'),save:(settings)=>ipcRenderer.invoke('connection:save',settings)},
  login:(username,password)=>ipcRenderer.invoke('session:login',{username,password}),
  logout:()=>ipcRenderer.invoke('session:logout'),
  api:(path,method='GET',body)=>ipcRenderer.invoke('api:request',{path,method,body}),
  resource:(path)=>ipcRenderer.invoke('api:resource',{path}),
  requests:(endpoint,method='GET',body)=>ipcRenderer.invoke('requests:call',{endpoint,method,body}),
  artwork:{options:(id)=>ipcRenderer.invoke('artwork:options',id),image:(url)=>ipcRenderer.invoke('artwork:image',url),verified:(id)=>ipcRenderer.invoke('artwork:verified',id)},
  subtitle:(path)=>ipcRenderer.invoke('api:subtitle',{path}),
  window:(action)=>ipcRenderer.invoke('window:'+action),
  updates:{status:()=>ipcRenderer.invoke('updates:status'),check:()=>ipcRenderer.invoke('updates:check'),install:()=>ipcRenderer.invoke('updates:install'),onStatus:(callback)=>{const fn=(_event,status)=>callback(status);ipcRenderer.on('updates:status',fn);return ()=>ipcRenderer.removeListener('updates:status',fn)}},
  episodeMetadata:{lookup:(info)=>ipcRenderer.invoke('metadata:tvmaze',info)},
  profile:{getAvatar:()=>ipcRenderer.invoke('profile:avatar-get'),uploadAvatar:(image)=>ipcRenderer.invoke('profile:avatar-upload',image)},
  platform:process.platform
});
