const cloud = require('wx-server-sdk');
const { randomInt, createHash } = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: '请先登录' };
  if(event.requestId!==undefined&&(typeof event.requestId!=='string'||!/^team-[a-zA-Z0-9-]{1,100}$/.test(event.requestId)))return {errMsg:'创建请求标识无效'};
  const requestKey=event.requestId?createHash('sha256').update(JSON.stringify(['team_creation',OPENID,event.requestId])).digest('hex'):null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = String(randomInt(100000, 1000000));
    // 兼容旧版随机文档 ID 的队伍；新版使用邀请码作为唯一文档键。
    const existing = await db.collection('teams').where({ inviteCode }).limit(1).get();
    if (existing.data.length) continue;
    const teamId = `invite-${inviteCode}`;
    const memberId = createHash('sha256').update(JSON.stringify([teamId, OPENID])).digest('hex');
    let collision = false, reply=null;
    await db.runTransaction(async tx => {
      collision = false;reply=null;
      if(requestKey){
        const saved=(await tx.collection('user_documents').doc(requestKey).get()).data;
        if(saved){
          const existingTeam=(await tx.collection('teams').doc(saved.teamId).get()).data;
          const savedMemberId=createHash('sha256').update(JSON.stringify([saved.teamId,OPENID])).digest('hex');
          const membership=(await tx.collection('team_members').doc(savedMemberId).get()).data;
          reply=existingTeam?.active&&membership?{teamId:saved.teamId,inviteCode:existingTeam.inviteCode}:{errMsg:'原创建请求对应队伍已关闭或已退出',code:'TEAM_REQUEST_EXPIRED'};
          return;
        }
      }
      const prior = await tx.collection('teams').doc(teamId).get();
      if (prior.data) { collision = true; return; }
      await tx.collection('teams').doc(teamId).set({ data: { name: String(event.name || '徒步小队').slice(0, 20), inviteCode, createdBy: OPENID, createdAt: Date.now(), active: true, memberCount: 1 } });
      await tx.collection('team_members').doc(memberId).set({ data: { teamId, openid: OPENID, nickname: String(event.nickname || '山友').slice(0, 24), latitude: null, longitude: null, updatedAt: 0, joinedAt: Date.now(), isLeader: true } });
      if(requestKey)await tx.collection('user_documents').doc(requestKey).set({data:{owner:OPENID,kind:'team_creation',requestId:event.requestId,teamId,createdAt:Date.now()}});
    });
    if(reply)return reply;
    if (!collision) return { teamId, inviteCode };
  }
  return { errMsg: '邀请码生成繁忙，请重试' };
};
