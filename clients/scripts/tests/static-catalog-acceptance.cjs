const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const ts=require('../../site-release/node_modules/typescript');
(async()=>{
 const root=path.resolve(__dirname,'../../site-release');
 const source=await fs.readFile(path.join(root,'data/static-catalog.ts'),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports',js)(exports);
 const original=global.fetch;let corrupt=false;
 global.fetch=async url=>{
  const relative=String(url);assert.ok(relative.startsWith('/route-catalog/'));assert.ok(!relative.includes('..'));
  let bytes=await fs.readFile(path.join(root,'public',relative));
  if(corrupt&&relative.endsWith('.gz'))bytes=Buffer.from('[]');
  return new Response(bytes);
 };
 try {
  const result=await exports.loadStaticPages('usfs');
  assert.equal(result.items.length,50089);assert.equal(result.metadata.complete,true);
  assert.equal(result.total,50089);assert.equal(new Set(result.items.map(x=>x.id)).size,50089);
  corrupt=true;await assert.rejects(exports.loadStaticPages('usfs'),/hash mismatch/);
  console.log(JSON.stringify({source:'usfs',records:50089,complete:true,unique:true,corruptPageRejected:true}));
 }finally{global.fetch=original;}
})().catch(e=>{console.error(e);process.exitCode=1});
