import {nativeMapRangeReader,type NativeMapIO} from './native-basemap-reader';
import type {SavedMapApi} from './wechat-basemap-store';
import type {MapDownloadApi} from './wechat-basemap-download';
type FileAPI=Pick<SavedMapApi,'getStorageSync'|'setStorageSync'|'saveFile'|'removeSavedFile'>&Pick<MapDownloadApi,'downloadFile'>;
/** Native bridge for existing bounded downloader and serialized inventory. */
export function createNativeMapApi(api:FileAPI,io:NativeMapIO,normalize:(path:string)=>string,decode:(value:string)=>ArrayBuffer):SavedMapApi&MapDownloadApi{
 const local=(path:string)=>{const p=normalize(path);if(typeof p!=='string'||!p.startsWith('_doc/')||p.split('/').includes('..')||/[\x00-\x1f?#]/.test(p))throw new Error('地图文件不在应用目录');return p;};
 function info(options:{filePath:string;success:(r:{size:number})=>void;fail:()=>void}){
  let ended=false;const finish=(size?:number)=>{if(ended)return;ended=true;clearTimeout(timer);if(size===undefined)options.fail();else options.success({size});};
  const timer=setTimeout(()=>finish(),15000);
  try{io.resolveLocalFileSystemURL(local(options.filePath),entry=>{if(ended)return;try{entry.file(file=>{try{const size=file.size;file.close();if(!Number.isSafeInteger(size)||size<127||size>64*1024*1024)finish();else finish(size);}catch{finish();}},()=>finish());}catch{finish();}},()=>finish());}catch{finish();}
 }
 const manager={getFileInfo:info,readFile(options:Parameters<ReturnType<MapDownloadApi['getFileSystemManager']>['readFile']>[0]){info({filePath:options.filePath,success:r=>{try{nativeMapRangeReader(io,local(options.filePath),r.size,decode)(options.position,options.length).then(data=>options.success({data}),()=>options.fail());}catch{options.fail();}},fail:options.fail});}};
 return {
  getStorageSync:key=>api.getStorageSync(key),setStorageSync:(key,value)=>api.setStorageSync(key,value),getFileSystemManager:()=>manager,getFileInfo:info,
  downloadFile:options=>api.downloadFile({...options,success:r=>{try{options.success({...r,tempFilePath:local(r.tempFilePath)});}catch{options.fail();}}}),
  saveFile:options=>{try{api.saveFile({...options,tempFilePath:local(options.tempFilePath),success:r=>{try{options.success({savedFilePath:local(r.savedFilePath)});}catch{options.fail();}}});}catch{options.fail();}},
  removeSavedFile:options=>{try{api.removeSavedFile({...options,filePath:local(options.filePath)});}catch{options.fail();}}
 };
}
