const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const notificationId = value => crypto.createHash('sha256').update(value).digest('hex');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!require('./owner-admin').isOwnerAdmin(OPENID)) return { errMsg: '当前账号没有社区管理权限' };
  if (event.action === 'list') {
    const result = await db.collection('community_reports').where({ status: 'pending' }).orderBy('createdAt', 'asc').limit(50).get();
    const reports = [];
    for (const row of result.data) {
      const post = (await db.collection('companion_posts').doc(row.postId).get()).data;
      reports.push({ id: row._id, postId: row.postId, reason: row.reason, createdAt: row.createdAt,
        post: post ? { title: post.title, content: post.content, nickname: post.nickname, status: post.status } : null });
    }
    const pending = (await db.collection('companion_posts').where({ status: 'pending' }).orderBy('createdAt', 'asc').limit(50).get()).data;
    return { reports, posts: pending.map(p => ({ id: p._id, title: p.title, content: p.content, nickname: p.nickname, createdAt: p.createdAt, version: p.joinVersion || 0 })) };
  }
  if (['approve', 'reject'].includes(event.action) && typeof event.postId === 'string') {
    return db.runTransaction(async tx => {
      const ref = tx.collection('companion_posts').doc(event.postId), post = (await ref.get()).data;
      if (!post || post.status !== 'pending' || (post.joinVersion || 0) !== event.version) return { errMsg: '帖子已改变，请刷新' };
      if(event.action==='approve' && post.routeId){const review=(await tx.collection('route_reviews').doc(notificationId(post.routeId)).get()).data;if(!review||review.status!=='开放中'||!Number.isFinite(review.expiresAt)||review.expiresAt<=Date.now())return {errMsg:'关联路线开放核验已失效，请先更新资料或让发起人取消关联'};}
      const status = event.action === 'reject' ? 'hidden' : post.pendingDesiredStatus === 'closed' ? 'closed' : (post.members || []).length >= post.maxMembers ? 'full' : 'open';
      await ref.update({ data: { status, moderatedAt: Date.now(), moderatedBy: OPENID, joinVersion: (post.joinVersion || 0) + 1 } });
      await tx.collection('user_notifications').doc(notificationId(`post-review:${event.postId}:${post.joinVersion||0}`)).set({data:{owner:post.openid,title:event.action==='approve'?'约伴活动审核通过':'约伴活动未通过审核',postId:event.postId,read:false,createdAt:Date.now()}});
      return { handled: true };
    });
  }
  if (!['dismiss', 'hide'].includes(event.action) || typeof event.reportId !== 'string' || !event.reportId) return { errMsg: '操作无效' };
  return db.runTransaction(async tx => {
    const ref = tx.collection('community_reports').doc(event.reportId), report = (await ref.get()).data;
    if (!report) return { errMsg: '举报不存在' };
    if (report.status !== 'pending') return { errMsg: '该举报已经处理，请刷新' };
    if (event.action === 'hide') {
      const postRef = tx.collection('companion_posts').doc(report.postId), post = (await postRef.get()).data;
      if (post) await postRef.update({ data: { status: 'hidden', joinVersion: (post.joinVersion || 0) + 1, moderatedAt: Date.now() } });
    }
    await ref.update({ data: { status: event.action === 'hide' ? 'hidden' : 'dismissed', handledBy: OPENID, handledAt: Date.now() } });
    await tx.collection('user_notifications').doc(notificationId(`report-result:${event.reportId}`)).set({data:{owner:report.reporter,title:event.action==='hide'?'举报已处理，相关活动已隐藏':'举报已处理，未采取隐藏措施',postId:report.postId,read:false,createdAt:Date.now()}});
    return { handled: true };
  });
};
