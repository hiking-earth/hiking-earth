const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'../../app');const dependency=n=>require(require.resolve(n,{paths:[app]}));
const tf=dependency('@tensorflow/tfjs-core');dependency('@tensorflow/tfjs-backend-cpu');
const coco=dependency('@tensorflow-models/coco-ssd'),jpeg=dependency('jpeg-js');
const {createCpuDetector}=require('../../shared/vision/cpu-detector.cjs');
const filename=process.argv[2];if(!filename)throw Error('Supply official coffee JPEG fixture path');
const bytes=fs.readFileSync(filename);assert.ok(bytes.length<=4*1024*1024);
const image=jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:24,maxMemoryUsageInMB:128});
const rgb=new Uint8Array(300*300*3);
for(let y=0;y<300;y++)for(let x=0;x<300;x++){const source=(Math.floor(y*image.height/300)*image.width+Math.floor(x*image.width/300))*4;const target=(y*300+x)*3;rgb.set(image.data.subarray(source,source+3),target);}
const detect=createCpuDetector({tf,coco,modelDirectory:path.resolve(__dirname,'../../shared/models/gear')});
(async()=>{const start=Date.now();const result=await detect(rgb);assert.ok(result.some(r=>r.class==='cup'&&r.score>=0.55));console.log(JSON.stringify({backend:tf.getBackend(),elapsedMs:Date.now()-start,predictions:result.map(r=>({class:r.class,score:r.score})),scope:'Real JPEG decoded and CPU model inference with local hash-verified weights; not deployed cloud or device acceptance.'}));})().catch(e=>{console.error(e.message);process.exitCode=1});
