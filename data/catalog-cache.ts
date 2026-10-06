import type {HikingRoute} from './routes';
const DB='hiking-earth-web-catalog',KEY='routes-v1';
function open():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('offline catalog storage unavailable'));return;}
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('snapshots'))request.result.createObjectStore('snapshots');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('offline catalog storage blocked'));
 });
}
const point=(value:any)=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
function valid(route:any):route is HikingRoute{
 if(!route||!['id','name','region','distance','ascent','duration','difficulty','bestSeason','summary','image','imageCredit'].every(key=>typeof route[key]==='string'&&route[key].length<=12000)||!point(route.center)||!['开放中','待核验','即将开放','临时关闭','永久关闭'].includes(route.status))return false;
 if(!Array.isArray(route.path)||route.path.length>20000||!route.path.every(point)||!Array.isArray(route.scenery)||!route.scenery.every((value:any)=>typeof value==='string')||!Array.isArray(route.bestSeasons)||!route.bestSeasons.every((value:any)=>['春','夏','秋','冬'].includes(value)))return false;
 if(!['轻装','重装'].includes(route.packStyle)||!['营地','住宿','无过夜'].includes(route.overnight)||!['景区成熟','未铺装'].includes(route.surface)||route.trackMode!==undefined&&!['认知示意','已核验轨迹','不展示轨迹'].includes(route.trackMode))return false;
 const archive=route.archive;return !!archive&&typeof archive.checkedAt==='string'&&typeof archive.riskNotice==='string'&&typeof archive.source?.label==='string'&&(archive.source.url===undefined||typeof archive.source.url==='string')&&Array.isArray(archive.highlights)&&archive.highlights.every((value:any)=>typeof value==='string');
}
export async function readWebCatalogCache():Promise<{routes:HikingRoute[];savedAt:number}|null>{
 let db:IDBDatabase|undefined;
 try{
  db=await open();const value:any=await new Promise((resolve,reject)=>{const request=db!.transaction('snapshots','readonly').objectStore('snapshots').get(KEY);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  if(value?.schemaVersion!==1||!Number.isFinite(value.savedAt)||value.savedAt>Date.now()+60000||!Array.isArray(value.routes)||value.routes.length>100000||!value.routes.every(valid))return null;
  return {savedAt:value.savedAt,routes:value.routes.map((route:HikingRoute)=>route.status==='开放中'&&(!Number.isFinite(route.openingExpiresAt)||route.openingExpiresAt!<=Date.now())?{...route,status:'待核验',openingExpiresAt:0}:route)};
 }catch{return null;}finally{db?.close();}
}
export async function writeWebCatalogCache(routes:HikingRoute[]):Promise<boolean>{
 let db:IDBDatabase|undefined;
 try{
  db=await open();await new Promise<void>((resolve,reject)=>{
   const transaction=db!.transaction('snapshots','readwrite');transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
   transaction.objectStore('snapshots').put({schemaVersion:1,savedAt:Date.now(),routes},KEY);
  });return true;
 }catch{return false;}finally{db?.close();}
}
