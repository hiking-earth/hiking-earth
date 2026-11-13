import {writeFile} from 'node:fs/promises';
const url='https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
async function request(index){
 const started=Date.now();
 try{
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catalog-feed',data:{source:'usfs',page:40,windowLimit:40000}}),signal:AbortSignal.timeout(60000)});
  const body=await response.json();return {index,status:response.status,ok:body.ok===true,items:body.data?.items?.length||0,error:body.errMsg,elapsedMs:Date.now()-started};
 }catch(error){return {index,ok:false,error:error.name,elapsedMs:Date.now()-started};}
}
const sequential=await request(0);
const concurrent=await Promise.all(Array.from({length:4},(_,i)=>request(i+1)));
const passed=[sequential,...concurrent].every(r=>r.status===200&&r.ok&&r.items===400);
const report={checkedAt:new Date().toISOString(),scope:'Five public directory reads; no account credentials; one sequential then four concurrent requests for the previously failing USFS page',passed,sequential,concurrent};
await writeFile(new URL('../../docs/release/deployed-catalog-concurrency-2026-10-07.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!passed)process.exitCode=1;
