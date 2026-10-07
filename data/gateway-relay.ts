// Sites uses its own fixed backend proxy; desktop and mini-program keep direct transport.
const SITE='https://hiking-earth.nanyu20050927.chatgpt.site';
export function needsGatewayRelay(){return typeof window!=='undefined'&&window.location.origin===SITE;}
export async function gatewayRelayRequest(action:string,data:Record<string,unknown>,token?:string,timeout=20000):Promise<{status:number;body:any}>{
 if(!needsGatewayRelay())throw new Error('当前来源不使用网站代理');
 const response=await fetch('/api/client-api',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(timeout)});
 return {status:response.status,body:await response.json()};
}
