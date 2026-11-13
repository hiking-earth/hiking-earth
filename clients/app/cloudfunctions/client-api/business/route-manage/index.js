const cloud=require('wx-server-sdk');const crypto=require('crypto');cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});const db=cloud.database({throwOnNotFound:false});
const statuses=['开放中','即将开放','临时关闭','永久关闭','待核验'];
function publicReview(row,now=Date.now()){const {reviewedBy,...review}=row;const current=Number.isFinite(review.expiresAt)&&review.expiresAt>now;return {...review,status:current?review.status:'待核验',track:current&&review.status==='开放中'?review.track||null:null};}
exports.main=async event=>{
 const OPENID = require('../../identity').optionalIdentity();
 if(event.action==='access-candidates'){
  if(!require('../owner-admin').isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
  return require('../route-access-audit').list(event.page===undefined?0:event.page,event.snapshot);
 }
 if(event.action==='list'){
  if(typeof event.routeId==='string'&&event.routeId.trim()&&event.routeId.length<=128){
   const id=crypto.createHash('sha256').update(event.routeId).digest('hex');
   const row=(await db.collection('route_reviews').doc(id).get()).data;
   return {items:row?[publicReview(row)]:[],hasMore:false};
  }
  const page=Number.isInteger(event.page)&&event.page>=0&&event.page<1000?event.page:0;
  const rows=(await db.collection('route_reviews').orderBy('updatedAt','desc').skip(page*10).limit(10).get()).data;
  return {items:rows.map(row=>publicReview(row)),hasMore:rows.length===10};
 }
 const adminAccess=require('../owner-admin');
 if(event.action==='capabilities')return {canReview:adminAccess.isOwnerAdmin(OPENID),ownerConfigured:adminAccess.ownerAdminConfigured()};
 if(!adminAccess.isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
 if(event.action!=='save'||typeof event.routeId!=='string'||!event.routeId.trim()||event.routeId.length>128||!statuses.includes(event.status))return {errMsg:'路线审核格式无效'};
 let source;try{source=new URL(event.sourceUrl);}catch{return {errMsg:'需提供官方资料链接'};}
 const defaultDomains='nps.gov,usgs.gov,usda.gov,parks.canada.ca,open.canada.ca,data.canada.ca,gc.ca,doc.govt.nz,govt.nz,gov.uk,gov.wales,naturalresources.wales,gov.au,gov.jp,go.jp,admin.ch,opendata.swiss,hiking.gov.hk,afcd.gov.hk,info.gov.hk,portal.csdi.gov.hk,data.gov.hk,dengfeng.gov.cn,dpm.org.cn,lmsk.cn,bmy.com.cn,shaolin.org.cn,datos.gob.es,sigred.oapn.es,centrodedescargas.cnig.es,www.ign.es,www.scne.es,partnerships.nationalmap.gov';
 const allowed=String(process.env.HIKING_OFFICIAL_DOMAINS||defaultDomains).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(source.protocol!=='https:'||source.username||source.password||source.port||!allowed.some(domain=>source.hostname===domain||source.hostname.endsWith('.'+domain)))return {errMsg:'该来源域名尚未配置为官方资料源'};
 if(typeof event.summary!=='string'||event.summary.length>3000||typeof event.riskNotice!=='string'||event.riskNotice.length>3000)return {errMsg:'资料内容格式无效'};
 const checkedAt=Date.parse(event.checkedAt);if(!Number.isFinite(checkedAt)||checkedAt>Date.now()||checkedAt<Date.now()-30*86400000)return {errMsg:'开放资料须为最近30天核验记录'};
 const expiresAt=Math.min(checkedAt+7*86400000,Date.now()+7*86400000);
 if(event.status==='开放中'&&expiresAt<=Date.now())return {errMsg:'开放状态资料已过期，请重新核验'};
 let track=null;
 if(event.track){
  const t=event.track;let url;try{url=new URL(t.sourceUrl);}catch{return {errMsg:'轨迹需提供可追溯来源链接'};}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain))||typeof t.license!=='string'||!t.license.trim()||t.license.length>1000||t.continuityConfirmed!==true||!Array.isArray(t.path)||t.path.length<2||t.path.length>3000||!t.path.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90))return {errMsg:'轨迹需有效许可、连续性确认与2至3000个WGS84点'};
  track={sourceUrl:url.href,license:t.license.trim(),path:t.path,verifiedAt:new Date(checkedAt).toISOString()};
 }
 const id=crypto.createHash('sha256').update(event.routeId).digest('hex');
 return db.runTransaction(async tx=>{const ref=tx.collection('route_reviews').doc(id);const prior=(await ref.get()).data;
  if(event.version!==(prior?.version||0))return {errMsg:'另一管理员已修改，请刷新后重试'};
  await ref.set({data:{routeId:event.routeId,status:event.status,sourceUrl:source.href,summary:event.summary,riskNotice:event.riskNotice,checkedAt:new Date(checkedAt).toISOString(),expiresAt,updatedAt:Date.now(),track,reviewedBy:OPENID,version:(prior?.version||0)+1}});return {saved:true,version:(prior?.version||0)+1};});
};
