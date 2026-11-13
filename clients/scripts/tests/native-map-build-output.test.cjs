const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('native map generator writes only the platform-specific asset source',()=>{const source=fs.readFileSync('app/scripts/build-map-viewer.cjs','utf8');assert.match(source,/path\.join\(root,'native-assets\/static\/native-map'\)/);assert.doesNotMatch(source,/path\.join\(root,'src\/static\/native-map'\)/);});
test('platform build hook excludes native renderer from mini-program and H5',()=>{const source=fs.readFileSync('app/vite.config.ts','utf8');assert.match(source,/platform !== 'h5' && platform !== 'app' && platform !== 'app-plus'/);assert.match(source,/isNative \? 'native-assets\/static\/native-map' : 'map-assets\/static\/offline-maps'/);});
test('mini-program hook actually removes stale native output and keeps other static files',()=>{
 const path=require('node:path'),vm=require('node:vm'),ts=require('../../app/node_modules/typescript'),app=path.resolve('app'),output=fs.mkdtempSync(path.join(app,'dist/native-prune-test-'));
 try{fs.mkdirSync(path.join(output,'static/native-map'),{recursive:true});fs.writeFileSync(path.join(output,'static/native-map/viewer.html'),'stale');fs.writeFileSync(path.join(output,'static/keep.txt'),'keep');
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/vite.config.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,__dirname:app,process:{env:{UNI_PLATFORM:'mp-weixin',UNI_OUTPUT_DIR:output}},require:n=>n==='vite'?{defineConfig:x=>x}:n==='@dcloudio/vite-plugin-uni'?()=>({}):require(n)});
  exports.default.plugins.find(p=>p.name==='hiking-h5-map-assets').closeBundle();assert.equal(fs.existsSync(path.join(output,'static/native-map')),false);assert.equal(fs.readFileSync(path.join(output,'static/keep.txt'),'utf8'),'keep');
 }finally{fs.rmSync(output,{recursive:true,force:true});}
});
