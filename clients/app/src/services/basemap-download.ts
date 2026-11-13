import {sha256} from '@noble/hashes/sha256';
import {PUBLIC_MAP_DISTRIBUTION} from './basemap-catalog';

export interface BasemapDownload {name:string;url:string;bytes:number;sha256:string}
export function validateBasemapDownload(value:BasemapDownload,origin:string):URL{
 if(!value||!/^[a-z0-9-]{1,80}\.pmtiles$/.test(value.name)||!Number.isSafeInteger(value.bytes)||value.bytes<127||value.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('地图下载清单无效');
 const base=new URL(origin),expected=new URL(`static/offline-maps/${value.name}`,base),url=new URL(value.url,base);
 if(value.url!==`static/offline-maps/${value.name}`||url.href!==expected.href||base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/'))throw new Error('地图下载地址不受支持');
 const localDesktop=(url.protocol==='tauri:'&&url.hostname==='localhost')||(url.protocol==='http:'&&url.hostname==='tauri.localhost');
 if(url.protocol!=='https:'&&!localDesktop&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('地图下载需要HTTPS');return url;
}
/** Downloads from our same-origin distribution only. Never hotlinks the planet. */
export async function downloadBasemap(value:BasemapDownload,origin:string,signal?:AbortSignal,onProgress?:(bytes:number)=>void):Promise<File>{
 const url=validateBasemapDownload(value,origin),controller=new AbortController();
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)controller.abort();const timeout=setTimeout(abort,120000);
 const hash=sha256.create();
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const response=await fetch(url.href,{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
  if(!response.ok||!response.body)throw new Error('地图下载失败');
  const length=response.headers.get('content-length');if(length!==null&&Number(length)!==value.bytes)throw new Error('地图大小与清单不一致');
  reader=response.body.getReader();const chunks:ArrayBuffer[]=[];let total=0;
  while(true){const next=await reader.read();if(next.done)break;const chunk=next.value;total+=chunk.byteLength;if(total>value.bytes)throw new Error('地图下载超过清单大小');hash.update(chunk);chunks.push(chunk.slice().buffer);onProgress?.(total);}
  if(total!==value.bytes)throw new Error('地图下载不完整');
  const blob=new Blob(chunks);
  if(controller.signal.aborted)throw new Error('地图下载已取消');
  const sha=Array.from(hash.digest(),(b:number)=>b.toString(16).padStart(2,'0')).join('');if(sha!==value.sha256)throw new Error('地图校验失败，未保存');
  return new File([blob],value.name,{type:'application/octet-stream'});
 }finally{hash.destroy();controller.abort();if(reader)await reader.cancel().catch(()=>{});clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}

export async function downloadDesktopBasemap(value:BasemapDownload,request:(name:string,bytes:number)=>Promise<ArrayBuffer>):Promise<File>{
 validateBasemapDownload(value,PUBLIC_MAP_DISTRIBUTION);
 const buffer=await request(value.name,value.bytes);
 if(Object.prototype.toString.call(buffer)!=='[object ArrayBuffer]'||buffer.byteLength!==value.bytes)throw new Error('地图大小与清单不一致');
 const digest=await crypto.subtle.digest('SHA-256',buffer);
 const sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(sha!==value.sha256)throw new Error('地图校验失败，未保存');
 return new File([buffer],value.name,{type:'application/octet-stream'});
}
