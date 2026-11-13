import {sha256} from '@noble/hashes/sha256';
import type {LocalRangeReader} from './local-basemap';
/** Incremental SHA-256: one 256KiB read at a time, independent of Web Crypto. */
export async function verifyBasemapDigest(read:LocalRangeReader,bytes:number,expected:string,signal?:{aborted:boolean},progress?:(bytes:number)=>void){
 if(!Number.isSafeInteger(bytes)||bytes<127||bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(expected))throw new Error('地图校验信息无效');
 const hash=sha256.create();
 try{
  for(let offset=0;offset<bytes;){
   if(signal?.aborted)throw new Error('地图校验已取消');
   const count=Math.min(256*1024,bytes-offset),data=await read(offset,count);
   if(signal?.aborted)throw new Error('地图校验已取消');
   if(!(data instanceof ArrayBuffer)||data.byteLength!==count)throw new Error('地图文件读取不完整');
   hash.update(new Uint8Array(data));offset+=count;progress?.(offset);
  }
  const actual=Array.from(hash.digest() as Uint8Array,byte=>byte.toString(16).padStart(2,'0')).join('');
  if(signal?.aborted)throw new Error('地图校验已取消');
  if(actual!==expected)throw new Error('地图SHA-256校验失败，未保存');
 }finally{hash.destroy();}
}
