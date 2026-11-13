/** One shared freshness clock; starts only while photo components subscribe. */
const listeners=new Set<(now:number)=>void>();
let timer:ReturnType<typeof setInterval>|undefined;
export function refreshScenicClock():void {
 const now=Date.now();
 for(const callback of [...listeners])try{callback(now);}catch{/* One view must not stop another view's expiry refresh. */}
}
export function subscribeScenicClock(callback:(now:number)=>void):()=>void {
 listeners.add(callback);
 if(listeners.size===1){
  timer=setInterval(refreshScenicClock,30000);
  if(typeof document!=='undefined')document.addEventListener('visibilitychange',refreshScenicClock);
  if(typeof window!=='undefined')window.addEventListener('pageshow',refreshScenicClock);
 }
 try{callback(Date.now());}catch{/* Retain the unsubscribe handle even if the initial render rejects. */}
 let active=true;
 return ()=>{
  if(!active)return;active=false;listeners.delete(callback);
  if(!listeners.size){
   if(timer!==undefined)clearInterval(timer);timer=undefined;
   if(typeof document!=='undefined')document.removeEventListener('visibilitychange',refreshScenicClock);
   if(typeof window!=='undefined')window.removeEventListener('pageshow',refreshScenicClock);
  }
 };
}
