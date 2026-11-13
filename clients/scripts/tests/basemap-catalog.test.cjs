const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('../../app/node_modules/typescript');
let offline=false,requests=0;const out={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/src/services/basemap-catalog.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:out,require:()=>({browserReportsOffline:()=>offline}),uni:{request(){requests++;}}});
const row={name:'test.pmtiles',label:'Test',url:'static/offline-maps/test.pmtiles',bytes:127,sha256:'a'.repeat(64),attribution:'OSM',license:'ODbL-1.0 Produced Work'};
test('catalog rejects duplicate names, external URLs and missing rights',()=>{for(const rows of [[],[row,row],[{...row,url:'https://other/map'}],[{...row,attribution:''}],[{...row,bytes:NaN}]])assert.throws(()=>out.validateMapCatalog(rows));});
test('success refresh coalesces and keeps independent snapshots',async()=>{let calls=0;const store=out.createMapCatalog([row],async()=>{calls++;return JSON.stringify([{...row,label:'New'}]);});const [a,b]=await Promise.all([store.refresh(),store.refresh()]);assert.equal(calls,1);assert.equal(a[0].label,'New');a[0].label='Changed';assert.equal(b[0].label,'New');await store.refresh();assert.equal(calls,1);});
test('failed refresh preserves seed and uses retry cooldown',async()=>{let now=100,calls=0;const store=out.createMapCatalog([row],async()=>{calls++;throw Error('offline');},()=>now);await assert.rejects(store.refresh());assert.equal(store.snapshot()[0].label,'Test');await store.refresh();assert.equal(calls,1);now+=60001;await assert.rejects(store.refresh());assert.equal(calls,2);});
test('synchronous adapter failure does not leave a stuck pending promise',async()=>{let now=100,calls=0;const store=out.createMapCatalog([row],()=>{calls++;throw Error('sync');},()=>now);await assert.rejects(store.refresh());now+=60001;await assert.rejects(store.refresh());assert.equal(calls,2);});
test('malformed or oversized remote response never replaces catalog',async()=>{for(const text of ['{}','x'.repeat(256*1024+1)]){const store=out.createMapCatalog([row],async()=>text);await assert.rejects(store.refresh());assert.equal(store.snapshot()[0].name,'test.pmtiles');}});

test('desktop uses fixed public distribution and browser keeps local base',()=>{assert.equal(out.mapDistributionBase(true,'tauri://localhost/'),out.PUBLIC_MAP_DISTRIBUTION);assert.equal(out.mapDistributionBase(false,'https://example.test/client-app/'),'https://example.test/client-app/');});
test('optional bounds reject malformed geometry and preserve independent snapshots',()=>{
 for(const bounds of [[0,0,0,1],[-181,0,1,1],[0,-86,1,1],[0,0,Infinity,1],'bad'])assert.throws(()=>out.validateMapCatalog([{...row,bounds}]));
 const store=out.createMapCatalog([{...row,bounds:[0,0,1,1]}],async()=>JSON.stringify([row]));const a=store.snapshot();a[0].bounds[0]=0.5;assert.equal(store.snapshot()[0].bounds[0],0);
});
test('location selection uses declared coverage and never implies coverage of unknown bounds',()=>{
 const packs=out.validateMapCatalog([row,{...row,name:'covered.pmtiles',url:'static/offline-maps/covered.pmtiles',bounds:[113,22,114,23]}]);
 assert.equal(out.mapsCoveringLocation(packs,22.5,113.5).length,1);assert.equal(out.mapsCoveringLocation(packs,0,0).length,0);
 for(const args of [[NaN,0],[91,0],[0,181]])assert.throws(()=>out.mapsCoveringLocation(packs,...args));
});
test('older catalog preserves verified bounds only for identical pack bytes',async()=>{
 for(const changed of [false,true]){const store=out.createMapCatalog([{...row,bounds:[0,0,1,1]}],async()=>JSON.stringify([{...row,sha256:changed?'b'.repeat(64):row.sha256}]));const packs=await store.refresh();assert.equal(Boolean(packs[0].bounds),!changed);}
});

test('explicitly offline map catalog does not issue a request',async()=>{offline=true;try{await assert.rejects(out.requestMapCatalog('https://example.com/client-app/'),/离线/);assert.equal(requests,0);}finally{offline=false;}});
