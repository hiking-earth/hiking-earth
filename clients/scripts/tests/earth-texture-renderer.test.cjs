const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('../../app/node_modules/typescript');
const texture=require('../../app/src/components/earth-texture.json'),designPalette=require('../../shared/design/palette.json'),out={};
const asset=(name)=>({default:name.includes('palette.json')?designPalette:texture});
new Function('exports','require',ts.transpileModule(fs.readFileSync('app/src/components/earth-texture-renderer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(out,asset);
test('NASA texture is complete and indexed colors bounded',()=>{assert.equal(Buffer.from(texture.indices,'base64').length,texture.width*texture.height);assert.equal(texture.palette.length,768);assert.ok(texture.palette.every(v=>Number.isInteger(v)&&v>=0&&v<=255));});
test('sphere alpha, rotation and geographic wrap remain correct',()=>{const a=out.renderEarth(64,100,22),b=out.renderEarth(64,-80,22),wrap=out.renderEarth(64,460,22);assert.equal(a.length,64*64*4);assert.equal(a[3],0);assert.equal(a[(32*64+32)*4+3],255);assert.notDeepEqual(a,b);assert.deepEqual(a,wrap);});
test('native base64 decoder produces the same satellite sphere',()=>{
 const native={};let calls=0;
 const uni={base64ToArrayBuffer(value){calls++;const b=Buffer.from(value,'base64');return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}};
 new Function('exports','require','uni',ts.transpileModule(fs.readFileSync('app/src/components/earth-texture-renderer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(native,asset,uni);
 assert.equal(calls,1);assert.deepEqual(native.renderEarth(64,100,22),out.renderEarth(64,100,22));
});
