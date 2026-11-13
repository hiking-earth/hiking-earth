import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
const reportOption=process.argv.find(arg=>arg.startsWith('--report='));
const reportPath=reportOption?.slice('--report='.length)||'docs/release/deployed-site-api-acceptance-2026-10-07.json';
if(!/^docs\/release\/[a-zA-Z0-9._-]+\.json$/.test(reportPath))throw new Error('Report must be a JSON file inside docs/release');
const base='https://hiking-earth.nanyu20050927.chatgpt.site';const checks=[];
async function request(action,data={},token){const response=await fetch(base+'/api/client-api',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(65000)});return {response,body:await response.json()};}
let challenge;
try{
 const weather=await request('weather.forecast',{latitude:34.49,longitude:113.06});assert.equal(weather.response.status,200);assert.equal(weather.body.ok,true);assert.equal(weather.body.data.provider,'MET Norway');checks.push({name:'same-origin weather',passed:true});
 const catalog=await request('catalog-feed',{source:'hk',page:0,windowLimit:100000});assert.equal(catalog.response.status,200);assert.equal(catalog.body.ok,true);assert.equal(catalog.body.data.total,167);checks.push({name:'same-origin catalog',passed:true,count:catalog.body.data.total});
 const expired=await request('auth.profile',{},'a'.repeat(64));assert.equal(expired.response.status,401);assert.equal(expired.body.code,'SESSION_EXPIRED');assert.equal(expired.response.headers.get('cache-control'),'no-store');checks.push({name:'expired credential remains isolated and uncached',passed:true});
 const started=await request('auth.qr.start',{deviceLabel:'网站协议验收'});assert.equal(started.response.status,200);assert.equal(started.body.ok,true);challenge=started.body.data;assert.match(challenge.challenge,/^[a-f0-9]{64}$/);checks.push({name:'same-origin QR challenge',passed:true});
}catch(error){checks.push({name:'live site API',passed:false,error:error.message});}
finally{if(challenge){try{const cancelled=await request('auth.qr.cancel',challenge);assert.equal(cancelled.body.ok,true);checks.push({name:'test challenge cancelled',passed:true});}catch(error){checks.push({name:'test challenge cleanup',passed:false,error:error.message});}}}
const report={checkedAt:new Date().toISOString(),passed:checks.every(c=>c.passed),scope:'Live Sites proxy weather, catalog, expired token and anonymous QR lifecycle; no production account login or device confirmation claim.',checks};
await writeFile(new URL('../../'+reportPath,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
