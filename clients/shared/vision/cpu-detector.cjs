'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
/** Offline CPU runtime: caller supplies installed TFJS modules and verified local model directory. */
function createCpuDetector({tf,coco,modelDirectory}){
 let model,tail=Promise.resolve();
 const modelUrl='hiking-earth-local://gear/model.json';
 const source=JSON.parse(fs.readFileSync(path.join(modelDirectory,'source.json'),'utf8'));
 const buffers=new Map();
 for(const record of source.files){
  if(!/^(model\.json|group1-shard[1-5]of5)$/.test(record.name)||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>5*1024*1024)throw Error('Invalid local model manifest');
  const bytes=fs.readFileSync(path.join(modelDirectory,record.name));
  if(bytes.length!==record.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('Local model integrity check failed');
  if(buffers.has(record.name))throw Error('Duplicate model record');buffers.set(record.name,bytes);
 }
 if(buffers.size!==6||!buffers.has('model.json'))throw Error('Incomplete local model');
 const graph=JSON.parse(buffers.get('model.json').toString('utf8'));
 const specs=[],chunks=[];
 for(const group of graph.weightsManifest){
  specs.push(...group.weights);
  for(const name of group.paths){if(!buffers.has(name)||name==='model.json')throw Error('Unknown model shard');chunks.push(buffers.get(name));}
 }
 const weights=Buffer.concat(chunks);if(weights.length>20*1024*1024)throw Error('Model budget exceeded');
 tf.io.registerLoadRouter(url=>url===modelUrl?{load:async()=>({modelTopology:graph.modelTopology,weightSpecs:specs,weightData:weights.buffer.slice(weights.byteOffset,weights.byteOffset+weights.byteLength)})}:null);
 return async function detect(rgb){
  if(!(rgb instanceof Uint8Array)||rgb.length!==300*300*3)throw Error('Expected bounded 300x300 RGB image');
  const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;
  let input;
  try{
   if(!model){if(!await tf.setBackend('cpu'))throw Error('CPU backend unavailable');await tf.ready();model=await coco.load({base:'lite_mobilenet_v2',modelUrl});}
   input=tf.tensor3d(rgb,[300,300,3],'int32');
   return await model.detect(input,20,0.55);
  }finally{if(input)input.dispose();release();}
 };
}
module.exports={createCpuDetector};
