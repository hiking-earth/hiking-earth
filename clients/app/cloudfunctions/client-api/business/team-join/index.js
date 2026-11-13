const cloud = require('wx-server-sdk');
const { createHash } = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: '请先登录' };
  if (typeof event.inviteCode !== 'string' || !/^\d{6}$/.test(event.inviteCode)) return { errMsg: '请输入六位数字邀请码' };
  const found = await db.collection('teams').where({ inviteCode: event.inviteCode, active: true }).limit(1).get();
  if (!found.data.length) return { errMsg: '邀请码无效' };
  const team = found.data[0];
  const legacy = await db.collection('team_members').where({ teamId: team._id, openid: OPENID }).limit(1).get();
  if (!legacy.data.length) {
    const memberId = createHash('sha256').update(JSON.stringify([team._id, OPENID])).digest('hex');
    const oldCount = Number.isFinite(team.memberCount) ? team.memberCount : (await db.collection('team_members').where({ teamId: team._id }).count()).total;
    let error = '';
    await db.runTransaction(async tx => {
      error = '';
      const current = (await tx.collection('teams').doc(team._id).get()).data;
      if (!current || !current.active) { error = '队伍已关闭'; return; }
      if ((await tx.collection('team_members').doc(memberId).get()).data) return;
      const count = Number.isFinite(current.memberCount) ? current.memberCount : oldCount;
      if (count >= 100) { error = '队伍人数已达 100 人上限'; return; }
      await tx.collection('team_members').doc(memberId).set({ data: { teamId: team._id, openid: OPENID, nickname: String(event.nickname || '山友').slice(0, 24), latitude: null, longitude: null, updatedAt: 0, joinedAt: Date.now(), isLeader: false } });
      await tx.collection('teams').doc(team._id).update({ data: { memberCount: count + 1 } });
    });
    if (error) return { errMsg: error };
  }
  return { team: { id: team._id, name: team.name, inviteCode: team.inviteCode, createdBy: team.createdBy, createdAt: team.createdAt, active: true } };
};
