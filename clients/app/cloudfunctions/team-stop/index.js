const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { errMsg: "请先登录" };
  if (typeof event.teamId !== "string" || !event.teamId) return { errMsg: "队伍无效" };
  await db.collection("team_members").where({ teamId: event.teamId, openid: OPENID }).update({ data: { latitude: null, longitude: null, updatedAt: 0 } });
  return { stopped: true };
};
