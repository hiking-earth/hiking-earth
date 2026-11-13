const test=require('node:test');
const assert=require('node:assert/strict');
const {createLimiter}=require('../../app/cloudfunctions/client-api/catalog-rate-limit');
function setup({ambiguous=0,failures=0,unknown=false}={}){
 const docs=new Map();let updates=0,adds=0;
 const db={command:{lt:n=>({lt:n}),inc:n=>({inc:n})},collection:()=>({
  doc:id=>({get:async()=>({data:docs.get(id)})}),
  add:async({data})=>{adds++;if(docs.has(data._id))throw new Error('duplicate');docs.set(data._id,{...data});},
  where:q=>({update:async()=>{updates++;if(failures-->0)throw new Error('temporary');const d=docs.get(q._id);
   if(!d||!(d.count<q.count.lt))return {stats:{updated:0}};
   d.count++;if(ambiguous-->0)throw new Error('uncertain commit');return unknown?{}:{stats:{updated:1}};}})
 })};
 const make=()=>createLimiter({db,hash:x=>x,now:()=>0,sleep:async()=>{},fail:(_,status)=>{throw Object.assign(new Error('limited'),{status});}});
 return {make,docs,state:()=>({updates,adds})};
}
test('multiple instances respect exact ceiling with unique initialization',async()=>{
 const s=setup();const a=s.make(),b=s.make();const r=await Promise.allSettled(Array.from({length:20},(_,i)=>(i%2?a:b)('catalog',7)));
 assert.equal(r.filter(x=>x.status==='fulfilled').length,7);assert.equal(s.docs.get('catalog:0').count,7);
 for(const x of r.filter(x=>x.status==='rejected'))assert.equal(x.reason.status,429);
});
test('existing transaction counter is preserved without reset',async()=>{
 const s=setup();s.docs.set('catalog:0',{count:4});const run=s.make();await run('catalog',5);await assert.rejects(run('catalog',5),{status:429});assert.equal(s.state().adds,0);
});
test('uncertain commits consume slots and cannot permit above ceiling',async()=>{
 const s=setup({ambiguous:1});await assert.rejects(s.make()('catalog',1),{status:429});assert.equal(s.docs.get('catalog:0').count,1);
});
test('three transient failures stop and do not bypass storage',async()=>{
 const s=setup({failures:3});const run=s.make();await assert.rejects(run('catalog',5));assert.equal(s.state().updates,3);await run('catalog',5);assert.equal(s.docs.get('catalog:0').count,1);
});
test('unrecognized update result fails closed',async()=>{
 const s=setup({unknown:true});await assert.rejects(s.make()('catalog',10));assert.equal(s.state().updates,3);
});
