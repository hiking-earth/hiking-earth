const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
exports.main = async () => {
  const OPENID = require('../../identity').optionalIdentity();
  const res = await db.collection('companion_posts').where(OPENID ? db.command.or([{ status: db.command.in(['open', 'full', 'closed']) }, { openid: OPENID, status: 'pending' }]) : { status: db.command.in(['open', 'full', 'closed']) }).orderBy('createdAt', 'desc').limit(50).get();
  return { posts: res.data.map(p => ({ id: p._id, openid: p.openid === OPENID ? OPENID : '',
    nickname: p.nickname, routeId: p.routeId, title: p.title, content: p.content,
    departDate: p.departDate, maxMembers: p.maxMembers, memberCount: (p.members || []).length,
    // Public listing never exposes all participants' account identifiers.
    members: OPENID && (p.members || []).includes(OPENID) ? [OPENID] : [],
    createdAt: p.createdAt, status: p.status,
  })) };
};
