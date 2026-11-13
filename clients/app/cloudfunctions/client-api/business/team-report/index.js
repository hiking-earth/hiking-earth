// team-report：上报我的实时位置（覆盖式更新，不留历史轨迹——个保法最小化）
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });

exports.main = async (event) => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: "请先在微信小程序登录" };
  const { teamId, latitude, longitude } = event;
  if (typeof teamId !== "string" || !teamId || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return { errMsg: "队伍或坐标无效" };
  // Serialize with removal, transfer and disband; stale in-flight reports cannot
  // restore a location after the corresponding membership is removed.
  const members = (await db.collection("team_members").where({ teamId, openid: OPENID }).limit(100).get()).data;
  return db.runTransaction(async tx => {
    const team = (await tx.collection("teams").doc(teamId).get()).data;
    if (!team || !team.active) return { errMsg: "队伍已解散" };
    let updated = 0;
    for (const member of members) {
      const ref = tx.collection("team_members").doc(member._id);
      const current = (await ref.get()).data;
      if (!current || current.openid !== OPENID || current.teamId !== teamId) continue;
      await ref.update({ data: { latitude, longitude, updatedAt: Date.now() } }); updated++;
    }
    return updated ? { updated } : { errMsg: "不在此队伍中，位置未上报" };
  });
};
