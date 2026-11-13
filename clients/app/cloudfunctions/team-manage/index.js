const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { errMsg: '请先登录' };
  if (typeof event.teamId !== 'string' || !event.teamId || !['rename', 'transfer', 'remove', 'disband'].includes(event.action)) return { errMsg: '操作无效' };
  const rows = (await db.collection('team_members').where({ teamId: event.teamId }).limit(100).get()).data;
  const name = String(event.name || '').trim().slice(0, 20);
  if (event.action === 'rename' && !name) return { errMsg: '请输入队伍名称' };
  const outcome = await db.runTransaction(async tx => {
    const ref = tx.collection('teams').doc(event.teamId);
    const team = (await ref.get()).data;
    if (!team || !team.active) return { errMsg: '队伍已解散' };
    if (team.createdBy !== OPENID) return { errMsg: '仅队长可以管理队伍' };
    if (event.action === 'rename') { await ref.update({ data: { name } }); return { name }; }
    if (event.action === 'disband') {
      // Close admission first; member location reads and writes reject inactive teams.
      await ref.update({ data: { active: false, closedAt: Date.now() } }); return { disbanded: true };
    }
    if (typeof event.memberId !== 'string' || event.memberId === OPENID) return { errMsg: '请选择其他成员' };
    const targets = rows.filter(m => m.openid === event.memberId);
    if (!targets.length) return { errMsg: '成员已退出，请刷新' };
    const live = [];
    for (const member of targets) {
      const doc = tx.collection('team_members').doc(member._id);
      const current = (await doc.get()).data;
      if (current?.openid === event.memberId && current.teamId === event.teamId) live.push({ doc, current });
    }
    if (!live.length) return { errMsg: '成员已退出，请刷新' };
    if (event.action === 'remove') {
      for (const item of live) await item.doc.remove();
      await ref.update({ data: { memberCount: Math.max(0, (team.memberCount || rows.length) - live.length) } });
      return { removed: true };
    }
    for (const member of rows.filter(m => m.openid === OPENID)) {
      const doc = tx.collection('team_members').doc(member._id);
      if ((await doc.get()).data) await doc.update({ data: { isLeader: false } });
    }
    for (const item of live) await item.doc.update({ data: { isLeader: true } });
    await ref.update({ data: { createdBy: event.memberId } }); return { createdBy: event.memberId };
  });
  if (outcome.disbanded) await db.collection('team_members').where({ teamId: event.teamId }).update({ data: { latitude: null, longitude: null, updatedAt: 0 } });
  return outcome;
};
