const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('../../app/node_modules/typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('app/src/components/globe-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(out);
const bounds={left:40,top:100};
test('browser touch start and end share canvas-local coordinates',()=>{
 assert.deepEqual(out.globePoint({touches:[{clientX:120,clientY:180}]},bounds),{x:80,y:80});
 assert.deepEqual(out.globePoint({changedTouches:[{clientX:120,clientY:180}]},bounds,true),{x:80,y:80});
});
test('platform local touches and mouse offsets preserve zero coordinates',()=>{
 assert.deepEqual(out.globePoint({touches:[{x:0,y:20,clientX:90,clientY:150}]},bounds),{x:0,y:20});
 assert.deepEqual(out.globePoint({x:120,y:180,clientX:120,clientY:180,offsetX:0,offsetY:20},bounds),{x:0,y:20});
 assert.deepEqual(out.globePoint({clientX:120,clientY:180},bounds),{x:80,y:80});
});
test('invalid or absent coordinates cannot generate a selection or rotation',()=>{
 for(const e of [{},{touches:[{}]},{offsetX:NaN,offsetY:Infinity},{changedTouches:[{clientX:NaN,clientY:20}]}])assert.equal(out.globePoint(e,bounds,true),null);
});
