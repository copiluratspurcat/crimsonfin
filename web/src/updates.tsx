import { useEffect, useState } from 'react';
import { DownloadCloud, RefreshCw, CheckCircle2 } from 'lucide-react';

type UpdateState = { state:string; version?:string|null; percent?:number; message?:string };
type Bridge = {
 getStatus:()=>Promise<UpdateState|null>;
 check:()=>Promise<UpdateState|null>;
 install:()=>Promise<boolean>;
 onChange:(fn:(state:UpdateState)=>void)=>()=>void
};
declare global { interface Window { crimsonfinUpdates?: Bridge } }

const names:Record<string,string>={
 idle:'Automatic updates enabled',checking:'Checking for updates…',
 current:'You have the latest version',downloading:'Downloading update…',
 downloaded:'Update ready to install',manual:'Update available',
 error:'Update check failed'
};
export function UpdatePanel(){
 const bridge=window.crimsonfinUpdates;
 const [state,setState]=useState<UpdateState|null>(null);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!bridge)return;
  let live=true;
  bridge.getStatus().then(s=>{if(live)setState(s)}).catch(()=>{});
  const unsubscribe=bridge.onChange(s=>{if(live)setState(s)});
  return ()=>{live=false;unsubscribe()};
 },[bridge]);
 if(!bridge) return <div className="setting-card"><div><h3>App updates</h3>
   <p>The web version runs directly from your server. Desktop installers support in-app updates starting with v2.5.0.</p></div>
   <span className="mini-label">WEB CLIENT</span></div>;
 const message=state?.state?names[state.state]||'Automatic updates enabled':'Automatic updates enabled';
 return <div className="setting-card app-update-card"><div><h3><DownloadCloud size={18}/> App updates</h3>
   <p>{message}{state?.version?' · v'+state.version:''}</p>
   {state?.state==='downloading'&&<div className="update-progress" role="progressbar"
     aria-label="Update download progress" aria-valuenow={Math.round(state.percent||0)}
     aria-valuemin={0} aria-valuemax={100}><i style={{width:Math.max(0,Math.min(100,state.percent||0))+'%'}}/></div>}
   {state?.state==='error'&&<small className="muted">{state.message||'Try again later.'}</small>}
   <small className="muted">CrimsonFin checks GitHub Releases automatically. Windows updates install when you restart. Linux .deb updates may require package-manager approval.</small>
 </div>
 <div className="update-actions">
   <button className="btn btn-ghost" disabled={busy||state?.state==='downloading'||state?.state==='checking'} onClick={async()=>{
     setBusy(true);try{const s=await bridge.check();if(s)setState(s)}finally{setBusy(false)}
   }}><RefreshCw size={15}/> Check now</button>
   {state?.state==='downloaded'&&<button className="btn btn-primary" onClick={()=>bridge.install()}>
     <CheckCircle2 size={15}/> Restart & install</button>}
 </div></div>
}
