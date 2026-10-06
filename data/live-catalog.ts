import {ROUTES as bundled,type HikingRoute} from './routes';
import {loadStaticPages,searchStatic,staticManifest,type StaticManifest} from './static-catalog';
export type OfficialNotice={id:string;title:string;url:string;region:string;sourceLabel:string;sourceUrl:string;publishedAt:string|null;fetchedAt:string;center:[number,number]};
const sources=['osm','usfs','hk'] as const;
const PAGE_SIZE=400;
function jsonObject(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid JSON object');return value as Record<string,any>;}
let coverageSummary='';
export function publicCatalogCoverageSummary(){return coverageSummary;}
const key=(r:HikingRoute)=>`${r.name.normalize('NFKC').toLowerCase().replace(/[\s·—_-]/g,'')}:${r.center.map(v=>v.toFixed(1)).join(',')}`;
const regions:Record<string,string>={china:'中国检索区域','hong-kong':'香港',macao:'澳门',europe:'欧洲','north-america':'北美',japan:'日本及周边检索区域',oceania:'大洋洲','south-america':'南美',africa:'非洲','south-asia':'南亚'};
function discover(raw:any,source:string,attribution:string):HikingRoute[]{
 if(!Array.isArray(raw)||raw.length>40000)throw new Error('catalog size invalid');return raw.filter((r:any)=>r&&typeof r.id==='string'&&typeof r.name==='string'&&Array.isArray(r.center)&&r.center.length===2&&r.center.every(Number.isFinite)&&Math.abs(r.center[0])<=180&&Math.abs(r.center[1])<=90).map((r:any)=>({id:r.id,name:r.name,region:regions[r.region]||r.region||'未注明区域',status:'待核验',center:r.center,path:source==='hk'&&r.referencePaths?.length===1?r.referencePaths[0]:[],distance:Number.isFinite(r.sourceTags?.distanceKm)?`${r.sourceTags.distanceKm.toFixed(1)} km`:r.sourceTags?.distance?`${r.sourceTags.distance}（单位待核验）`:'待核验',ascent:'待核验',duration:'待核验',difficulty:'待核验',bestSeason:'待核验',bestSeasons:[],packStyle:'轻装',overnight:'无过夜',surface:'未铺装',trackMode:source==='hk'&&r.referencePaths?.length===1?'认知示意':'不展示轨迹',scenery:[],summary:'自动采集的徒步路线档案；开放许可、装备和住宿尚未核验。',image:'/static/original-mountain-reference.png',imageCredit:'徒步地球原创几何示意 · 非路线实景',archive:{source:{label:attribution,url:r.sourceUrl},checkedAt:`采集 ${r.fetchedAt}；开放状态未核验`,highlights:[],riskNotice:'地图收录不代表允许通行；本档案不提供导航。'}}));
}
async function apiFirstPage(source:string):Promise<Record<string,any> & {items:any[]}>{
 const first=await fetch(`/api/catalog?source=${source}&page=0`,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw new Error('catalog unavailable');return r.json().then(jsonObject);});
 if(!Array.isArray(first.items)||first.items.length>PAGE_SIZE||first.page!==0||!Number.isInteger(first.total)||first.total<0||!/^([a-f0-9]{64})$/.test(first.snapshot)||typeof first.key!=='string')throw new Error('catalog page invalid');
 if(first.total>40000)throw new Error('catalog exceeds safe read limit');
 const pageCount=Math.ceil(first.total/PAGE_SIZE);
 if(first.hasMore!==(pageCount>1))throw new Error('catalog page state invalid');
 return first;
}
async function apiPages(source:string,first:Record<string,any> & {items:any[]}):Promise<Record<string,any> & {items:any[]}>{
 const pageCount=Math.ceil(first.total/PAGE_SIZE),items=[...first.items];
 for(let start=1;start<pageCount;start+=8){
  const pageNumbers=Array.from({length:Math.min(8,pageCount-start)},(_,i)=>start+i);
  const later=await Promise.all(pageNumbers.map(page=>fetch(`/api/catalog?source=${source}&page=${page}&snapshot=${first.snapshot}`,{signal:AbortSignal.timeout(15000)}).then(x=>{if(!x.ok)throw new Error('catalog unavailable');return x.json().then(jsonObject);})));
  for(let i=0;i<later.length;i++){const page=pageNumbers[i],result=later[i];if(result.snapshot!==first.snapshot||result.total!==first.total||result.key!==first.key||!Array.isArray(result.items)||result.items.length>PAGE_SIZE||result.page!==page||result.hasMore!==(page<pageCount-1))throw new Error('catalog changed during read');items.push(...result.items);}
 }
 if(items.length!==first.total)throw new Error('catalog incomplete');return {...first,items};
}
function generatedAt(value:any){const time=Date.parse(value?.metadata?.generatedAt||'');return Number.isFinite(time)?time:-Infinity;}
async function pages(source:'osm'|'usfs'|'hk'|'news'){
 const [apiResult,staticResult]=await Promise.allSettled([apiFirstPage(source),staticManifest(source)]);
 if(apiResult.status==='rejected'&&staticResult.status==='rejected')throw apiResult.reason;
 if(apiResult.status==='rejected')return loadStaticPages(source,staticResult.value);
 if(staticResult.status==='rejected')return apiPages(source,apiResult.value);
 const remoteTime=generatedAt(apiResult.value),staticTime=generatedAt(staticResult.value);
 const remoteCount=Number.isInteger(apiResult.value.metadata?.sourceTotal)?apiResult.value.metadata.sourceTotal:apiResult.value.total;
 const preferStatic=staticTime>remoteTime||staticTime===remoteTime&&staticResult.value.total>remoteCount;
 if(preferStatic){try{return await loadStaticPages(source,staticResult.value);}catch{return apiPages(source,apiResult.value);}}
 try{return await apiPages(source,apiResult.value);}catch{return loadStaticPages(source,staticResult.value);}
}
async function allReviews(){
 const first=await fetch('/api/catalog/reviews?page=0',{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw new Error('review unavailable');return r.json().then(jsonObject);});
 if(!Array.isArray(first.items)||first.items.length>10||typeof first.hasMore!=='boolean')throw new Error('review snapshot invalid');
 const rows:any[]=[...first.items];let done=!first.hasMore;
 for(let start=1;!done&&start<100;start+=8){
  const pageNumbers=Array.from({length:Math.min(8,100-start)},(_,i)=>start+i);
  const later=await Promise.all(pageNumbers.map(page=>fetch(`/api/catalog/reviews?page=${page}`,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw new Error('review unavailable');return r.json().then(jsonObject);})));
  for(let i=0;i<later.length;i++){const response=later[i];if(!Array.isArray(response.items)||response.items.length>10||typeof response.hasMore!=='boolean')throw new Error('review snapshot invalid');rows.push(...response.items);if(!response.hasMore){done=true;break;}}
 }
 if(!done)throw new Error('review page limit');return rows;
}
export async function loadPublicRouteCatalog():Promise<HikingRoute[]>{
 const snapshots=await Promise.all(sources.map(pages));let reviewRows:any[]=[];let reviewsAvailable=true;
 try{reviewRows=await allReviews();}catch{reviewsAvailable=false;}
 const updated=snapshots.flatMap((snapshot,index)=>discover(snapshot.items,sources[index],snapshot.metadata?.attribution||['© OpenStreetMap contributors · ODbL-1.0','USDA Forest Service','DATA.GOV.HK-terms-1.2'][index]));
 const originals=new Map(bundled.map(r=>[r.id,r]));const byId=new Map<string,HikingRoute>();for(const route of updated)if(!byId.has(route.id))byId.set(route.id,route);
 for(const raw of reviewRows){if(!raw||typeof raw.routeId!=='string'||!byId.has(raw.routeId)&&!originals.has(raw.routeId)||!Number.isFinite(raw.expiresAt)||raw.expiresAt<Date.parse(raw.checkedAt)||raw.expiresAt>Date.parse(raw.checkedAt)+7*86400000||!Number.isFinite(Date.parse(raw.checkedAt))||Date.parse(raw.checkedAt)>Date.now()||!Number.isInteger(raw.version)||typeof raw.sourceUrl!=='string'||!/^https:\/\//.test(raw.sourceUrl)||typeof raw.summary!=='string'||typeof raw.riskNotice!=='string'||!['开放中','即将开放','临时关闭','永久关闭','待核验'].includes(raw.status))continue;const original=originals.get(raw.routeId);if(original?.status==='永久关闭')continue;const route=byId.get(raw.routeId)||{...original!};route.status=raw.status==='开放中'&&raw.expiresAt<=Date.now()?'待核验':raw.status;route.openingExpiresAt=raw.expiresAt;route.summary=String(raw.summary||'').slice(0,3000);route.archive={...route.archive,source:{label:'官方资料人工核验',url:raw.sourceUrl},checkedAt:raw.checkedAt,riskNotice:String(raw.riskNotice||'').slice(0,3000)};const track=raw.track;if(track&&typeof track.sourceUrl==='string'&&/^https:\/\//.test(track.sourceUrl)&&typeof track.license==='string'&&track.license.trim()&&Array.isArray(track.path)&&track.path.length>=2&&track.path.length<=20000&&track.path.every((p:any)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)){route.path=track.path;route.trackMode='已核验轨迹';route.archive.riskNotice+=`\n轨迹许可：${track.license}；来源：${track.sourceUrl}`;}byId.set(route.id,route);}
 coverageSummary=snapshots.map((snapshot,index)=>`${['OSM','美国国家森林','香港官方步道'][index]}：已同步${snapshot.total}条 / 来源${snapshot.metadata?.sourceTotal??snapshot.total}条${snapshot.metadata?.complete===false?'，其余可在线检索':''}`).join('；')+`；路线审核：${reviewsAvailable?`已读取${reviewRows.length}条有效期审核记录`:'云端暂不可用，动态开放状态回退为待核验'}`;
 const base=bundled.map(r=>{const reviewed=byId.get(r.id);if(reviewed)return reviewed;return r.status==='开放中'?{...r,status:'待核验' as const,openingExpiresAt:0}:r;});return [...base,...[...byId.values()].filter(r=>!originals.has(r.id))];
}

export async function loadOfficialNotices():Promise<{items:OfficialNotice[];generatedAt:string}>{
 const snapshot=await pages('news');
 if(snapshot.key!=='items'||!Number.isFinite(Date.parse(snapshot.metadata?.generatedAt))||!Array.isArray(snapshot.items))throw new Error('公告快照格式无效');
 const items=snapshot.items.filter((row:any)=>{
  if(!row||typeof row.id!=='string'||typeof row.title!=='string'||!row.title.trim()||row.title.length>300||typeof row.region!=='string'||typeof row.sourceLabel!=='string'||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt)))return false;
  if(!Array.isArray(row.center)||row.center.length!==2||!row.center.every(Number.isFinite)||Math.abs(row.center[0])>180||Math.abs(row.center[1])>90)return false;
  for(const value of [row.url,row.sourceUrl]){try{const parsed=new URL(value);if(parsed.protocol!=='https:'||parsed.hostname!=='www.nps.gov'||parsed.username||parsed.password)return false;}catch{return false;}}
  return row.publishedAt==null||typeof row.publishedAt==='string'&&Number.isFinite(Date.parse(row.publishedAt));
 }).map((row:any)=>({id:row.id,title:row.title,url:row.url,region:row.region,sourceLabel:row.sourceLabel,sourceUrl:row.sourceUrl,publishedAt:row.publishedAt,fetchedAt:row.fetchedAt,center:row.center as [number,number]}));
 if(items.length!==snapshot.items.length)throw new Error('公告条目校验未通过');
 return {items,generatedAt:snapshot.metadata.generatedAt};
}

export async function searchPublicRoutes(source:'osm'|'usfs'|'hk',query:string,offset=0,snapshot?:string):Promise<{routes:HikingRoute[];total:number;offset:number;snapshot:string;hasMore:boolean}>{
 if(query.trim().length<2||query.length>100||!Number.isInteger(offset)||offset<0||offset>250000)throw new Error('搜索词或分页位置无效');
 const params=new URLSearchParams({source,q:query,offset:String(offset),...(snapshot?{snapshot}:{})});let remote:Record<string,any>|undefined;
 try{
  const response=await fetch(`/api/catalog/search?${params}`,{signal:AbortSignal.timeout(55000)});if(!response.ok)throw new Error('online catalog search unavailable');
  const data=jsonObject(await response.json());
  if(!/^([a-f0-9]{64})$/.test(data.snapshot)||snapshot&&snapshot!==data.snapshot||!Number.isInteger(data.total)||data.total<0||data.total>250000||data.offset!==offset||data.key!=='routes'||!Array.isArray(data.items)||data.items.length>20||data.hasMore!==(offset+data.items.length<data.total))throw new Error('online catalog page invalid');
  remote=data;
 }catch{}
 let manifest:StaticManifest|undefined;try{manifest=await staticManifest(source);}catch{}
 const remoteTime=generatedAt(remote),staticTime=generatedAt(manifest);
 const remoteIsCurrent=!!remote&&(remoteTime>staticTime||remoteTime===staticTime&&manifest&&Number.isInteger(remote.metadata?.sourceTotal)&&remote.metadata.sourceTotal>=manifest.total);
 if(remoteIsCurrent||remote&&!manifest){const routes=discover(remote!.items,source,remote!.metadata?.attribution||'来源档案');if(routes.length!==remote!.items.length)throw new Error('在线资料校验未通过');return {routes,total:remote!.total,offset,snapshot:remote!.snapshot,hasMore:remote!.hasMore};}
 try{const data=await searchStatic(source,query,offset,snapshot);const routes=discover(data.items,source,data.metadata?.attribution||'来源档案');if(routes.length!==data.items.length)throw new Error('bundled catalog page invalid');return {routes,total:data.total,offset,snapshot:data.snapshot,hasMore:data.hasMore};}
 catch{if(remote){const routes=discover(remote.items,source,remote.metadata?.attribution||'来源档案');return {routes,total:remote.total,offset,snapshot:remote.snapshot,hasMore:remote.hasMore};}throw new Error('在线检索暂不可用，请稍后重试');}
}
