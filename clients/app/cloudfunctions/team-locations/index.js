// team-locations：查询全队成员最新位置（仅同队成员可调）
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { errMsg: "请先在微信小程序登录" };
  const { teamId } = event;
  if (typeof teamId !== "string" || !teamId) return { errMsg: "队伍无效" };
  const team = (await db.collection("teams").doc(teamId).get()).data;
  if (!team || !team.active) return { errMsg: "队伍已解散", inactive: true };
  // 校验调用者是本队成员
  const me = await db.collection("team_members").where({ teamId, openid: OPENID }).limit(1).get();
  if (me.data.length === 0) return { errMsg: "不是本队成员", inactive: true };
  const res = await db.collection("team_members").where({ teamId }).limit(100).get();
  const alerts = await db.collection("sos_events").where({ teamId, status: "active", triggeredAt: db.command.gt(Date.now() - 60 * 60 * 1000) }).orderBy("triggeredAt", "desc").limit(10).get();
  return {
    team: { id: teamId, name: team.name, createdBy: team.createdBy, inviteCode: team.inviteCode, active: team.active, createdAt: team.createdAt },
    alerts: alerts.data.map(a => ({ id: a._id, openid: a.openid, message: a.message, triggeredAt: a.triggeredAt })),
    members: res.data.map((m) => ({
      teamId: m.teamId,
      openid: m.openid,
      nickname: m.nickname,
      latitude: Date.now() - m.updatedAt <= 60000 ? m.latitude : null,
      longitude: Date.now() - m.updatedAt <= 60000 ? m.longitude : null,
      updatedAt: m.updatedAt,
      isLeader: m.isLeader,
    })),
  };
};
