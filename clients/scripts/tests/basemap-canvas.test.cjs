const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../../app/node_modules/typescript');
function load(path,mapping){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,ArrayBuffer,Uint8Array,require:name=>mapping[name]});return exports;}
const canvas=load('app/src/services/basemap-canvas.ts',{'@mapbox/vector-tile':require('../../app/node_modules/@mapbox/vector-tile'),'pbf':require('../../app/node_modules/pbf')});
const local=load('app/src/services/local-basemap.ts',{'pmtiles':require('../../app/node_modules/pmtiles')});
test('tile centers reject invalid input and clamp world edges',()=>{assert.deepEqual(JSON.parse(JSON.stringify(canvas.mapTileCenter(180,0,15))),{x:32767,y:16384});for(const args of [[0,90,10],[0,0,16],[NaN,0,5]])assert.throws(()=>canvas.mapTileCenter(...args));});
test('tile decoder rejects invalid size and malformed protobuf',()=>{for(const b of [new ArrayBuffer(0),new ArrayBuffer(8*1024*1024+1),new Uint8Array([255,255]).buffer])assert.throws(()=>canvas.decodeMapShapes(b));});
test('real Lantau tile produces local roads without browser globals',async()=>{const b=fs.readFileSync(require('./helpers/real-map-fixture.cjs')('lantau'));const result=await local.openLocalBasemap('canvas',b.length,async(o,n)=>{const part=b.subarray(o,o+n);return part.buffer.slice(part.byteOffset,part.byteOffset+part.byteLength);});const c=canvas.mapTileCenter(113.955,22.23,15),tile=await result.archive.getZxy(15,c.x,c.y);assert.ok(tile);const shapes=canvas.decodeMapShapes(tile.data);assert.ok(shapes.some(s=>s.layer==='roads'));assert.ok(shapes.every(s=>s.paths.every(path=>path.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))));});
test('labels select local names and reject control-only or excessive names',()=>{
 const feature=(name,x=100,type=1)=>({type,properties:name,loadGeometry:()=>[[{x,y:100}]]});
 const features=[feature({'name:zh':'山顶',name:'Peak'}),feature({name:'\u0000'}),feature({name:'x'.repeat(65)}),feature({name:'Trail'},100,2)];
 const fake=load('app/src/services/basemap-canvas.ts',{'@mapbox/vector-tile':{VectorTile:class{constructor(){this.layers={places:{extent:4096,length:features.length,feature:i=>features[i]}}}}},pbf:{PbfReader:class{}}});
 const result=fake.decodeMapLabels(new Uint8Array([1]).buffer);assert.equal(result.length,1);assert.equal(result[0].text,'山顶');assert.equal(result[0].x,100/4096);
});
test('label placement prioritizes places, excludes clipped and duplicate text, and limits overlap',()=>{
 const labels=[{text:'POI',x:100,y:100,rank:30},{text:'Town',x:100,y:100,rank:1},{text:'Town',x:250,y:100,rank:1},{text:'Edge',x:0,y:10,rank:0},{text:'Other',x:200,y:160,rank:5}];
 const result=canvas.placeMapLabels(labels,300,320);assert.deepEqual(Array.from(result,x=>x.text),['Town','Other']);assert.equal(canvas.placeMapLabels(labels,NaN,320).length,0);
});
test('real Lantau tiles expose embedded point labels without network fonts',async()=>{
 const b=fs.readFileSync(require('./helpers/real-map-fixture.cjs')('lantau'));const result=await local.openLocalBasemap('labels',b.length,async(o,n)=>{const part=b.subarray(o,o+n);return part.buffer.slice(part.byteOffset,part.byteOffset+part.byteLength);});const c=canvas.mapTileCenter(113.955,22.23,15);let count=0;
 for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const tile=await result.archive.getZxy(15,c.x+dx,c.y+dy);if(tile)count+=canvas.decodeMapLabels(tile.data).length;}
 assert.ok(count>0,'Expected real embedded point names in the local Lantau map');
});
