const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('../../app/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync('app/src/services/public-data.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const network={};new Function('exports',ts.transpileModule(fs.readFileSync('app/src/services/network-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(network);
function harness(request){const exports={},delays=[];new Function('require','exports','setTimeout',code)(name=>name==='./network-state'?network:{callCloud:request},exports,(done,ms)=>{delays.push(ms);done();});return {...exports,delays};}
const hash='a'.repeat(64);
const page=n=>({ok:true,data:{snapshot:hash,key:'routes',total:401,metadata:{schemaVersion:1},items:Array(n===0?400:1).fill({id:'fixture'}),hasMore:n===0,page:n}});
test('transient second page retries same pinned snapshot',async()=>{const calls=[];let failures=0;const h=harness(async(name,data)=>{calls.push(data);return data.page===1&&failures++===0?{ok:false}:page(data.page);});const v=await h.publicSnapshot('osm');assert.equal(v.routes.length,401);assert.deepEqual(h.delays,[1000]);assert.equal(calls.length,3);assert.equal(calls[1].snapshot,hash);assert.deepEqual(calls[2],calls[1]);});
test('persistent request failures stop at three attempts',async()=>{let count=0;const h=harness(async()=>{count++;throw Error('transport');});await assert.rejects(h.publicSnapshot('hk'));assert.equal(count,3);assert.deepEqual(h.delays,[1000,2000]);});
test('successful malformed response is rejected without retries',async()=>{let count=0;const h=harness(async()=>{count++;return {ok:true,data:{...page(0).data,page:1}};});await assert.rejects(h.publicSnapshot('osm'));assert.equal(count,1);assert.deepEqual(h.delays,[]);});

test('known rate limit stops without immediate retries',async()=>{let count=0;const h=harness(async()=>{count++;return {ok:false,errMsg:'操作过于频繁，请稍后重试'};});await assert.rejects(h.publicSnapshot('osm'));assert.equal(count,1);assert.deepEqual(h.delays,[]);});
