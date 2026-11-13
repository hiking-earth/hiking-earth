const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../app');
test('real SSR rejects CR attribute names but renders safe attributes',()=>{
 const {ssrRenderAttrs}=require(path.join(root,'node_modules/@vue/server-renderer'));
 const oldWarn=console.warn,oldError=console.error;console.warn=console.error=()=>{};
 try{assert.equal(ssrRenderAttrs({id:'safe',['x\rautofocus\ronfocus']:'alert(1)'}),' id="safe"');assert.equal(ssrRenderAttrs({title:'a<b'}),' title="a&lt;b"');}finally{console.warn=oldWarn;console.error=oldError;}
});
test('backport is repeatable and rejects changed bytes before writing',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hiking-ssr-patch-'));
 try{
  fs.cpSync(path.join(root,'node_modules/@vue/shared'),path.join(tmp,'node_modules/@vue/shared'),{recursive:true});fs.mkdirSync(path.join(tmp,'scripts'));
  for(const n of ['patch-vue-ssr.cjs','vue-ssr-patch.json'])fs.copyFileSync(path.join(root,'scripts',n),path.join(tmp,'scripts',n));
  const run=()=>spawnSync(process.execPath,[path.join(tmp,'scripts/patch-vue-ssr.cjs')],{encoding:'utf8'});
  assert.equal(run().status,0);assert.equal(run().status,0);
  const target=path.join(tmp,'node_modules/@vue/shared/dist/shared.cjs.js');fs.appendFileSync(target,'\n//unexpected');const changed=fs.readFileSync(target,'utf8');
  assert.notEqual(run().status,0);assert.equal(fs.readFileSync(target,'utf8'),changed);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
