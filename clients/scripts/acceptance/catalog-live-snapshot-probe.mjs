import {writeFile} from 'node:fs/promises';

const apiUrl=process.env.HIKING_EARTH_CLIENT_API_URL||'https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const sources=['osm','usfs','hk','nzdoc','parkscanada','nsw-npws','england','wales','scotland-argyll','ni-midulster','norfolk-prow','cambridgeshire-prow','news'];
const windowLimit=400;
const report={checkedAt:new Date().toISOString(),scope:'Unauthenticated live catalog first-window probe against current public GitHub manifests; no route access or navigation claims',sources:[],passed:false};

async function readJson(url){
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`HTTP_${response.status}`);
 return response.json();
}

for(const source of sources){
 const result={source,passed:false};
 try{
  const manifest=await readJson(`https://raw.githubusercontent.com/hiking-earth/clients/main/shared/public-catalog/${source}/manifest.json`);
  const response=await fetch(apiUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catalog-feed',data:{source,page:0,windowLimit}}),signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  const data=body?.data||{};
  Object.assign(result,{httpStatus:response.status,ok:body?.ok===true,expectedSnapshot:manifest.snapshot,actualSnapshot:data.snapshot||null,expectedTotal:manifest.total,actualTotal:data.metadata?.sourceTotal??data.total??null,returned:data.items?.length??0,upstreamAvailable:data.upstreamAvailable??false,complete:data.metadata?.complete??false});
  result.passed=response.status===200&&body?.ok===true&&data.snapshot===manifest.snapshot&&data.metadata?.sourceTotal===manifest.total&&data.items?.length===Math.min(manifest.total,windowLimit)&&data.upstreamAvailable===true&&data.metadata?.complete===(manifest.total<=windowLimit);
  if(!result.passed)result.error=body?.errMsg||'LIVE_RESULT_MISMATCH';
 }catch(error){result.error=error.name==='TimeoutError'?'TIMEOUT':error.message;}
 report.sources.push(result);
}
report.passed=report.sources.every(item=>item.passed);
const output=process.argv[2];
if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
