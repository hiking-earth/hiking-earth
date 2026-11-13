import {browserReportsOffline} from './network-state';
export const PUBLIC_MAP_DISTRIBUTION='https://hiking-earth.hiking-earth.workers.dev/client-app/';
export function mapDistributionBase(desktop:boolean,localBase:string):string{return desktop?PUBLIC_MAP_DISTRIBUTION:localBase;}
export interface MapCatalogPack {name:string;label:string;url:string;bytes:number;sha256:string;attribution:string;license:string;bounds?:number[]}
/** Only compare our dated regional filenames; arbitrary imports are not versions. */
export function findNewerMapPack(name:string,catalog:MapCatalogPack[],savedNames:readonly string[]=[]):MapCatalogPack|null{
 const parse=(value:string)=>{
  const match=/^([a-z0-9-]{1,71})-(\d{4})(\d{2})(\d{2})\.pmtiles$/.exec(value);
  if(!match)return null;
  const year=Number(match[2]),month=Number(match[3]),day=Number(match[4]);
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<2000||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return {region:match[1],date:date.getTime()};
 };
 const current=parse(name);if(!current)return null;
 let selected:MapCatalogPack|null=null,latest=current.date;
 for(const pack of catalog){
  const candidate=parse(pack.name);
  if(candidate&&candidate.region===current.region&&candidate.date>latest){
   selected=pack;latest=candidate.date;
  }
 }
 return selected&&!savedNames.includes(selected.name)?selected:null;
}
export function validateMapCatalog(value:unknown):MapCatalogPack[]{
 if(!Array.isArray(value)||!value.length||value.length>128)throw new Error('地图目录无效');
 const names=new Set<string>();let bytes=0;
 return value.map(row=>{
  if(!row||typeof row!=='object'||typeof row.name!=='string'||!/^[a-z0-9-]{1,80}\.pmtiles$/.test(row.name)||names.has(row.name)||row.url!==`static/offline-maps/${row.name}`||!Number.isSafeInteger(row.bytes)||row.bytes<127||row.bytes>64*1024*1024||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||typeof row.label!=='string'||!row.label.trim()||row.label.length>80||typeof row.attribution!=='string'||!row.attribution.trim()||row.attribution.length>300||row.license!=='ODbL-1.0 Produced Work')throw new Error('地图目录条目无效');
  const bounds=row.bounds;
  if(bounds!==undefined&&(!Array.isArray(bounds)||bounds.length!==4||!bounds.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v))||bounds[0]<-180||bounds[2]>180||bounds[0]>=bounds[2]||bounds[1]<-85.05112878||bounds[3]>85.05112878||bounds[1]>=bounds[3]))throw new Error('地图覆盖范围无效');
  names.add(row.name);bytes+=row.bytes;if(bytes>500_000_000)throw new Error('地图目录超过500 MB');
  return {name:row.name,label:row.label,url:row.url,bytes:row.bytes,sha256:row.sha256,attribution:row.attribution,license:row.license,...(bounds===undefined?{}:{bounds:[...bounds]})};
 });
}
export function createMapCatalog(seed:unknown,request:()=>Promise<string>,now=()=>Date.now()){
 let packs=validateMapCatalog(seed),next=0,pending:Promise<MapCatalogPack[]>|null=null;
 const snapshot=()=>packs.map(row=>({...row,...(row.bounds?{bounds:[...row.bounds]}:{})}));
 return {snapshot,refresh():Promise<MapCatalogPack[]>{
  if(pending)return pending.then(()=>snapshot());if(now()<next)return Promise.resolve(snapshot());
  pending=(async()=>{try{const text=await Promise.resolve().then(request);if(typeof text!=='string'||text.length>256*1024)throw new Error('地图目录过大');const updated=validateMapCatalog(JSON.parse(text));packs=updated.map(row=>{if(row.bounds)return row;const known=packs.find(old=>old.name===row.name&&old.bytes===row.bytes&&old.sha256===row.sha256);return known?.bounds?{...row,bounds:[...known.bounds]}:row;});next=now()+3600000;return snapshot();}catch(error){next=now()+60000;throw error;}finally{pending=null;}})();return pending.then(()=>snapshot());
 }};
}
export function requestMapCatalog(base:string):Promise<string>{
 if(!/^(?:https:\/\/[a-z0-9.-]+(?::[0-9]+)?|http:\/\/(?:localhost|127\.0\.0\.1|tauri\.localhost)(?::[0-9]+)?|tauri:\/\/localhost)\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))return Promise.reject(new Error('地图目录地址不受支持'));
 if(browserReportsOffline())return Promise.reject(new Error('当前设备离线，保留本机地图目录，联网后再更新'));
 const url=base+'static/offline-maps/catalog.json';
 return new Promise((resolve,reject)=>uni.request({url,method:'GET',timeout:15000,dataType:'text',responseType:'text',success:r=>{if(r.statusCode!==200||typeof r.data!=='string')reject(new Error('地图目录暂时无法更新，保留已有目录'));else resolve(r.data);},fail:()=>reject(new Error('地图目录暂时无法更新，保留已有目录'))}));
}

export function mapsCoveringLocation(packs:MapCatalogPack[],latitude:number,longitude:number):MapCatalogPack[]{
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude>90||longitude < -180||longitude>180)throw new Error('请输入有效经纬度');
 return packs.filter(row=>row.bounds&&latitude>=row.bounds[1]&&latitude<=row.bounds[3]&&longitude>=row.bounds[0]&&longitude<=row.bounds[2]);
}
