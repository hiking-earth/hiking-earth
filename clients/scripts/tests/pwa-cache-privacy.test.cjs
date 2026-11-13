const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function harness(headers={}){
 const handlers={},stored=new Map(),pending=[];
 const cache={delete:async r=>stored.delete(r.url),put:async(r,v)=>stored.set(r.url,v),keys:async()=>[...stored.keys()].map(u=>new Request(u)),match:async r=>stored.get(r.url)};
 const context={Request,Response,Headers,Blob,URL,Promise,caches:{open:async()=>cache,match:async r=>stored.get(r.url)},fetch:async()=>new Response('public asset',{headers}),self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.runInNewContext(fs.readFileSync('web/public/sw.js','utf8'),context);
 return {stored,async get(path,options={}){let result;handlers.fetch({request:new Request('https://example.test'+path,options),respondWith:p=>result=p,waitUntil:p=>pending.push(p)});if(result)await result;await Promise.all(pending);return result!==undefined;}};
}
test('authenticated GET and API never intercepted',async()=>{
 const h=harness();assert.equal(await h.get('/asset',{headers:{authorization:'Bearer isolated-fixture'}}),false);assert.equal(await h.get('/api/client-api'),false);assert.equal(h.stored.size,0);
});
test('private and no-store responses never cached',async()=>{
 for(const headers of [{'cache-control':'private, max-age=60'},{'cache-control':'public, no-store'},{vary:'*'},{'set-cookie':'fixture=1'}]){const h=harness(headers);await h.get('/asset');assert.equal(h.stored.size,0);}
});
test('public assets cached but request no-store bypasses worker',async()=>{
 const h=harness({'cache-control':'public, max-age=3600'});assert.equal(await h.get('/asset'),true);assert.equal(h.stored.size,1);assert.equal(await h.get('/fresh',{cache:'no-store'}),false);assert.equal(h.stored.size,1);
});
test('website and Sites worker source stay identical',()=>assert.equal(fs.readFileSync('web/public/sw.js','utf8'),fs.readFileSync('site-release/public/sw.js','utf8')));

test('activation removes only old hiking caches before claiming clients',async()=>{
 const events={},removed=[],sequence=[];
 const ctx={self:{addEventListener:(n,f)=>events[n]=f,clients:{claim:async()=>sequence.push('claim')}},caches:{keys:async()=>['hiking-earth-v024','hiking-earth-v025-client','other-app-cache'],delete:async k=>{removed.push(k);sequence.push('delete');}}};
 vm.runInNewContext(fs.readFileSync('web/public/sw.js','utf8'),ctx);
 let work;events.activate({waitUntil:p=>work=p});await work;
 assert.deepEqual(removed,['hiking-earth-v024']);assert.deepEqual(sequence,['delete','claim']);
});
test('failed shell install cannot activate incomplete offline cache',async()=>{
 const events={};let skipped=false;
 const ctx={self:{addEventListener:(n,f)=>events[n]=f,skipWaiting:()=>{skipped=true;}},caches:{open:async()=>({addAll:async()=>{throw new Error('offline shell download failed');}})}};
 vm.runInNewContext(fs.readFileSync('web/public/sw.js','utf8'),ctx);
 let work;events.install({waitUntil:p=>work=p});await assert.rejects(work,/offline shell download failed/);assert.equal(skipped,false);
});
