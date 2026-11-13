import {writeFile} from 'node:fs/promises';
const url='https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const report={checkedAt:new Date().toISOString(),scope:'Public full bounded OSM and USFS snapshots; no credentials; same snapshot enforced; no automatic retries',sources:[],passed:false};
async function sync(source){
 const result={source,pages:0,items:0,failures:[]};let snapshot,total;
 for(let page=0;;page++){
  const started=Date.now();
  try{
   const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catalog-feed',data:{source,page,windowLimit:40000,...(snapshot?{snapshot}:{})}}),signal:AbortSignal.timeout(60000)});
   const body=await response.json();
   if(response.status!==200||!body.ok){result.failures.push({page,status:response.status,code:body.code||'',elapsedMs:Date.now()-started});break;}
   const data=body.data;if(!snapshot){snapshot=data.snapshot;total=data.total;result.snapshot=snapshot;result.total=total;}
   if(data.snapshot!==snapshot||data.page!==page||data.total!==total||!Array.isArray(data.items)||data.items.length!==Math.min(400,total-page*400)){result.failures.push({page,error:'snapshot/page/length mismatch'});break;}
   result.pages++;result.items+=data.items.length;
   if(!data.hasMore)break;
  }catch(error){result.failures.push({page,error:error.name});break;}
 }
 result.passed=result.failures.length===0&&result.items===total;return result;
}
report.sources=await Promise.all(['osm','usfs'].map(sync));report.passed=report.sources.every(s=>s.passed);
const file=process.argv[2]||'docs/release/deployed-catalog-full-sync-2026-10-07.json';
await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
