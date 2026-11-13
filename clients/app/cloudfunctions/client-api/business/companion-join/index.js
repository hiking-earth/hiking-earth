const cloud=require('wx-server-sdk');const crypto=require('crypto');cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});const db=cloud.database({throwOnNotFound:false});
exports.main=async event=>{const OPENID = require('../../identity').currentIdentity();if(!OPENID)return {errMsg:'请先登录'};if(typeof event.postId!=='string'||!event.postId)return {errMsg:'帖子无效'};
 const birth=String(event.birth||'');const birthday=new Date(birth+'T00:00:00Z');const now=new Date();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||Number.isNaN(birthday.getTime())||birthday.toISOString().slice(0,10)!==birth||birthday>now||now.getUTCFullYear()-birthday.getUTCFullYear()>120)return {errMsg:'请填写有效出生日期，仅用于本次年龄判断'};
 let age=now.getUTCFullYear()-birthday.getUTCFullYear();if(now.getUTCMonth()<birthday.getUTCMonth()||(now.getUTCMonth()===birthday.getUTCMonth()&&now.getUTCDate()<birthday.getUTCDate()))age--;
 if(age<18&&event.guardianConfirmed!==true)return {errMsg:'未成年人须由监护人填写并确认报名'};
 if(typeof event.emergency!=='string'||event.emergency.trim().length<5||event.emergency.length>200||event.contactConsent!==true)return {errMsg:'请填写紧急联系人并同意向发起人提供'};
 return db.runTransaction(async tx=>{const ref=tx.collection('companion_posts').doc(event.postId);const post=(await ref.get()).data;if(!post)return {errMsg:'帖子不存在'};if(!['open','full'].includes(post.status))return {errMsg:'报名已关闭'};
 const departureEnd=typeof post.departDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(post.departDate)?Date.parse(post.departDate+'T23:59:59+08:00'):NaN;
 if(!Number.isFinite(departureEnd)||departureEnd<Date.now())return {errMsg:'出发日期无效或已过，报名已关闭'};
 if(post.routeId){const review=(await tx.collection('route_reviews').doc(crypto.createHash('sha256').update(post.routeId).digest('hex')).get()).data;if(!review||review.status!=='开放中'||!Number.isFinite(review.expiresAt)||review.expiresAt<=Date.now())return {errMsg:'关联路线开放核验已失效，暂停报名'};}
 if(post.members.includes(OPENID))return {joined:true};if(post.members.length>=post.maxMembers)return {errMsg:'已满员'};
 const members=[...post.members,OPENID];await ref.update({data:{members,status:members.length>=post.maxMembers?'full':'open',_members_count:members.length,joinVersion:(post.joinVersion||0)+1}});
 const id=crypto.createHash('sha256').update(`${OPENID}:registration:${event.postId}`).digest('hex');await tx.collection('user_documents').doc(id).set({data:{owner:OPENID,kind:'registration',nickname:String(event.nickname||'山友').slice(0,40),postId:event.postId,adult:age>=18,guardianConfirmed:age<18&&event.guardianConfirmed===true,emergency:event.emergency.trim(),expiresAt:Date.parse(post.departDate+'T23:59:59+08:00')+30*86400000,createdAt:Date.now()}});
 if(typeof post.openid==='string'&&post.openid&&post.openid!==OPENID){const notificationId=crypto.createHash('sha256').update(`companion-registration:${event.postId}:${OPENID}`).digest('hex');await tx.collection('user_notifications').doc(notificationId).set({data:{owner:post.openid,type:'companion-registration',title:'你的约伴活动有新报名',postId:event.postId,read:false,createdAt:Date.now()}});}
 return {joined:true};});
};
