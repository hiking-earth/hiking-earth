const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const file of ['app/cloudfunctions/catalog-feed/index.js','app/cloudfunctions/client-api/business/catalog-feed/index.js'])test(file+' logs safe source, stage and allowlisted error code only',async()=>{
 const warnings=[],exports={};
 let fileReads=0;
 const requireStub=name=>name==='fs'?{readFileSync(){fileReads++;throw Object.assign(Error('private file path and credential'),{code:fileReads===1?'ENOENT':'EACCES'});}}:require(name);
 const manifest={schemaVersion:1,key:'routes',snapshot:'a'.repeat(64),total:0,pageSize:400,pages:['b'.repeat(64)],indexHash:'c'.repeat(64),metadata:{schemaVersion:1,generatedAt:'2026-01-01T00:00:00Z'}};
 const fetch=async url=>url.endsWith('/manifest.json')?{ok:true,headers:{get:()=>null},body:[Buffer.from(JSON.stringify(manifest))]}:Promise.reject(Error('private request details'));
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:requireStub,exports,__dirname:'/private',Buffer,AbortSignal,fetch,console:{warn:value=>warnings.push(value)}});
 const response=await exports.main({source:'hk',page:0,query:'private input',token:'private token'});
 assert.equal(response.errMsg,'资料暂时不可用，请保留上次成功同步的数据并稍后重试');
 assert.equal(warnings.length,1);assert.deepEqual(JSON.parse(warnings[0]),{event:'catalog-read-failed',source:'hk',stage:'page',errorCode:'EACCES'});
 assert.doesNotMatch(JSON.stringify(response)+warnings.join(''),/private/);
});
