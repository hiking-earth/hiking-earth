import {CATALOG_CACHE_LIMIT} from './catalog-limits';
import {reviewedRouteStatus,type HikingRoute} from './routes';
const DB='hiking-earth-web-catalog',KEY='routes-v1';
function open():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('offline catalog storage unavailable'));return;}
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('snapshots'))request.result.createObjectStore('snapshots');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('offline catalog storage blocked'));
 });
}
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function point(value:unknown):boolean{return Array.isArray(value)&&value.length===2&&value.every(item=>typeof item==='number'&&Number.isFinite(item))&&Math.abs(value[0] as number)<=180&&Math.abs(value[1] as number)<=90;}
function valid(route:unknown):route is HikingRoute{
 if(!isRecord(route)||!['id','name','region','distance','ascent','duration','difficulty','bestSeason','summary','image','imageCredit'].every(key=>typeof route[key]==='string'&&(route[key] as string).length<=12000)||!point(route.center)||!['开放中','待核验','即将开放','临时关闭','永久关闭'].includes(route.status as string))return false;
 if(!Array.isArray(route.path)||route.path.length>20000||!route.path.every(point)||!Array.isArray(route.scenery)||!route.scenery.every((value:unknown)=>typeof value==='string')||!Array.isArray(route.bestSeasons)||!route.bestSeasons.every((value:unknown)=>typeof value==='string'&&['春','夏','秋','冬'].includes(value)))return false;
 if(!['轻装','重装','待核验'].includes(route.packStyle as string)||!['营地','住宿','无过夜','待核验'].includes(route.overnight as string)||!['景区成熟','未铺装','待核验'].includes(route.surface as string)||route.trackMode!==undefined&&!['认知示意','已核验轨迹','不展示轨迹'].includes(route.trackMode as string))return false;
 const archive=route.archive;if(!isRecord(archive)||typeof archive.checkedAt!=='string'||typeof archive.riskNotice!=='string'||!isRecord(archive.source)||typeof archive.source.label!=='string'||archive.source.url!==undefined&&typeof archive.source.url!=='string'||!Array.isArray(archive.highlights)||!archive.highlights.every((value:unknown)=>typeof value==='string'))return false;
 return true;
}
export async function readWebCatalogCache():Promise<{routes:HikingRoute[];savedAt:number}|null>{
 let db:IDBDatabase|undefined;
 try{
  db=await open();const value:unknown=await new Promise<unknown>((resolve,reject)=>{const request=db!.transaction('snapshots','readonly').objectStore('snapshots').get(KEY);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  if(!isRecord(value)||value.schemaVersion!==1||typeof value.savedAt!=='number'||!Number.isFinite(value.savedAt)||value.savedAt>Date.now()+60000||!Array.isArray(value.routes)||value.routes.length>CATALOG_CACHE_LIMIT||!value.routes.every(valid))return null;
  const routes=value.routes as HikingRoute[];return {savedAt:value.savedAt,routes:routes.map(route=>{const status=reviewedRouteStatus(route.status,route.openingExpiresAt);return status===route.status?route:{...route,status,openingExpiresAt:0};})};
 }catch{return null;}finally{db?.close();}
}
export async function writeWebCatalogCache(routes:HikingRoute[]):Promise<boolean>{
 if(routes.length>CATALOG_CACHE_LIMIT||!routes.every(valid))return false;
 let db:IDBDatabase|undefined;
 try{
  db=await open();await new Promise<void>((resolve,reject)=>{
   const transaction=db!.transaction('snapshots','readwrite');transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
   transaction.objectStore('snapshots').put({schemaVersion:1,savedAt:Date.now(),routes},KEY);
  });return true;
 }catch{return false;}finally{db?.close();}
}
