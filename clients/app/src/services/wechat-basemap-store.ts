import {isLocalMapPath} from './basemap-file-reader';
import {OFFLINE_MAP_STORAGE_BUDGET_BYTES} from './offline-map-limits';
export type WechatMapPack={id:string;name:string;path:string;bytes:number;savedAt:number};
export type WechatMapView=WechatMapPack&{available:boolean;issue:string};
class MapFileError extends Error{constructor(message:string,readonly missing:boolean){super(message);}}
function fileMissing(error?:{errMsg?:string}){return typeof error?.errMsg==='string'&&/(?:ENOENT|no such file|file (?:not exist|does not exist))/i.test(error.errMsg);}
export interface SavedMapApi{
 getStorageSync(key:string):unknown;setStorageSync(key:string,value:unknown):void;
 getFileSystemManager():{getFileInfo(options:{filePath:string;success:(value:{size:number})=>void;fail:(error?:{errMsg?:string})=>void}):void};
 saveFile(options:{tempFilePath:string;success:(value:{savedFilePath:string})=>void;fail:(error?:{errMsg?:string})=>void}):void;
 removeSavedFile(options:{filePath:string;success:()=>void;fail:(error?:{errMsg?:string})=>void}):void;
}
const KEY='he_wechat_basemaps_v1',MAX_PACK=64*1024*1024,BUDGET=OFFLINE_MAP_STORAGE_BUDGET_BYTES;
export function validateWechatMapInventory(value:unknown):WechatMapPack[]{
 if(value===undefined||value===null||value==='')return [];
 if(!Array.isArray(value)||value.length>128)throw new Error('本机地图目录损坏，请保留原包');
 let total=0;const ids=new Set<string>(),paths=new Set<string>();
 for(const row of value){if(!row||typeof row!=='object'||!/^wm-[a-z0-9-]{1,80}$/.test(row.id)||ids.has(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>120||typeof row.path!=='string'||!isLocalMapPath(row.path)||paths.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<127||row.bytes>MAX_PACK||!Number.isSafeInteger(row.savedAt)||row.savedAt<1)throw new Error('本机地图目录损坏，请保留原包');ids.add(row.id);paths.add(row.path);total+=row.bytes;}
 if(total>BUDGET)throw new Error('本机地图容量超过192 MiB');return value.map(row=>({...row}));
}
const platformTails=new Map<'wechat'|'native',Promise<unknown>>();
export function createWechatMapStore(api:SavedMapApi,validateFile:(path:string,bytes:number)=>Promise<unknown>,platform:'wechat'|'native'='wechat',kind:'basemaps'|'terrain'='basemaps'){
 const storageKey=`he_${platform}_${kind}_v1`;
 const peerKey=`he_${platform}_${kind==='terrain'?'basemaps':'terrain'}_v1`;
 // Serialize both stores on the same platform, so parallel imports share quota.
 function serial<T>(work:()=>Promise<T>):Promise<T>{const result=(platformTails.get(platform)||Promise.resolve()).then(work);platformTails.set(platform,result.catch(()=>{}));return result;}
 const inventory=()=>validateWechatMapInventory(api.getStorageSync(storageKey));
 const size=(path:string)=>new Promise<number>((resolve,reject)=>api.getFileSystemManager().getFileInfo({filePath:path,success:r=>resolve(r.size),fail:error=>reject(new MapFileError('已保存地图文件不存在或无法读取',fileMissing(error)))}));
 const unlink=(path:string)=>new Promise<void>((resolve,reject)=>api.removeSavedFile({filePath:path,success:resolve,fail:error=>reject(new MapFileError('未能删除地图文件',fileMissing(error)))}));
 return {
 find:(name:string,bytes:number)=>serial(async()=>{const row=inventory().find(r=>r.name===name&&r.bytes===bytes);if(!row)return null;if(await size(row.path)!==row.bytes)throw new Error('已存地图大小变化，请保留原包');return {...row};}),
 list:()=>serial(async()=>{const views:WechatMapView[]=[];for(const row of inventory()){let issue='';try{if(await size(row.path)!==row.bytes)issue='文件大小变化，请保留原包';}catch(error){issue=error instanceof MapFileError&&error.missing?'文件已被清理，可删除目录记录后重新下载':'文件暂时无法读取，请保留原包';}views.push({...row,available:!issue,issue});}return views;}),
 save:(path:string,bytes:number,name:string)=>serial(async()=>{
  if(typeof name!=='string'||!name.trim()||name.length>120||!Number.isSafeInteger(bytes)||bytes<127||bytes>MAX_PACK)throw new Error('地图包无效或超过64 MiB');
  const rows=inventory(),peers=validateWechatMapInventory(api.getStorageSync(peerKey));if(kind==='terrain'&&bytes>33*1024*1024)throw new Error('地形包超过33 MiB');if(rows.length>=128||rows.reduce((n,r)=>n+r.bytes,0)+peers.reduce((n,r)=>n+r.bytes,0)+bytes>BUDGET)throw new Error('本机地图已满，请先删除不使用的地图包');
  await validateFile(path,bytes);
  const saved=await new Promise<string>((resolve,reject)=>api.saveFile({tempFilePath:path,success:r=>resolve(r.savedFilePath),fail:()=>reject(new Error(platform==='native'?'地图保存失败，请检查设备存储空间':'地图保存失败，可能已达到微信文件空间限制'))}));
  if([...rows,...peers].some(row=>row.path===saved))throw new Error('地图保存路径与已有文件冲突，请保留原包');
  if(!isLocalMapPath(saved)){
   // saveFile has already created a platform-managed file. If the platform
   // returns an unsafe path, try to remove that exact returned file instead
   // of leaving an untracked orphan. Never remove a path already in inventory.
   if(saved.length===0||saved.length>1024)throw new Error('地图保存路径无效，无法安全确认残留文件状态；请保留原包并检查设备存储空间');
   try{await unlink(saved);}
   catch{throw new Error('地图保存路径无效，残留文件未能清理；请保留原包并检查设备存储空间');}
   throw new Error('地图保存路径无效，已清理未登记文件，请保留原包');
  }
  try{if(await size(saved)!==bytes)throw new Error('保存后的地图大小不一致');await validateFile(saved,bytes);
   const row={id:`wm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,name:name.trim(),path:saved,bytes,savedAt:Date.now()};
   const next=validateWechatMapInventory([...rows,row]);api.setStorageSync(storageKey,next);return row;
  }catch(error){try{await unlink(saved);}catch{throw new Error('地图保存未完成，残留文件未能清理；请保留原包并检查设备存储空间');}throw error;}
 }),
 remove:(id:string)=>serial(async()=>{const rows=inventory(),row=rows.find(r=>r.id===id);if(!row)throw new Error('地图不在本机目录中');
  // Commit inventory before deleting bytes; restore it if filesystem removal fails.
  api.setStorageSync(storageKey,rows.filter(r=>r.id!==id));
  try{await unlink(row.path);}catch(error){if(error instanceof MapFileError&&error.missing)return;try{api.setStorageSync(storageKey,rows);}catch{throw new Error('文件未删除且目录恢复失败，请保留原包并检查设备存储空间');}throw error;}
 })
 };
}
