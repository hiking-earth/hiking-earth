const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const mod={exports:{}};
const source=fs.readFileSync(path.resolve(__dirname,'../../shared/types/route.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:mod.exports,module:mod,Date,Number});
const {isNavigable}=mod.exports;
const base={status:'开放中',trackMode:'已核验轨迹',path:[[100,30],[100.01,30.01]]};
test('opening permission requires finite unexpired evidence',()=>{
 for(const expiry of [undefined,NaN,Infinity,0,Date.now()-1])assert.equal(isNavigable({...base,openingExpiresAt:expiry}),false);
 assert.equal(isNavigable({...base,openingExpiresAt:Date.now()+10000}),true);
});
test('valid opening evidence cannot bypass closed or illustrative geometry',()=>{
 const route={...base,openingExpiresAt:Date.now()+10000};
 for(const status of ['待核验','临时关闭','永久关闭','即将开放'])assert.equal(isNavigable({...route,status}),false);
 for(const trackMode of ['认知示意','不展示轨迹',undefined])assert.equal(isNavigable({...route,trackMode}),false);
 assert.equal(isNavigable({...route,path:[]}),false);
});
