// 保存求助位置，队内活跃页面通过轮询显示；不连接救援机构或短信通道。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { errMsg: "请先在微信小程序登录" };
  if (event.action === "resolve") {
    await db.collection("sos_events").where({ openid: OPENID, status: "active" }).update({ data: { status: "resolved", resolvedAt: Date.now() } });
    return { resolved: true };
  }
  const { latitude, longitude, message = "" } = event;
  const teamId = typeof event.teamId === "string" ? event.teamId : "";
  if (teamId) {
    const me = await db.collection("team_members").where({ teamId, openid: OPENID }).limit(1).get();
    if (!me.data.length) return { errMsg: "已不在此队伍，未发送队内求助" };
  }
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return { errMsg: "求助坐标无效" };
  const doc = {
    openid: OPENID, teamId,
    latitude, longitude,
    message: String(message).slice(0, 200),
    triggeredAt: Date.now(),
    status: "active",
  };
  const res = await db.collection("sos_events").add({ data: doc });
  return { sosId: res._id, teamAlertCreated: !!teamId };
};
