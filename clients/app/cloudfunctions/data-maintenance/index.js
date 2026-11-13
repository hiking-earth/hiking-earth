// Trusted scheduled retention; not exposed by the public account gateway.
const cloud=require('wx-server-sdk');cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database({throwOnNotFound:false});
exports.main=async event=>{
 const context=cloud.getWXContext();
 if(context.OPENID||event.Type!=='Timer')return {errMsg:'仅定时任务可执行'};
 const now=Date.now();let removed=0,postponed=0,closedCompanionPosts=0,removedSosEvents=0;
 const today=new Date(now+8*60*60*1000).toISOString().slice(0,10);
 for(const collection of ['client_sessions','client_rate_limits','client_qr_logins','client_wechat_tickets']){
  const rows=(await db.collection(collection).where({expiresAt:db.command.lte(now)}).limit(100).get()).data;
  for(const row of rows)await db.runTransaction(async tx=>{const ref=tx.collection(collection).doc(row._id);const live=(await ref.get()).data;if(live&&Number.isFinite(live.expiresAt)&&live.expiresAt<=now){await ref.remove();removed++;}});
 }
 // Older phone throttles used resetAt but had no expiresAt, so the regular
 // TTL query above could never find them. Retire only expired legacy rows.
 const legacyRateLimits=(await db.collection('client_rate_limits')
  .where({resetAt:db.command.lte(now)}).limit(100).get()).data;
 for(const row of legacyRateLimits)await db.runTransaction(async tx=>{
  const ref=tx.collection('client_rate_limits').doc(row._id);const live=(await ref.get()).data;
  if(!live||!Number.isFinite(live.resetAt)||live.resetAt>now)return;
  if(Number.isFinite(live.expiresAt)&&live.expiresAt>now)return;
  await ref.remove();removed++;
 });
 const rows=(await db.collection('user_documents').where({kind:'registration',expiresAt:db.command.lte(now)}).limit(100).get()).data;
 for(const row of rows)await db.runTransaction(async tx=>{
  const ref=tx.collection('user_documents').doc(row._id);const live=(await ref.get()).data;
  if(!live||live.kind!=='registration'||!Number.isFinite(live.expiresAt)||live.expiresAt>now)return;
  const post=(await tx.collection('companion_posts').doc(live.postId).get()).data;
  const deadline=post?Date.parse(post.departDate+'T23:59:59+08:00')+30*86400000:0;
  if(post&&!['deleted','hidden','deleting'].includes(post.status)&&Number.isFinite(deadline)&&deadline>now){await ref.update({data:{expiresAt:deadline}});postponed++;return;}
  await ref.remove();removed++;
 });
 const warnings=[];
 try {
  // SOS coordinates and messages are short-lived emergency data. The
  // triggeredAt cutoff also covers legacy rows that predate this retention job.
  const cutoff=now-24*60*60*1000;
  const expiredSos=(await db.collection('sos_events').where({triggeredAt:db.command.lte(cutoff)}).limit(100).get()).data;
  for(const row of expiredSos)await db.runTransaction(async tx=>{
   const ref=tx.collection('sos_events').doc(row._id);const live=(await ref.get()).data;
   if(!live||!Number.isFinite(live.triggeredAt)||live.triggeredAt>cutoff)return;
   await ref.remove();removedSosEvents++;
  });
 } catch(error) {
  console.warn('sos-retention-query-unavailable',{code:Number(error?.code)||0});
  warnings.push('sos-retention-query-unavailable');
 }
 try {
  // A hike can no longer accept sign-ups after its departure date. Close
  // lingering open/full posts in bounded batches while retaining their history.
  const expiredPosts=(await db.collection('companion_posts').where({
   status:db.command.in(['open','full']),departDate:db.command.lt(today),
  }).orderBy('departDate','asc').limit(100).get()).data;
  for(const post of expiredPosts)await db.runTransaction(async tx=>{
   const ref=tx.collection('companion_posts').doc(post._id);const live=(await ref.get()).data;
   if(!live||!['open','full'].includes(live.status)||typeof live.departDate!=='string'||live.departDate>=today)return;
   await ref.update({data:{status:'closed',closedAt:now,closeReason:'departure-date-passed',updatedAt:now}});
   closedCompanionPosts++;
  });
 } catch(error) {
  // A missing compound index must not prevent expired emergency contacts
  // and sessions from being removed earlier in this maintenance run.
  console.warn('expired companion closure query unavailable',{code:Number(error?.code)||0});
  warnings.push('companion-post-closure-query-unavailable');
 }
 return {removed,removedSosEvents,postponed,closedCompanionPosts,warnings,checkedAt:now};
};
