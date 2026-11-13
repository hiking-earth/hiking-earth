import {openLocalBasemap} from './local-basemap';
import {OFFLINE_MAP_STORAGE_BUDGET_BYTES} from './offline-map-limits';
export interface SavedBasemap {id:string;name:string;bytes:number;savedAt:number;blob:Blob}
export const BASEMAP_BUDGET=OFFLINE_MAP_STORAGE_BUDGET_BYTES;
export function basemapStorageBytes(rows:SavedBasemap[]):number{
 if(!Array.isArray(rows)||rows.length>4096)throw new Error('地图目录损坏，请保留原包');
 const ids=new Set<string>();let total=0;
 for(const row of rows){
  if(!row||typeof row.id!=='string'||ids.has(row.id)||typeof row.name!=='string'||!row.name||row.name.length>120||!Number.isSafeInteger(row.bytes)||row.bytes<127||row.bytes>64*1024*1024||!(row.blob instanceof Blob)||row.blob.size!==row.bytes||!Number.isSafeInteger(row.savedAt)||row.savedAt<=0)throw new Error('地图目录损坏，请保留原包');
  ids.add(row.id);total+=row.bytes;
 }
 if(total>BASEMAP_BUDGET)throw new Error('地图目录超出容量限制');return total;
}
let database:Promise<IDBDatabase>|undefined;
export function openBasemapDatabase():Promise<IDBDatabase>{
 if(database)return database;
 database=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('hiking-earth-basemaps',2);
  request.onupgradeneeded=()=>{for(const name of ['maps','terrain'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};
  request.onerror=()=>reject(new Error('无法打开地图数据库'));
  request.onblocked=()=>reject(new Error('地图数据库被其他窗口占用'));
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=undefined;};resolve(db);};
 }).catch(error=>{database=undefined;throw error;});return database;
}
export async function listBasemaps():Promise<SavedBasemap[]>{
 const db=await openBasemapDatabase();return new Promise((resolve,reject)=>{
  const tx=db.transaction('maps','readonly'),request=tx.objectStore('maps').getAll();
  tx.oncomplete=()=>{try{basemapStorageBytes(request.result);resolve(request.result);}catch(e){reject(e);}};tx.onerror=()=>reject(new Error('地图目录读取失败'));tx.onabort=()=>reject(new Error('地图目录读取中断'));
 });
}
export async function saveBasemap(file:File):Promise<SavedBasemap>{
 await openLocalBasemap('validate-import',file.size,(offset,length)=>file.slice(offset,offset+length).arrayBuffer());
 const item:SavedBasemap={id:crypto.randomUUID(),name:file.name.slice(0,120),bytes:file.size,savedAt:Date.now(),blob:file};
 const db=await openBasemapDatabase();await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(['maps','terrain'],'readwrite'),store=tx.objectStore('maps'),request=store.getAll(),terrainRequest=tx.objectStore('terrain').getAll();
  let failure='地图保存失败，可能设备空间不足';
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error(failure));tx.onabort=()=>reject(new Error(failure));
  let pending=2;const ready=()=>{if(--pending)return;let total:number;try{total=basemapStorageBytes(request.result)+terrainStorageBytes(terrainRequest.result);}catch{failure='地图目录损坏，原资料已保留';tx.abort();return;}if(request.result.length>=4096){failure='地图包数量达到上限，请先删除不再使用的地图';tx.abort();return;}if(total+item.bytes>BASEMAP_BUDGET){failure='区域地图总量超过192 MiB，请先删除不再使用的地图';tx.abort();return;}store.add(item);};request.onsuccess=ready;terrainRequest.onsuccess=ready;
 });return item;
}
export async function deleteBasemap(id:string):Promise<void>{
 const db=await openBasemapDatabase();return new Promise((resolve,reject)=>{
  const tx=db.transaction('maps','readwrite');tx.objectStore('maps').delete(id);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('地图删除失败'));tx.onabort=()=>reject(new Error('地图删除中断'));
 });
}

/** Same database/transaction budget for optional elevation and vector maps. */
export function terrainStorageBytes(rows:any[]):number {
 if(!Array.isArray(rows)||rows.length>128)throw new Error('地形目录损坏');
 const ids=new Set<string>();let total=0;
 for(const r of rows){if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||r.name.length>80||!r.name||!Number.isSafeInteger(r.bytes)||r.bytes<22||r.bytes>33*1024*1024||!(r.blob instanceof Blob)||r.blob.size!==r.bytes||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.savedAt)||r.savedAt<=0)throw new Error('地形目录损坏，请保留原包');ids.add(r.id);total+=r.bytes;}
 if(total>BASEMAP_BUDGET)throw new Error('地形目录超出容量限制');return total;
}
