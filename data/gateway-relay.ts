const SITE='https://hiking-earth.nanyu20050927.chatgpt.site';
const ORIGIN='https://cloud1-d9g4fl3fu2491914f-1499973049.tcloudbaseapp.com';
type Reply={status:number;body:any};
let frame:HTMLIFrameElement|undefined;
let ready:Promise<void>|undefined;
const requests=new Map<string,{resolve:(value:Reply)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
let active=0;const waiting:Array<()=>void>=[];
async function acquire(){if(active>=4)await new Promise<void>(resolve=>waiting.push(resolve));else active++;}
function release(){const next=waiting.shift();if(next)next();else active--;}
export function needsGatewayRelay(){return typeof window!=='undefined'&&window.location.origin===SITE;}
function initialize(){
 if(ready)return ready;
 ready=new Promise<void>((resolve,reject)=>{
  frame=document.createElement('iframe');frame.hidden=true;frame.title='徒步地球云服务中转';frame.referrerPolicy='no-referrer';
  const timer=setTimeout(()=>{frame?.remove();frame=undefined;ready=undefined;reject(new Error('云服务中转加载超时'));},15000);
  frame.onload=()=>{clearTimeout(timer);resolve();};frame.onerror=()=>{clearTimeout(timer);frame?.remove();frame=undefined;ready=undefined;reject(new Error('云服务中转暂不可用'));};
  frame.src=ORIGIN+'/hiking-relay/v1/index.html';document.body.appendChild(frame);
 });
 return ready;
}
if(typeof window!=='undefined')window.addEventListener('message',event=>{
 if(event.origin!==ORIGIN||event.source!==frame?.contentWindow)return;
 const data=event.data;if(!data||data.type!=='hiking-relay-response-v1')return;
 const request=requests.get(data.id);if(!request)return;requests.delete(data.id);clearTimeout(request.timer);
 if(data.error||!Number.isInteger(data.status)||data.status<100||data.status>599)request.reject(new Error('云服务请求未完成，请确认结果后重试'));
 else request.resolve({status:data.status,body:data.body});
});
export async function gatewayRelayRequest(action:string,data:Record<string,unknown>,token?:string,timeout=20000):Promise<Reply>{
 if(!needsGatewayRelay())throw new Error('当前来源不使用云服务中转');
 await initialize();
 await acquire();
 const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
 try{return await new Promise<Reply>((resolve,reject)=>{
  const timer=setTimeout(()=>{requests.delete(id);reject(new Error('云服务请求超时，请确认结果后重试'));},timeout);
  requests.set(id,{resolve,reject,timer});
  frame!.contentWindow!.postMessage({type:'hiking-relay-request-v1',id,action,data,...(token?{token}:{})},ORIGIN);
 });}finally{release();}
}
