const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('../../site-release/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../site-release/data/live-catalog.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('public catalog and reviews use direct verified gateway without account credentials',async()=>{
 const original=global.fetch,calls=[],exports={};
 const helpers=name=>{const output={};new Function('exports',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../site-release/data/'+name.slice(2)+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output);return output;};
 const requireStub=name=>['./catalog-limits','./discovery-tags'].includes(name)?helpers(name):name==='./routes'?{ROUTES:[]}:name==='./gateway-relay'?{needsGatewayRelay:()=>false}:{staticManifest:async()=>{throw new Error('offline static')}};
 new Function('require','exports',code)(requireStub,exports);
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api');
  assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,undefined);
  const request=JSON.parse(options.body);calls.push(request);
  if(request.action==='route-manage')return Response.json({ok:true,data:{items:[],hasMore:false}});
  assert.equal(request.data.windowLimit,250000);
  return Response.json({ok:true,data:{snapshot:'a'.repeat(64),key:'routes',total:1,page:0,hasMore:false,metadata:{generatedAt:new Date().toISOString()},items:[{id:request.data.source+'-1',name:'Example',center:[10,20],fetchedAt:new Date().toISOString(),sourceUrl:'https://example.org'}]}});
 };
 try{const rows=await exports.loadPublicRouteCatalog();assert.equal(rows.length,3);assert.ok(rows.every(x=>x.status==='待核验'&&x.path.length===0));assert.equal(calls.length,4);assert.match(exports.publicCatalogCoverageSummary(),/已读取0条/);}
 finally{global.fetch=original;}
});
