const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { errMsg: '请先登录' };
  if (typeof event.postId !== 'string' || !event.postId) return { errMsg: '帖子无效' };
  const actions = ['registrations', 'leave', 'close', 'reopen', 'delete', 'edit'];
  if (!actions.includes(event.action)) return { errMsg: '操作无效' };
  if(event.action==='registrations'){const post=(await db.collection('companion_posts').doc(event.postId).get()).data;if(!post||post.openid!==OPENID||['hidden','deleted','deleting'].includes(post.status)||Date.parse(post.departDate+'T23:59:59+08:00')+30*86400000<Date.now())return {errMsg:'仅发起人在有效活动中可查看报名联系信息'};const rows=(await db.collection('user_documents').where({kind:'registration',postId:event.postId}).limit(50).get()).data;return {items:rows.map(({owner,...r})=>({id:r._id,nickname:r.nickname,adult:r.adult,guardianConfirmed:r.guardianConfirmed,emergency:r.emergency,createdAt:r.createdAt}))};}
  let edits;let reviewPending=false;
  if (event.action === 'edit') {
    const { title, content, departDate, maxMembers } = event;
    if (typeof title !== 'string' || !title.trim() || title.length > 60 || typeof content !== 'string' || !content.trim() || content.length > 1000) return { errMsg: '标题和内容长度不符合要求' };
    if (typeof departDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(departDate) || Number.isNaN(Date.parse(departDate)) || new Date(departDate).toISOString().slice(0, 10) !== departDate) return { errMsg: '出发日期无效' };
    if (Date.parse(departDate+'T23:59:59+08:00') < Date.now()) return { errMsg: '出发日期已过，请选择未来日期' };
    if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 50) return { errMsg: '人数须为2–50的整数' };
    const prior = (await db.collection('companion_posts').doc(event.postId).get()).data;
    if (!prior || prior.openid !== OPENID) return { errMsg: '只能编辑自己发布的帖子' };
    if (!OPENID.startsWith('account:')) try { const check=await cloud.openapi.security.msgSecCheck({ openid:OPENID,scene:3,version:2,content:`${title}\n${content}` });if(!check||check.errCode!==0)return {errMsg:'内容未通过审核，请修改后再提交'};if(check.result?.suggest==='review')reviewPending=true;else if(check.result?.suggest!=='pass')return {errMsg:'内容未通过审核，请修改后再提交'}; }
    catch { return { errMsg: '内容未通过审核，请修改后再提交' }; }
    else reviewPending=true;
    edits = { title: title.trim(), content: content.trim(), departDate, maxMembers, routeId: String(event.routeId || '').slice(0, 120) };
  }
  return db.runTransaction(async tx => {
    const ref = tx.collection('companion_posts').doc(event.postId);
    const post = (await ref.get()).data;
    if (!post || ['deleted','hidden','deleting'].includes(post.status)) return { errMsg: '帖子已删除或不存在' };
    const members = Array.isArray(post.members) ? post.members : [];
    const owner = post.openid === OPENID;
    const version = (post.joinVersion || 0) + 1;
    if (event.action === 'leave') {
      if (owner) return { errMsg: '发起人请关闭或删除活动' };
      const id=require('crypto').createHash('sha256').update(`${OPENID}:registration:${event.postId}`).digest('hex');
      if(!members.includes(OPENID)){if((await tx.collection('user_documents').doc(id).get()).data)await tx.collection('user_documents').doc(id).remove();return {left:true};}
      const remaining = members.filter(id => id !== OPENID);
      await ref.update({ data: { members: remaining, _members_count: remaining.length, joinVersion: version,
        status: ['closed','pending'].includes(post.status) ? post.status : remaining.length >= post.maxMembers ? 'full' : 'open' } });
      if((await tx.collection('user_documents').doc(id).get()).data)await tx.collection('user_documents').doc(id).remove();
      if(typeof post.openid==='string'&&post.openid&&post.openid!==OPENID){const notificationId=require('crypto').createHash('sha256').update(`companion-cancellation:${event.postId}:${OPENID}:${version}`).digest('hex');await tx.collection('user_notifications').doc(notificationId).set({data:{owner:post.openid,type:'companion-cancellation',title:'有报名人取消了活动报名',postId:event.postId,read:false,createdAt:Date.now()}});}
      return { left: true };
    }
    if (!owner) return { errMsg: '仅发起人可以管理该活动' };
    if (post.status === 'pending' && ['close', 'reopen'].includes(event.action)) return { errMsg: '请等待审核完成，或删除活动' };
    if (event.action === 'edit' && edits.maxMembers < members.length) return { errMsg: '人数上限不能少于已报名人数' };
    if(event.action==='reopen'){const departureEnd=typeof post.departDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(post.departDate)?Date.parse(post.departDate+'T23:59:59+08:00'):NaN;if(!Number.isFinite(departureEnd)||departureEnd<Date.now())return {errMsg:'出发日期无效或已过，请创建新活动'};}
    if (['edit','reopen'].includes(event.action)) {
      const routeId = edits ? edits.routeId : post.routeId;
      if (routeId) {
        const id = require('crypto').createHash('sha256').update(routeId).digest('hex');
        const review = (await tx.collection('route_reviews').doc(id).get()).data;
        if (!review || review.status !== '开放中' || !Number.isFinite(review.expiresAt) || review.expiresAt <= Date.now()) return { errMsg: '关联路线的官方开放核验已失效，请更新核验或取消关联' };
      }
    }
    const status = event.action === 'delete' ? 'deleted' : event.action === 'edit' && (reviewPending || OPENID.startsWith('account:') || post.status === 'pending') ? 'pending' : event.action === 'close' ? 'closed'
      : event.action === 'edit' && post.status === 'closed' ? 'closed'
      : members.length >= (edits?.maxMembers || post.maxMembers) ? 'full' : 'open';
    await ref.update({ data: { ...edits, status, ...(status === 'pending' ? { pendingDesiredStatus: post.status === 'closed' ? 'closed' : post.pendingDesiredStatus || 'open' } : {}), joinVersion: version, updatedAt: Date.now(),
      ...(event.action === 'delete' ? { title: '', content: '', members: [], nickname: '', routeId: '', deletedAt: Date.now() } : {}) } });
    if(event.action==='close'&&post.status!=='closed'){for(const recipient of new Set(members)){if(typeof recipient!=='string'||!recipient||recipient===OPENID)continue;const notificationId=require('crypto').createHash('sha256').update(`companion-closed:${event.postId}:${recipient}:${version}`).digest('hex');await tx.collection('user_notifications').doc(notificationId).set({data:{owner:recipient,type:'companion-closed',title:'发起人已关闭你报名的活动',postId:event.postId,read:false,createdAt:Date.now()}});}}
    if(event.action==='delete'){const rows=(await tx.collection('user_documents').where({kind:'registration',postId:event.postId}).limit(50).get()).data;for(const row of rows)await tx.collection('user_documents').doc(row._id).remove();}
    return { updated: true, status };
  });
};
