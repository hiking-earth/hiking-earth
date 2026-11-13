declare const wx: any;
import {readChunkedCatalog,writeChunkedCatalog} from './catalog-file-chunks';
/** Public catalog cache: large source records must not occupy key/value storage.
 * Native / WeChat use two private file slots and a small committed pointer;
 * H5 and bundled desktop use one atomic IndexedDB transaction per source.
 * The previous successful slot is kept until its replacement is committed.
 */
export type CatalogSource='osm'|'usfs'|'hk'|'nzdoc'|'parkscanada'|'nsw-npws'|'england'|'wales'|'japan-tokai'|'scotland-argyll'|'ni-midulster'|'norfolk-prow'|'cambridgeshire-prow'|'nps-public-trails'|'usgs-trails'|'victoria-recreation-tracks'|'queensland-qpws-trails'|'taiwan-trails'|'korea-durunubi-trails';
export type LocalDataSource=CatalogSource|'offline';
const LEGACY:Record<LocalDataSource,string>={osm:'hiking-route-catalog-v1',usfs:'hiking-route-catalog-v1-usfs',hk:'hiking-route-catalog-v1-hk',nzdoc:'hiking-route-catalog-v1-nzdoc',parkscanada:'hiking-route-catalog-v1-parkscanada','nsw-npws':'hiking-route-catalog-v1-nsw-npws',england:'hiking-route-catalog-v1-england',wales:'hiking-route-catalog-v1-wales','japan-tokai':'hiking-route-catalog-v1-japan-tokai','scotland-argyll':'hiking-route-catalog-v1-scotland-argyll','ni-midulster':'hiking-route-catalog-v1-ni-midulster','norfolk-prow':'hiking-route-catalog-v1-norfolk-prow','cambridgeshire-prow':'hiking-route-catalog-v1-cambridgeshire-prow','nps-public-trails':'hiking-route-catalog-v1-nps-public-trails','usgs-trails':'hiking-route-catalog-v1-usgs-trails','victoria-recreation-tracks':'hiking-route-catalog-v1-victoria-recreation-tracks','queensland-qpws-trails':'hiking-route-catalog-v1-queensland-qpws-trails','taiwan-trails':'hiking-route-catalog-v1-taiwan-trails','korea-durunubi-trails':'hiking-route-catalog-v1-korea-durunubi-trails',offline:'he_offline_vectors_v1'};
const pointerKey=(source:LocalDataSource)=>`he_catalog_file_slot_v1_${source}`;
const selectedSlots=new Map<LocalDataSource,number>();
const filename=(source:LocalDataSource,slot:number)=>`he-catalog-${source}-${slot}.json`;
const utf8Size=(text:string)=>encodeURIComponent(text).replace(/%[A-F\d]{2}|./g,'x').length;
// #ifdef H5
let database:Promise<IDBDatabase>|undefined;
function openDatabase():Promise<IDBDatabase>{
 if(database)return database;
 database=new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('浏览器不支持离线目录数据库'));return;}
  const request=indexedDB.open('hiking-earth-public-catalog',1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('catalogs'))request.result.createObjectStore('catalogs');};
  request.onerror=()=>reject(new Error('无法打开离线目录数据库'));
  request.onblocked=()=>reject(new Error('离线目录数据库被其他窗口占用'));
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=undefined;};resolve(db);};
 }).catch(error=>{database=undefined;throw error;});
 return database;
}
async function browserRead(source:LocalDataSource):Promise<unknown>{
 const db=await openDatabase();return new Promise((resolve,reject)=>{
  const transaction=db.transaction('catalogs','readonly'),request=transaction.objectStore('catalogs').get(source);
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('离线目录读取失败'));
 });
}
async function browserWrite(source:LocalDataSource,value:unknown):Promise<void>{
 const db=await openDatabase();return new Promise((resolve,reject)=>{
  const transaction=db.transaction('catalogs','readwrite');
  transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(new Error('离线目录保存失败，可能空间不足'));transaction.onabort=()=>reject(new Error('离线目录保存中断'));
  transaction.objectStore('catalogs').put(value,source);
 });
}
// #endif
// #ifdef APP-PLUS
function nativeEntry(name:string,create:boolean):Promise<any>{
 return new Promise((resolve,reject)=>{
  plus.io.requestFileSystem(plus.io.PRIVATE_DOC,(filesystem:any)=>filesystem.root.getFile(name,{create},resolve,reject),reject);
 });
}
async function nativeRead(name:string):Promise<string>{
 const entry=await nativeEntry(name,false);
 return new Promise((resolve,reject)=>entry.file((file:any)=>{
  if(file.size>24*1024*1024){reject(new Error('离线目录文件过大'));return;}
  const reader=new plus.io.FileReader();reader.onloadend=(event:any)=>resolve(String(event.target.result));reader.onerror=reject;reader.readAsText(file,'utf-8');
 },reject));
}
async function nativeWrite(name:string,text:string):Promise<void>{
 const entry=await nativeEntry(name,true);
 await new Promise<void>((resolve,reject)=>entry.createWriter((writer:any)=>{
  let truncated=false;
  writer.onerror=reject;writer.onabort=()=>reject(new Error('目录写入中断'));
  writer.onwrite=()=>{if(!truncated){truncated=true;writer.seek(0);writer.write(text);}else resolve();};
  // A reused slot may contain a longer old snapshot.
  writer.truncate(0);
 },reject));
}
// #endif
// #ifdef MP-WEIXIN
function miniPath(name:string):string{return `${wx.env.USER_DATA_PATH}/${name}`;}
function miniRead(name:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const manager=wx.getFileSystemManager(),filePath=miniPath(name);
  manager.stat({path:filePath,success:(result:any)=>{
   if(result.stats.size>24*1024*1024){reject(new Error('离线目录文件过大'));return;}
   manager.readFile({filePath,encoding:'utf8',success:(value:any)=>resolve(String(value.data)),fail:reject});
  },fail:reject});
 });
}
function miniWrite(name:string,text:string):Promise<void>{
 return new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:miniPath(name),data:text,encoding:'utf8',success:()=>resolve(),fail:()=>reject(new Error('离线目录文件保存失败，请检查设备空间'))}));
}
// #endif
async function fileRead(name:string):Promise<string>{
 // #ifdef APP-PLUS
 return nativeRead(name);
 // #endif
 // #ifdef MP-WEIXIN
 return miniRead(name);
 // #endif
 // #ifndef APP-PLUS
 // #ifndef MP-WEIXIN
 throw new Error('当前平台未配置目录文件缓存');
 // #endif
 // #endif
}
async function fileWrite(name:string,text:string):Promise<void>{
 // #ifdef APP-PLUS
 return nativeWrite(name,text);
 // #endif
 // #ifdef MP-WEIXIN
 return miniWrite(name,text);
 // #endif
 // #ifndef APP-PLUS
 // #ifndef MP-WEIXIN
 throw new Error('当前平台未配置目录文件缓存');
 // #endif
 // #endif
}
export async function readCatalogCache(source:LocalDataSource,valid:(value:any)=>boolean):Promise<any|null>{
 try{
  // #ifdef H5
  const value=await browserRead(source);if(valid(value))return value;
  // #endif
  // #ifndef H5
  const selected=uni.getStorageSync(pointerKey(source))===1?1:0;
  for(const slot of [selected,1-selected]){
   try{const value=JSON.parse(await readChunkedCatalog({read:fileRead,write:fileWrite},filename(source,slot)));if(valid(value)){selectedSlots.set(source,slot);return value;}}catch{}
  }
  // #endif
 }catch{}
 // Old caches are read only as a migration fallback, then removed after a
 // successful write to the larger storage backend. Never erase them on failure.
 try{const legacy=uni.getStorageSync(LEGACY[source]);const value=typeof legacy==='string'?JSON.parse(legacy):legacy;if(valid(value))return value;}catch{}
 return null;
}
export async function writeCatalogCache(source:LocalDataSource,value:unknown):Promise<void>{
 // #ifdef H5
 await browserWrite(source,value);
 // #endif
 // #ifndef H5
 const text=JSON.stringify(value);if(utf8Size(text)>24*1024*1024)throw new Error('本机目录超过24 MB保存上限');
 const current=selectedSlots.get(source)??(uni.getStorageSync(pointerKey(source))===1?1:0),next=1-current;
 await writeChunkedCatalog({read:fileRead,write:fileWrite},filename(source,next),text);
 uni.setStorageSync(pointerKey(source),next);selectedSlots.set(source,next);
 // #endif
 try{uni.removeStorageSync(LEGACY[source]);}catch{}
}
