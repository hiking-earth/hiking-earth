import {verifyBasemapDigest} from './basemap-digest';
import {PUBLIC_MAP_DISTRIBUTION} from './basemap-catalog';
import {fileRangeReader,type BinaryFileManager} from './basemap-file-reader';
export type MapDownloadPack={name:string;url:string;bytes:number;sha256:string};
export interface MapDownloadApi{
 downloadFile(options:{url:string;timeout:number;success:(result:{statusCode:number;tempFilePath:string})=>void;fail:()=>void}):{abort():void;onProgressUpdate(callback:(event:{totalBytesWritten:number;totalBytesExpectedToWrite:number})=>void):void};
 getFileInfo(options:{filePath:string;success:(result:{size:number})=>void;fail:()=>void}):void;
 getFileSystemManager():BinaryFileManager;
}
const BASE=PUBLIC_MAP_DISTRIBUTION;
export async function downloadWechatBasemap(api:MapDownloadApi,pack:MapDownloadPack,progress?:(bytes:number,stage:'download'|'verify')=>void){
 if(!pack||!/^[a-z0-9-]{1,80}\.pmtiles$/.test(pack.name)||pack.url!==`static/offline-maps/${pack.name}`||!Number.isSafeInteger(pack.bytes)||pack.bytes<127||pack.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(pack.sha256))throw new Error('地图下载清单无效');
 const signal={aborted:false};let task:ReturnType<MapDownloadApi['downloadFile']>|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{signal.aborted=true;task?.abort();reject(new Error('地图下载或校验超时'));},120000);});
 try{return await Promise.race([deadline,(async()=>{
  const path=await new Promise<string>((resolve,reject)=>{
   task=api.downloadFile({url:BASE+pack.url,timeout:120000,success:r=>{if(signal.aborted)return reject(new Error('地图下载已取消'));if(r.statusCode!==200)return reject(new Error('地图服务暂时不可用'));resolve(r.tempFilePath);},fail:()=>reject(new Error('地图下载失败，请检查网络和微信下载域名设置'))});
   task.onProgressUpdate(r=>{if(!Number.isSafeInteger(r.totalBytesWritten)||r.totalBytesWritten<0||r.totalBytesWritten>pack.bytes||r.totalBytesExpectedToWrite>pack.bytes){signal.aborted=true;task?.abort();reject(new Error('下载地图超过声明大小'));return;}if(!signal.aborted)progress?.(r.totalBytesWritten,'download');});
  });
  const bytes=await new Promise<number>((resolve,reject)=>api.getFileInfo({filePath:path,success:r=>resolve(r.size),fail:()=>reject(new Error('地图文件信息读取失败'))}));
  if(bytes!==pack.bytes)throw new Error('下载地图大小不一致');
  await verifyBasemapDigest(fileRangeReader(api.getFileSystemManager(),path,bytes),bytes,pack.sha256,signal,n=>progress?.(n,'verify'));
  return {path,bytes};
 })()]);}finally{if(timer!==undefined)clearTimeout(timer);signal.aborted=true;task?.abort();}
}
