import {reactive} from 'vue';
import {publicSnapshot} from './public-data';
import registry from '@shared/data/content/official-sources.json';
import snapshot from '@shared/data/content/official-news.json';
import {hasCurrentOfficialFeedReview} from '@shared/content/feed-review';
export type OfficialNews={sourceId:string;id:string;title:string;url:string;region:string;sourceLabel:string;sourceUrl:string;publishedAt:string|null;fetchedAt:string};
export type NewsSourceState={id:string;label:string;lastSuccess?:string;lastAttempt?:string;lastError?:string|null;lastCollectedCount?:number};
export type NewsCollectionStatus={state:'success'|'partial'|'all-attempted-sources-failed';attemptedSourceCount:number;failedSourceCount:number};
const KEY='he_official_news_v1';
const MAX_PUBLICATION_AGE_MS=90*24*60*60*1000;
export const news=reactive({items:[] as OfficialNews[],generatedAt:null as string|null,error:'',loading:false,sources:registry.sources.map(source=>({id:source.id,label:source.label})) as NewsSourceState[],collectionStatus:null as NewsCollectionStatus|null,retryAt:0});
function officialUrl(value:unknown,hosts:readonly string[]):boolean{
  if(typeof value!=='string'||value.length>2048)return false;
  const match=/^https:\/\/([^/?#]+)\/[^\\\s\u0000-\u001f\u007f]*$/.exec(value);return !!match&&hosts.includes(match[1]);
}
const valid=(r:any):r is OfficialNews=>!!r&&registry.sources.some(source=>source.id===r.sourceId&&source.url===r.sourceUrl&&source.label===r.sourceLabel&&source.region===r.region&&hasCurrentOfficialFeedReview(source)&&officialUrl(r.url,source.articleHosts)&&officialUrl(r.sourceUrl,source.articleHosts))&&typeof r.id==='string'&&!!r.id&&r.id.length<=160
  &&typeof r.title==='string'&&!!r.title.trim()&&r.title.length<=300
  &&typeof r.region==='string'&&r.region.length<=100&&typeof r.sourceLabel==='string'&&r.sourceLabel.length<=200
  &&typeof r.fetchedAt==='string'&&Number.isFinite(Date.parse(r.fetchedAt))&&Date.parse(r.fetchedAt)<=Date.now()+30000
  &&(r.publishedAt===null||(typeof r.publishedAt==='string'&&Number.isFinite(Date.parse(r.publishedAt))));
function apply(data:any){
  if(data?.schemaVersion!==1||!Array.isArray(data.items)||data.items.length>500
    ||typeof data.generatedAt!=='string'||!Number.isFinite(Date.parse(data.generatedAt))||Date.parse(data.generatedAt)>Date.now()+30000)return false;
  let collectionStatus:NewsCollectionStatus|null=null;
  if(data.collectionStatus!==undefined){
    const status=data.collectionStatus;
    if(!status||typeof status!=='object'||!['success','partial','all-attempted-sources-failed'].includes(status.state)
      ||!Number.isSafeInteger(status.attemptedSourceCount)||status.attemptedSourceCount<0
      ||!Number.isSafeInteger(status.failedSourceCount)||status.failedSourceCount<0||status.failedSourceCount>status.attemptedSourceCount
      ||status.reviewedAt!==data.generatedAt||status.cachedItemsRevalidated!==true)return false;
    const expected=status.failedSourceCount===0?'success':status.attemptedSourceCount>0&&status.failedSourceCount===status.attemptedSourceCount?'all-attempted-sources-failed':'partial';
    if(status.state!==expected)return false;
    collectionStatus={state:status.state,attemptedSourceCount:status.attemptedSourceCount,failedSourceCount:status.failedSourceCount};
  }
  const validItems=data.items.filter(valid);
  const ids=new Map<string,number>();
  for(const item of validItems)ids.set(item.id,(ids.get(item.id)||0)+1);
  const uniqueItems=validItems.filter((item:OfficialNews)=>ids.get(item.id)===1
    &&Date.parse(item.fetchedAt)<=Date.parse(data.generatedAt));
  const sources=data.sources===undefined?[]:data.sources;
  if(!Array.isArray(sources)||sources.length>50)return false;
  const safeSources=new Map<string,any>();
  for(const r of sources){
    const source:any=r&&registry.sources.find(item=>item.id===r.id&&item.label===r.label&&item.url===r.url);
    /* Source health is optional display metadata; reject stale/config-drifted rows individually. */
    const maxItems=500;
    if(!source||!hasCurrentOfficialFeedReview(r)||typeof r.id!=='string'||typeof r.label!=='string'||r.label.length>200
      ||[r.lastSuccess,r.lastAttempt].some(v=>v!==undefined&&(typeof v!=='string'||!Number.isFinite(Date.parse(v))||Date.parse(v)>Date.now()+30000))
      ||r.lastCollectedCount!==undefined&&(!Number.isInteger(r.lastCollectedCount)||r.lastCollectedCount<0||r.lastCollectedCount>maxItems)
      ||r.lastError!==undefined&&r.lastError!==null&&typeof r.lastError!=='string')continue;
    if(!safeSources.has(r.id))safeSources.set(r.id,r);
  }
  // Validate the complete response before classifying an older server fallback.
  // Never replace newer bundled or cached records with an older snapshot.
  if(news.generatedAt!==null&&Date.parse(data.generatedAt)<Date.parse(news.generatedAt))return 'stale';
  news.sources=registry.sources.map(source=>{const state=safeSources.get(source.id);return {id:source.id,label:source.label,...(state?{lastSuccess:state.lastSuccess,lastAttempt:state.lastAttempt,lastError:state.lastError,lastCollectedCount:state.lastCollectedCount}:{})};});
  const now=Date.now();
  news.items=uniqueItems.filter((r:OfficialNews)=>typeof r.publishedAt==='string'
    &&Date.parse(r.publishedAt)<=now+300000&&now-Date.parse(r.publishedAt)<=MAX_PUBLICATION_AGE_MS);
  news.generatedAt=data.generatedAt;news.collectionStatus=collectionStatus;return 'applied';
}
apply(snapshot);
try{apply(uni.getStorageSync(KEY));}catch{}
let last=0,lastAttempt=0,failures=0,foreground=true,generation=0;
export function setNewsForeground(value:boolean){if(foreground!==value){foreground=value;generation++;}if(value)void refreshNews();}
function pruneExpiredNews(now=Date.now()):void{
  const cutoff=now-MAX_PUBLICATION_AGE_MS;
  news.items=news.items.filter(item=>typeof item.publishedAt==='string'
    &&Date.parse(item.publishedAt)<=now+300000&&Date.parse(item.publishedAt)>=cutoff);
}
export async function refreshNews(force=false):Promise<void>{
  // Expire cached in-memory items even when the network request below fails.
  pruneExpiredNews();
  const now=Date.now();
  if(!foreground||news.loading||now-lastAttempt<30000||(!force&&(now<news.retryAt||now-last<60*60*1000)))return;
  const epoch=generation;lastAttempt=now;news.loading=true;news.error='';
  try{
    const data=await publicSnapshot('news');
    if(!foreground||epoch!==generation)return;
    const outcome=apply(data);
    if(!outcome)throw new Error('公告格式无效，保留本机资料');
    if(outcome==='stale')throw new Error('云端公告暂未更新，已保留较新的本机资料；稍后自动重试');
    last=Date.now();failures=0;news.retryAt=0;
    try{uni.setStorageSync(KEY,data);}catch{news.error='公告已更新，本机缓存保存失败';}
  }catch(e:any){if(!foreground||epoch!==generation)return;failures++;news.retryAt=Date.now()+Math.min(6*60*60*1000,15*60*1000*2**Math.min(failures-1,5));news.error=e?.message||'公告更新失败，保留本机资料';}
  finally{news.loading=false;}
}
