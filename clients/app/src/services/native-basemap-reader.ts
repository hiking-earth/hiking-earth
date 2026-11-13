import {fileRangeReader,type BinaryFileManager} from './basemap-file-reader';
import {OFFLINE_MAP_STORAGE_BUDGET_BYTES} from './offline-map-limits';
interface NativeFile {size:number;slice(start:number,end:number):NativeFile;close():void}
interface NativeReader {result:string|ArrayBuffer;onload:(()=>void)|null;onerror:(()=>void)|null;onabort:(()=>void)|null;readAsDataURL(file:NativeFile):void;readAsArrayBuffer(file:NativeFile):void;abort():void}
export interface NativeMapIO {
 resolveLocalFileSystemURL(path:string,success:(entry:{file(success:(file:NativeFile)=>void,fail:()=>void):void})=>void,fail:()=>void):void;
 FileReader:new()=>NativeReader;
}
export async function nativeArchiveSize(io:NativeMapIO,path:string):Promise<number>{
 return new Promise((resolve,reject)=>{try{io.resolveLocalFileSystemURL(path,entry=>entry.file(file=>{const size=file.size;try{file.close();}catch{}if(!Number.isSafeInteger(size)||size<22||size>OFFLINE_MAP_STORAGE_BUDGET_BYTES)reject(new Error('地图压缩包须小于192 MiB'));else resolve(size);},()=>reject(new Error('地图压缩包无法读取'))),()=>reject(new Error('地图压缩包无法读取')));}catch{reject(new Error('地图压缩包无法读取'));}});
}
export function readNativeArchiveChunk(io:NativeMapIO,path:string,offset:number,length:number):Promise<Uint8Array>{
 if(typeof path!=='string'||!path.startsWith('file:')||path.length>2048||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>1024*1024) return Promise.reject(new Error('地图压缩包读取范围无效'));
 return new Promise((resolve,reject)=>{let finished=false,reader:NativeReader|undefined,file:NativeFile|undefined,part:NativeFile|undefined;const clean=()=>{clearTimeout(timer);try{part?.close();}catch{}try{file?.close();}catch{}try{reader?.abort();}catch{}};const fail=()=>{if(finished)return;finished=true;clean();reject(new Error('地图压缩包读取失败'));};const timer=setTimeout(fail,20000);
  try{io.resolveLocalFileSystemURL(path,entry=>{if(finished)return;try{entry.file(value=>{if(finished){try{value.close();}catch{}return;}file=value;try{if(offset+length>value.size)throw new Error('range');part=value.slice(offset,offset+length);reader=new io.FileReader();reader.onerror=fail;reader.onabort=fail;reader.onload=()=>{if(finished)return;try{const data=reader!.result;if(!(data instanceof ArrayBuffer)||data.byteLength!==length)throw new Error('short');finished=true;clean();resolve(new Uint8Array(data));}catch{fail();}};reader.readAsArrayBuffer(part);}catch{fail();}},()=>fail());}catch{fail();}},()=>fail());}catch{fail();}
 });
}
/** HTML5+ range adapter; never reads the whole pack as base64. */
export function nativeMapRangeReader(io:NativeMapIO,path:string,bytes:number,decode:(base64:string)=>ArrayBuffer){
 if(!path.startsWith('_doc/')||path.split('/').includes('..'))throw new Error('地图必须保存在应用本机目录');
 const manager:BinaryFileManager={readFile(options){
  let ended=false,reader:NativeReader|undefined,file:NativeFile|undefined,part:NativeFile|undefined;
  const close=()=>{try{part?.close();}catch{}try{file?.close();}catch{}};
  const fail=()=>{if(ended)return;ended=true;clearTimeout(timer);try{reader?.abort();}catch{}close();options.fail();};
  const timer=setTimeout(fail,15000);
  try{io.resolveLocalFileSystemURL(path,entry=>{
   if(ended)return;
   try{entry.file(value=>{
    if(ended){try{value.close();}catch{}return;}file=value;
    try{
     if(value.size!==bytes)throw new Error('changed file');
     part=value.slice(options.position,options.position+options.length);reader=new io.FileReader();
     reader.onerror=fail;reader.onabort=fail;
     reader.onload=()=>{if(ended)return;try{
      const text=reader!.result,prefix=/^data:[^,\r\n]{0,120};base64,/;
      if(typeof text!=='string'||text.length>Math.ceil(options.length/3)*4+140||!prefix.test(text))throw new Error('invalid encoding');
      const encoded=text.replace(prefix,'');
      if(encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('invalid base64');
      const data=decode(encoded);if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!.call(data)!==options.length)throw new Error('incomplete');
      ended=true;clearTimeout(timer);close();options.success({data});
     }catch{fail();}};
     reader.readAsDataURL(part);
    }catch{fail();}
   },fail);}catch{fail();}
  },fail);}catch{fail();}
 }};
 return fileRangeReader(manager,path,bytes);
}
