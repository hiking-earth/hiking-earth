import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const api='https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const checks=[];
for(const origin of ['tauri://localhost','https://hiking-earth.nanyu20050927.chatgpt.site']){
 try{
 const preflight=await fetch(api,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization'},signal:AbortSignal.timeout(25000)});
 assert.equal(preflight.status,204);
 const response=await fetch(api,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'weather.forecast',data:{latitude:34.49,longitude:113.06}}),signal:AbortSignal.timeout(25000)});
 for(const value of [preflight,response]){
  const allowed=value.headers.get('access-control-allow-origin');
  assert.ok(allowed===origin||allowed==='*',`Invalid CORS origin: ${allowed}; requested ${origin}; ${value===preflight?"OPTIONS":"POST"}; HTTP ${value.status}`);
  assert.ok(!allowed.includes(','));
 }
 assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
 checks.push({origin,status:'passed',preflightStatus:preflight.status,responseStatus:response.status,allowedOrigin:response.headers.get('access-control-allow-origin')});
 }catch(error){checks.push({origin,status:'failed',error:error.message});}
}
const report={checkedAt:new Date().toISOString(),passed:checks.every(item=>item.status==='passed'),scope:'Gateway preflight and real response CORS for desktop and public site. Opaque null origins are unsupported; UI acceptance separate.',checks};
await writeFile(new URL('../../docs/release/deployed-cors-acceptance-2026-10-07.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
if(!report.passed)process.exitCode=1;
