// Sites uses its own fixed backend proxy; desktop and mini-program keep direct transport.
const SITE='https://hiking-earth.nanyu20050927.chatgpt.site';
const LOCAL_PREVIEW_HOSTS=new Set(['localhost','127.0.0.1','::1','[::1]']);
export function needsGatewayRelay(){return typeof window!=='undefined'&&(window.location.origin===SITE||LOCAL_PREVIEW_HOSTS.has(window.location.hostname));}
export async function gatewayRelayRequest(action:string,data:Record<string,unknown>,token?:string,timeout=20000):Promise<{status:number;body:unknown}>{
 if(!needsGatewayRelay())throw new Error('当前来源不使用同源代理');
 const response=await fetch('/api/client-api',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(timeout)});
 return {status:response.status,body:await response.json()};
}
