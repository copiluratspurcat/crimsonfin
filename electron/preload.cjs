const {contextBridge, ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('crimson',{
  session:()=>ipcRenderer.invoke('session:get'),
  login:(server,username,password)=>ipcRenderer.invoke('session:login',{server,username,password}),
  logout:()=>ipcRenderer.invoke('session:logout'),
  api:(path,method='GET',body)=>ipcRenderer.invoke('api:request',{path,method,body}),
  resource:(path)=>ipcRenderer.invoke('api:resource',{path}),
  subtitle:(path)=>ipcRenderer.invoke('api:subtitle',{path}),
  window:(action)=>ipcRenderer.invoke('window:'+action),
  updates:{status:()=>ipcRenderer.invoke('updates:status'),check:()=>ipcRenderer.invoke('updates:check'),install:()=>ipcRenderer.invoke('updates:install'),onStatus:(callback)=>{const fn=(_event,status)=>callback(status);ipcRenderer.on('updates:status',fn);return ()=>ipcRenderer.removeListener('updates:status',fn)}},
  platform:process.platform
});
