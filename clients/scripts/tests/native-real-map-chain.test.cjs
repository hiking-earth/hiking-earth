const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('../../app/node_modules/typescript');
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../app/src/services',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:name=>deps[name],ArrayBuffer,Uint8Array,setTimeout,clearTimeout});return exports;}
const ranges=load('basemap-file-reader.ts'),native=load('native-basemap-reader.ts',{'./basemap-file-reader':ranges}),local=load('local-basemap.ts',{pmtiles:require('../../app/node_modules/pmtiles')}),canvas=load('basemap-canvas.ts',{'@mapbox/vector-tile':require('../../app/node_modules/@mapbox/vector-tile'),pbf:require('../../app/node_modules/pbf')});
test('real repository map crosses native-style sliced base64 bridge into road geometry',async()=>{
 const bytes=fs.readFileSync(require('./helpers/real-map-fixture.cjs')('lantau'));let requests=[],closed=0;
 function file(buffer){return {size:buffer.length,close:()=>closed++,slice:(start,end)=>{requests.push({start,end});return {...file(buffer.subarray(start,end)),buffer:buffer.subarray(start,end)}}};}
 class Reader{readAsDataURL(part){this.result='data:application/octet-stream;base64,'+part.buffer.toString('base64');this.onload();}abort(){this.onabort?.();}}
 const io={FileReader:Reader,resolveLocalFileSystemURL:(p,ok)=>ok({file:ok=>ok(file(bytes))})};
 const read=native.nativeMapRangeReader(io,'_doc/lantau.pmtiles',bytes.length,b64=>Uint8Array.from(Buffer.from(b64,'base64')).buffer);
 const result=await local.openLocalBasemap('native-real',bytes.length,read),center=canvas.mapTileCenter(113.955,22.23,15),tile=await result.archive.getZxy(15,center.x,center.y);
 assert.ok(tile);const shapes=canvas.decodeMapShapes(tile.data);assert.ok(shapes.some(s=>s.layer==='roads'));assert.ok(requests.every(r=>r.end-r.start<=8*1024*1024));assert.equal(closed,requests.length*2);
});
