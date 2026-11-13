const test=require('node:test');
const assert=require('node:assert/strict');
const {createLimiter}=require('../../app/cloudfunctions/client-api/rate-limit');
function setup({failures=0,max=10,ambiguous=false}={}){
 let count=0,calls=0,active=0,peak=0;
 const db={async runTransaction(fn){calls++;active++;peak=Math.max(peak,active);try{
  await new Promise(resolve=>setImmediate(resolve));
  if(failures-->0){if(ambiguous)count++;throw new Error('SDK transaction failure');}
  await fn({collection:()=>({doc:()=>({get:async()=>({data:{count}}),set:async({data})=>{count=data.count;}})})});
 }finally{active--;}}};
 const limiter=createLimiter({db,hash:x=>x,now:()=>0,sleep:async()=>{},fail:(_,status)=>{throw Object.assign(new Error('limited'),{status});}});
 return {run:()=>limiter('catalog',max),state:()=>({count,calls,peak})};
}
test('concurrent requests serialize and enforce the exact ceiling',async()=>{
 const s=setup({max:3});const results=await Promise.allSettled(Array.from({length:5},()=>s.run()));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,3);assert.deepEqual(s.state(),{count:3,calls:5,peak:1});
 for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.status,429);
});
test('transient failures retry within three attempts',async()=>{
 const s=setup({failures:2});await s.run();assert.equal(s.state().calls,3);assert.equal(s.state().count,1);
});
test('persistent failures stop at three and release the queue',async()=>{
 const s=setup({failures:3});await assert.rejects(s.run());assert.equal(s.state().calls,3);await s.run();assert.equal(s.state().count,1);
});
test('uncertain commits consume slots conservatively and cannot bypass the ceiling',async()=>{
 const s=setup({failures:1,max:1,ambiguous:true});await assert.rejects(s.run(),{status:429});assert.equal(s.state().count,1);assert.equal(s.state().calls,2);
});
