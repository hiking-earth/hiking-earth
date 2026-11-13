/** Binary range access for callback-based native file managers. No text/base64 conversion. */
export interface BinaryFileManager {
 readFile(options:{filePath:string;position:number;length:number;success:(result:{data:unknown})=>void;fail:()=>void}):void;
}
export function isLocalMapPath(path:unknown):boolean{
 return typeof path==='string'&&path.length>0&&path.length<=1024&&!/[\x00-\x1f?#]/.test(path)&&!path.split('/').includes('..')&&(!/^https?:\/\//i.test(path)||/^http:\/\/(?:usr|tmp|store)\//.test(path));
}
export function fileRangeReader(manager:BinaryFileManager,filePath:string,bytes:number){
 if(!isLocalMapPath(filePath)||!Number.isSafeInteger(bytes)||bytes<127||bytes>64*1024*1024)throw new Error('本机地图文件无效');
 return (offset:number,length:number):Promise<ArrayBuffer>=>new Promise((resolve,reject)=>{
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||offset>=bytes||length<1||length>8*1024*1024){reject(new Error('地图读取范围无效'));return;}
  const count=Math.min(length,bytes-offset);
  try{manager.readFile({filePath,position:offset,length:count,success:result=>{
   try{
    // The WeChat bridge can return an ArrayBuffer from another JS realm.
    // Use the intrinsic brand check; byteLength alone could accept a fake object.
    const actual=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!.call(result.data);
    if(actual!==count)throw new Error('size');
    const data=result.data instanceof ArrayBuffer?result.data:new Uint8Array(result.data as ArrayBuffer).slice().buffer;
    resolve(data);
   }catch{reject(new Error('地图文件读取不完整'));}

  },fail:()=>reject(new Error('本机地图文件读取失败'))});}catch{reject(new Error('本机地图文件读取失败'));}
 });
}
