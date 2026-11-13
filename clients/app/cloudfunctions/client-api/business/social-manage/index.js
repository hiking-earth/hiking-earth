const cloud=require('wx-server-sdk');const crypto=require('crypto');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});const db=cloud.database({throwOnNotFound:false});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const text=(v,max)=>typeof v==='string' && v.trim().length>0 && v.length<=max;
const isOwnerAdmin=require('../owner-admin').isOwnerAdmin;
const taobaoSource=require('./taobao-source.cjs');
const jdSource=require('./jd-source.cjs');
const GUIDE_CATEGORIES=['鞋靴','背包','服装','露营','导航','应急','其他'];
const GUIDE_MAX_REVIEW_MS=90*24*60*60*1000;
async function expirePublishedGuides(){
 const now=Date.now();
 const published=(await db.collection('guide_items').where({published:true}).limit(200).get()).data||[];
 const expired=published.filter(row=>!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=now);
 for(const row of expired){
  if(typeof row._id!=='string'||!Number.isInteger(row.version))continue;
  await db.runTransaction(async tx=>{
   const ref=tx.collection('guide_items').doc(row._id),latest=(await ref.get()).data;
   if(!latest||latest.published!==true||(Number.isSafeInteger(latest.expiresAt)&&latest.expiresAt>Date.now())||latest.version!==row.version)return;
   await ref.update({data:{published:false,candidateStatus:'expired',expiredPublished:true,version:latest.version+1,updatedAt:Date.now()}});
  });
 }
 const candidates=(await db.collection('guide_items').where({published:false,candidateStatus:'needs_review'}).orderBy('expiresAt','asc').limit(20).get()).data||[];
 for(const row of candidates){
  if(typeof row._id!=='string'||!Number.isInteger(row.version))continue;
  if(Number.isSafeInteger(row.expiresAt)&&row.expiresAt>now)continue;
  await db.runTransaction(async tx=>{
   const ref=tx.collection('guide_items').doc(row._id),latest=(await ref.get()).data;
   if(!latest||latest.published!==false||latest.candidateStatus!=='needs_review'||latest.version!==row.version||(Number.isSafeInteger(latest.expiresAt)&&latest.expiresAt>Date.now()))return;
   await ref.update({data:{candidateStatus:'expired',expiredPublished:false,version:latest.version+1,updatedAt:Date.now()}});
  });
 }
 return {publishedExpired:expired.length,candidatesExpired:candidates.length};
}
async function member(teamId,identity,tx=db){
  const team=(await tx.collection('teams').doc(teamId).get()).data;
  const rows=(await tx.collection('team_members').where({teamId,openid:identity}).limit(1).get()).data;
  if(!team?.active || !rows.length)throw new Error('已不在有效队伍中');return team;
}
exports.main=async (event,context={})=>{
 const OPENID = require('../../identity').currentIdentity();if(!OPENID)return {errMsg:'请先登录'};
 try {
  const action=String(event.action||'');const page=Number.isInteger(event.page)&&event.page>=0&&event.page<=1000?event.page:0;
  if(action==='guides.list'){
   if(!isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
   await expirePublishedGuides();
   const rows=(await db.collection('guide_items').orderBy('_id','asc').skip(page*20).limit(20).get()).data;
   return {items:rows.map(row=>({_id:row._id,title:typeof row.title==='string'?row.title:'',summary:typeof row.summary==='string'?row.summary:'',category:GUIDE_CATEGORIES.includes(row.category)?row.category:'其他',legacyCategory:!GUIDE_CATEGORIES.includes(row.category),link:typeof row.link==='string'?row.link:'',priceHint:typeof row.priceHint==='string'?row.priceHint:'',sourceUrl:typeof row.sourceUrl==='string'?row.sourceUrl:'',sourcePlatform:['taobao','jd','pdd','xianyu','other'].includes(row.sourcePlatform)?row.sourcePlatform:'unknown',expiresAt:Number.isSafeInteger(row.expiresAt)?row.expiresAt:null,candidateStatus:row.candidateStatus==='expired'?'expired':'',expiredPublished:row.expiredPublished===true,rightsNote:typeof row.rightsNote==='string'?row.rightsNote:'',rightsConfirmed:row.rightsConfirmed===true,published:row.published===true,version:row.version===undefined?0:row.version})),hasMore:rows.length===20};
  }
  if(action==='guides.taobao.search'){
   if(!isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
   if(!text(event.keyword,80)||!GUIDE_CATEGORIES.includes(event.category))return {errMsg:'请填写搜索词并选择有效分类'};
   if(!taobaoSource.configured())return {errMsg:'淘宝联盟搜索尚未配置；请在 CloudBase 云函数环境配置官方应用密钥和推广位，并申请商品查询接口权限'};
   const day=new Date().toISOString().slice(0,10);
   const quotaId=hash(`guide-taobao-search:${OPENID}:${day}`);
   const quota=await db.runTransaction(async tx=>{
    const ref=tx.collection('client_rate_limits').doc(quotaId);const prior=(await ref.get()).data;
    if((prior?.count||0)>=10)return false;
    await ref.set({data:{count:(prior?.count||0)+1,expiresAt:Date.now()+2*86400000}});return true;
   });
   if(!quota)return {errMsg:'今日官方商品搜索次数已达上限，请明天再试'};
   const candidates=await taobaoSource.search(event.keyword.trim());let created=0;
   for(const candidate of candidates){
    const inserted=await db.runTransaction(async tx=>{
     const ref=tx.collection('guide_items').doc(candidate.id);const prior=(await ref.get()).data;
     if(prior)return false;
     await ref.set({data:{title:candidate.title,summary:candidate.summary,category:event.category,link:candidate.link,sourceUrl:candidate.sourceUrl,sourcePlatform:'taobao',priceHint:candidate.priceHint,expiresAt:Date.now()+7*86400000,rightsNote:'淘宝联盟官方 API 搜索候选，商品状态、内容使用范围与公开推广授权待管理员人工核验。',rightsConfirmed:false,published:false,candidateStatus:'needs_review',version:1,createdAt:Date.now(),updatedAt:Date.now(),updatedBy:OPENID}});
     return true;
    });
    if(inserted)created++;
   }
   return {searched:candidates.length,created,skipped:candidates.length-created,rightsConfirmed:false,published:false};
  }
  if(action==='guides.jd.search'){
   if(!isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
   if(!text(event.keyword,80)||!GUIDE_CATEGORIES.includes(event.category))return {errMsg:'请填写搜索词并选择有效分类'};
   if(!jdSource.configured())return {errMsg:'京东联盟搜索尚未配置；请在 CloudBase 云函数环境配置官方应用密钥、网站/媒体 ID 和推广位，并申请商品查询与推广链接接口权限'};
   const day=new Date().toISOString().slice(0,10),quotaId=hash(`guide-jd-search:${OPENID}:${day}`);
   const quota=await db.runTransaction(async tx=>{
    const ref=tx.collection('client_rate_limits').doc(quotaId),prior=(await ref.get()).data;
    if((prior?.count||0)>=10)return false;
    await ref.set({data:{count:(prior?.count||0)+1,expiresAt:Date.now()+2*86400000}});return true;
   });
   if(!quota)return {errMsg:'今日京东联盟商品搜索次数已达上限，请明天再试'};
   const candidates=await jdSource.search(event.keyword.trim());let created=0;
   for(const candidate of candidates){
    const inserted=await db.runTransaction(async tx=>{
     const ref=tx.collection('guide_items').doc(candidate.id),prior=(await ref.get()).data;
     if(prior)return false;
     await ref.set({data:{title:candidate.title,summary:candidate.summary,category:event.category,link:candidate.link,sourceUrl:candidate.sourceUrl,sourcePlatform:'jd',priceHint:candidate.priceHint,expiresAt:Date.now()+7*86400000,rightsNote:'京东联盟官方 API 搜索候选，商品状态、内容使用范围与公开推广授权待管理员人工核验。',rightsConfirmed:false,published:false,candidateStatus:'needs_review',version:1,createdAt:Date.now(),updatedAt:Date.now(),updatedBy:OPENID}});
     return true;
    });
    if(inserted)created++;
   }
   return {searched:candidates.length,created,skipped:candidates.length-created,rightsConfirmed:false,published:false};
  }
  if(action==='guides.unpublish'){
   if(!isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
   if(!text(event.id,128)||!Number.isInteger(event.version)||event.version<0)return {errMsg:'条目或版本无效'};
   return db.runTransaction(async tx=>{
    const ref=tx.collection('guide_items').doc(event.id);const prior=(await ref.get()).data;
    if(!prior||event.version!==(prior.version||0))return {errMsg:'条目已变化，请刷新后重试'};
    const version=event.version+1;
    await ref.update({data:{published:false,version,updatedAt:Date.now(),updatedBy:OPENID}});
    return {saved:true,id:event.id,version};
   });
  }
  if(action==='guides.save'){
   if(!isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
   if(!text(event.id,128)||!/^[a-zA-Z0-9_-]+$/.test(event.id)||!text(event.title,200)||typeof event.summary!=='string'||event.summary.length>2000||!['鞋靴','背包','服装','露营','导航','应急','其他'].includes(event.category)||typeof event.published!=='boolean'||typeof event.rightsConfirmed!=='boolean'||typeof event.rightsNote!=='string'||event.rightsNote.length>1000||typeof event.priceHint!=='string'||event.priceHint.length>100||!['taobao','jd','pdd','xianyu','other','unknown'].includes(event.sourcePlatform||'unknown')||(event.expiresAt!==null&&event.expiresAt!==undefined&&(!Number.isSafeInteger(event.expiresAt)||event.expiresAt<0))||!Number.isInteger(event.version)||event.version<0)return {errMsg:'导购资料格式无效'};
   if(event.published&&(!Number.isSafeInteger(event.expiresAt)||event.expiresAt<=Date.now()||event.expiresAt>Date.now()+GUIDE_MAX_REVIEW_MS))return {errMsg:'公开条目必须设置未来90天内的到期时间'};
   let link,source;try{link=new URL(event.link);source=new URL(event.sourceUrl);}catch{return {errMsg:'需要有效商品链接和归属来源链接'};}
   const valid=url=>url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443');
   if(!valid(link)||!valid(source)||event.link.length>2048||event.sourceUrl.length>2048||(event.rightsConfirmed&&!text(event.rightsNote,1000))||(event.published&&(!event.rightsConfirmed||!text(event.rightsNote,1000))))return {errMsg:'发布前必须确认链接使用权并记录归属来源'};
   return db.runTransaction(async tx=>{
    const ref=tx.collection('guide_items').doc(event.id);const prior=(await ref.get()).data;
    if(event.version!==(prior?.version||0))return {errMsg:'另一管理员已修改，请刷新后重试'};
    const version=event.version+1;
    await ref.set({data:{title:event.title.trim(),summary:event.summary.trim(),category:event.category,link:link.href,sourceUrl:source.href,sourcePlatform:event.sourcePlatform||'unknown',...(event.expiresAt?{expiresAt:event.expiresAt}:{expiresAt:null}),rightsNote:event.rightsNote.trim(),rightsConfirmed:event.rightsConfirmed,published:event.published,version,createdAt:prior?.createdAt||Date.now(),updatedAt:Date.now(),updatedBy:OPENID}});
    return {saved:true,id:event.id,version};
   });
  }
  if(action==='comments.list'){
   if(!text(event.routeId,128))return {errMsg:'路线无效'};
   const rows=(await db.collection('user_documents').where({kind:'comment',routeId:event.routeId,status:'approved'}).orderBy('updatedAt','desc').skip(page*20).limit(20).field({body:true,nickname:true,updatedAt:true,routeId:true}).get()).data;
   return {items:rows,hasMore:rows.length===20};
  }
  if(action==='diaries.list'){
   const query=event.public?{kind:'diary',visibility:'public',status:'approved'}:{kind:'diary',owner:OPENID};
   const rows=(await db.collection('user_documents').where(query).orderBy('updatedAt','desc').skip(page*20).limit(20).get()).data;
   return {items:rows.map(({owner,reviewedBy,...row})=>({...row,mine:owner===OPENID})),hasMore:rows.length===20};
  }
  if(action==='comments.create'||action==='diaries.save'){
   if(!text(event.id,128)||!text(event.routeId,128)||!text(event.body,5000))return {errMsg:'内容或路线格式无效'};
   const kind=action==='comments.create'?'comment':'diary';const id=hash(`${OPENID}:${kind}:${event.id}`);
   const visibility=kind==='comment'?'public':event.visibility==='public'?'public':'private';
   let machineReviewStatus=visibility==='public'?'manual':'not-required';
   if(visibility==='public'){
    if(Array.from(event.body.trim()).length>2500)return {errMsg:'公开内容最多2500字，请缩短后再提交'};
    const wechatOpenId=context.verifiedWechatOpenId;
    if(typeof wechatOpenId==='string'&&wechatOpenId)try{
     const check=await cloud.openapi.security.msgSecCheck({openid:wechatOpenId,scene:kind==='comment'?2:4,version:2,content:event.body.trim()});
     if(!check||check.errCode!==0)return {errMsg:'内容未通过微信文本安全检查，未提交'};
     const suggest=check.result?.suggest;if(!['pass','review'].includes(suggest))return {errMsg:'内容未通过微信文本安全检查，未提交'};machineReviewStatus=suggest;
    }catch{return {errMsg:'微信文本安全检查暂不可用，内容未提交'};}
   }
   return db.runTransaction(async tx=>{
    const ref=tx.collection('user_documents').doc(id);const prior=(await ref.get()).data;
    const version=prior?.version||0;if(event.version!==version)return {errMsg:'另一端已修改，请刷新后重试'};
    await ref.set({data:{owner:OPENID,kind,clientId:event.id,routeId:event.routeId,title:String(event.title||'').slice(0,100),body:event.body.trim(),nickname:String(event.nickname||'徒步用户').slice(0,40),visibility,status:visibility==='public'?'pending':'private',...(visibility==='public'?{machineReviewStatus}:{}),checkedIn:!!event.checkedIn,version:version+1,createdAt:prior?.createdAt||Date.now(),updatedAt:Date.now()}});
    return {id,version:version+1,status:visibility==='public'?'pending':'private'};
   });
  }
  if(action==='documents.remove'){
   if(!text(event.id,128))return {errMsg:'记录无效'};
   return db.runTransaction(async tx=>{const ref=tx.collection('user_documents').doc(event.id);const row=(await ref.get()).data;if(!row)return {deleted:true,alreadyDeleted:true};if(row.owner!==OPENID||!['diary','comment'].includes(row.kind))return {errMsg:'无权删除记录'};await ref.remove();return {deleted:true};});
  }
  if(action==='messages.list'){
   if(!text(event.teamId,128))return {errMsg:'队伍无效'};await member(event.teamId,OPENID);
   const rows=(await db.collection('team_messages').where({teamId:event.teamId}).orderBy('createdAt','desc').skip(page*30).limit(30).get()).data;
   // Re-check membership after the read so revoked members do not receive a fresh page.
   await member(event.teamId,OPENID);
   const visible=rows.filter(row=>!['pending','rejected'].includes(row.status)||row.owner===OPENID);
   return {items:visible.map(({owner,reviewedBy,...row})=>({...row,mine:owner===OPENID})),hasMore:rows.length===30};
  }
  if(action==='messages.send'){
   if(!text(event.teamId,128)||!text(event.id,128)||!text(event.body,1000))return {errMsg:'消息格式无效'};
   await member(event.teamId,OPENID);
   const messageId=hash(`${OPENID}:${event.teamId}:${event.id}`);
   const existing=(await db.collection('team_messages').doc(messageId).get()).data;
   if(existing)return {sent:true,reviewPending:existing.status==='pending'};
   const body=event.body.trim();let status='approved';let machineReviewStatus='pass';
   const wechatOpenId=context.verifiedWechatOpenId;
   if(typeof wechatOpenId!=='string'||!wechatOpenId){status='pending';machineReviewStatus='manual';}
   else try{const check=await cloud.openapi.security.msgSecCheck({openid:wechatOpenId,scene:3,version:2,content:body});if(!check||check.errCode!==0)return {errMsg:'消息未通过微信内容安全检测，未发送'};const suggest=check.result?.suggest;if(suggest==='review'){status='pending';machineReviewStatus='review';}else if(suggest==='pass')machineReviewStatus='pass';else return {errMsg:'消息未通过微信内容安全检测，未发送'};}
   catch{return {errMsg:'消息未通过微信内容安全检测，未发送'};}
   return db.runTransaction(async tx=>{
    await member(event.teamId,OPENID,tx);
    const ref=tx.collection('team_messages').doc(messageId);
    const prior=(await ref.get()).data;if(prior)return {sent:true,reviewPending:prior.status==='pending'};
    const window=Math.floor(Date.now()/60000);const limitRef=tx.collection('client_rate_limits').doc(hash(`chat:${OPENID}:${window}`));
    const rate=(await limitRef.get()).data;if((rate?.count||0)>=30)return {errMsg:'发送过于频繁，请稍后重试'};
    await limitRef.set({data:{count:(rate?.count||0)+1,expiresAt:Date.now()+120000}});
    await ref.set({data:{owner:OPENID,teamId:event.teamId,body,nickname:String(event.nickname||'徒步用户').slice(0,40),createdAt:Date.now(),status,machineReviewStatus,version:1}});
    return {sent:true,reviewPending:status==='pending'};
   });
  }
  if(action==='notifications.list'){
   const rows=(await db.collection('user_notifications').where({owner:OPENID}).orderBy('createdAt','desc').skip(page*20).limit(20).get()).data;return {items:rows,hasMore:rows.length===20};
  }
  if(action==='notifications.read'){
   if(!text(event.id,128))return {errMsg:'通知无效'};
   return db.runTransaction(async tx=>{const ref=tx.collection('user_notifications').doc(event.id);const row=(await ref.get()).data;if(!row||row.owner!==OPENID)return {errMsg:'通知无效'};if(row.read===true)return {updated:true,alreadyRead:true};await ref.update({data:{read:true}});return {updated:true};});
  }
  if(action==='moderation.list'){
   if(!isOwnerAdmin(OPENID))return {errMsg:'需要管理员权限'};
   const cursor=event.cursor===undefined?{documents:0,messages:0}:event.cursor;
   if(!cursor||typeof cursor!=='object'||Array.isArray(cursor)||!Number.isInteger(cursor.documents)||cursor.documents<0||cursor.documents>20000||!Number.isInteger(cursor.messages)||cursor.messages<0||cursor.messages>20000)return {errMsg:'审核队列游标无效，请刷新后重试'};
   const [documents,messages]=await Promise.all([
    db.collection('user_documents').where({status:'pending',visibility:'public'}).orderBy('updatedAt','asc').skip(cursor.documents).limit(21).get(),
    db.collection('team_messages').where({status:'pending'}).orderBy('createdAt','asc').skip(cursor.messages).limit(21).get(),
   ]);
   const documentRows=documents.data||[],messageRows=messages.data||[];
   const queueTime=row=>Number.isFinite(row.updatedAt)?row.updatedAt:Number.isFinite(row.createdAt)?row.createdAt:0;
   const rows=[...documentRows.map(row=>({...row,reviewKind:'document',_queueTime:queueTime(row)})),...messageRows.map(row=>({...row,title:`队聊待审 · ${row.teamId}`,updatedAt:row.createdAt,version:Number.isInteger(row.version)?row.version:0,reviewKind:'team-message',_queueTime:queueTime(row)}))].sort((a,b)=>a._queueTime-b._queueTime||String(a._id).localeCompare(String(b._id))||a.reviewKind.localeCompare(b.reviewKind));
   const items=rows.slice(0,20).map(({_queueTime,...row})=>row);
   const consumedDocuments=items.filter(row=>row.reviewKind==='document').length,consumedMessages=items.length-consumedDocuments;
   return {items,nextCursor:{documents:cursor.documents+consumedDocuments,messages:cursor.messages+consumedMessages},hasMore:documentRows.length>consumedDocuments||messageRows.length>consumedMessages};
  }
  if(action==='moderation.decide'){
   if(!isOwnerAdmin(OPENID)||!text(event.id,128)||!['approve','reject'].includes(event.decision))return {errMsg:'无效审核操作'};
   const teamMessage=event.reviewKind==='team-message';if(event.reviewKind!==undefined&&!['document','team-message'].includes(event.reviewKind))return {errMsg:'审核内容类型无效'};
   return db.runTransaction(async tx=>{
    const ref=tx.collection(teamMessage?'team_messages':'user_documents').doc(event.id);const row=(await ref.get()).data;
    if(!row||row.status!=='pending'||(!teamMessage&&row.visibility!=='public')||event.version!==row.version)return {errMsg:'内容已变化，请刷新后审核'};
    const status=event.decision==='approve'?'approved':'rejected';
    await ref.update({data:{status,version:(row.version||0)+1,reviewedBy:OPENID,reviewedAt:Date.now()}});
    await tx.collection('user_notifications').doc(hash(`${teamMessage?'chat-review':'review'}:${event.id}:${row.version||0}`)).set({data:{owner:row.owner,title:teamMessage?(status==='approved'?'队聊消息审核通过':'队聊消息未通过审核'):(status==='approved'?'内容审核通过':'内容未通过审核'),...(teamMessage?{teamId:row.teamId}:{documentId:event.id}),read:false,createdAt:Date.now()}});
    return {reviewed:true};
   });
  }
  return {errMsg:'操作无效'};
 }catch(error){return {errMsg:error.message||'操作失败'};}
};
