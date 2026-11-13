const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
function harness(invoke){
  const timers=new Map();let now=100000,id=0;
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/desktop-location.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const context={exports,require:()=>({isDesktop:()=>true}),Date:class extends Date{static now(){return now;}},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(code,context);
  const points=[],errors=[],calls=[];
  const stop=exports.watchSystemLocation((name,args)=>{calls.push({name,args});return invoke(name,args);},p=>points.push(p),m=>errors.push(m));
  return {stop,points,errors,calls,timers,advance(ms){now+=ms;},tick(){const [key,fn]=timers.entries().next().value;timers.delete(key);return fn();}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('cancel during native start stops again on late completion without reading a fix',async()=>{
  let finish;const h=harness(name=>name.endsWith('start')?new Promise(r=>finish=r):Promise.resolve());
  h.stop();finish();await settle();
  assert.equal(h.calls.filter(c=>c.name.endsWith('read')).length,0);
  assert.equal(h.calls.filter(c=>c.name.endsWith('stop')).length,2);
  assert.equal(h.points.length,0);assert.equal(h.timers.size,0);
});
test('native denial is an error and stops the provider without a fabricated position',async()=>{
  const h=harness(name=>Promise.resolve(name.endsWith('read')?{point:null,error:'系统定位未授权'}:undefined));
  await settle();assert.deepEqual(h.errors,['系统定位未授权']);assert.equal(h.points.length,0);assert.equal(h.timers.size,0);
  assert.ok(h.calls.some(c=>c.name.endsWith('stop')));
});
test('stale or invalid coordinates do not start recording; no fix times out',async()=>{
  const h=harness(name=>Promise.resolve(name.endsWith('read')?{point:{latitude:35,longitude:120,timestamp:1},error:null}:undefined));
  await settle();assert.equal(h.points.length,0);h.advance(31000);await h.tick();
  assert.equal(h.errors.length,1);assert.match(h.errors[0],/超时/);assert.equal(h.points.length,0);
});
test('a late native response after stop cannot deliver coordinates',async()=>{
  let finish;const h=harness(name=>name.endsWith('read')?new Promise(r=>finish=r):Promise.resolve());
  await settle();h.stop();finish({point:{latitude:35,longitude:120,timestamp:100000},error:null});await settle();
  assert.equal(h.points.length,0);assert.equal(h.timers.size,0);assert.equal(h.errors.length,0);
});
test('native timestamps survive and duplicate fixes are not recorded twice',async()=>{
  const p={latitude:35,longitude:120,timestamp:99900,accuracy:null};
  const h=harness(name=>Promise.resolve(name.endsWith('read')?{point:p,error:null}:undefined));
  await settle();assert.equal(h.points.length,1);assert.equal(h.points[0].timestamp,99900);
  await h.tick();assert.equal(h.points.length,1);h.advance(61000);await h.tick();
  assert.equal(h.errors.length,1);assert.equal(h.timers.size,0);
});
