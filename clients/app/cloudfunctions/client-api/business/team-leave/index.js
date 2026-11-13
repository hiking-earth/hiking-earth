const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: '请先登录' };
  if (typeof event.teamId !== 'string' || !event.teamId) return { errMsg: '队伍无效' };
  const currentTeam = (await db.collection('teams').doc(event.teamId).get()).data;
  if (currentTeam?.active && currentTeam.createdBy === OPENID) return { errMsg: '队长请先移交队长或解散队伍' };
  // 查询只取得自己的文档 ID，事务内重新检查；兼容旧版重复成员记录。
  const mine = (await db.collection('team_members').where({ teamId: event.teamId, openid: OPENID }).limit(100).get()).data;
  for (const member of mine) {
    await db.runTransaction(async tx => {
      const doc = tx.collection('team_members').doc(member._id);
      if (!(await doc.get()).data) return;
      const team = (await tx.collection('teams').doc(event.teamId).get()).data;
      if (team?.active && team.createdBy === OPENID) throw new Error('队长请先移交队长或解散队伍');
      await doc.remove();
      if (team && Number.isFinite(team.memberCount)) await tx.collection('teams').doc(event.teamId).update({ data: { memberCount: Math.max(0, team.memberCount - 1) } });
    });
  }
  return { left: true };
};
