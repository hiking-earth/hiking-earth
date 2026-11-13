// track-sync：轨迹云同步（用户手动触发；轨迹属敏感个人信息，仅本人可读）
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });

exports.main = async (event) => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: "请先在微信小程序登录" };
  const { track } = event;
  const expectedVersion=event.expectedVersion===undefined?0:event.expectedVersion;
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)return {errMsg:'云端轨迹版本无效'};
  if (!track || typeof track.id !== "string" || track.id.length > 128 || !track.id || track.state!=='finished'
    || !Array.isArray(track.points) || track.points.length < 2 || track.points.length > 20000
    || !Number.isFinite(track.startedAt)||track.startedAt<=0||!Number.isFinite(track.endedAt)||track.endedAt<track.startedAt) return { errMsg: "轨迹须为有效的已完成轨迹并包含 2 至 20000 个点" };
  const validPoint = p => p && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 && Number.isFinite(p.timestamp) && p.timestamp > 0 && p.timestamp <= 8640000000000000;
  if (!track.points.every(validPoint)) return { errMsg: "轨迹包含无效坐标或时间" };
  const nonNegative = n => Number.isFinite(n) && n >= 0 ? n : 0;
  const points = track.points.map(p => ({ latitude: p.latitude, longitude: p.longitude, timestamp: p.timestamp,
    ...(Number.isFinite(p.altitude) ? { altitude: p.altitude } : {}),
    ...(p.segmentStart ? { segmentStart: true } : {}),
    ...(p.timeEstimated ? { timeEstimated: true } : {}),
  }));
  // 稳定 ID 隔离账号，重复同步只覆盖自己的同一条轨迹。
  const id = require("crypto").createHash("sha256").update(JSON.stringify([OPENID, track.id])).digest("hex");
  return db.runTransaction(async tx=>{
    const ref=tx.collection("tracks").doc(id),current=(await ref.get()).data;
    if(current?.version!==undefined&&(!Number.isSafeInteger(current.version)||current.version<0))return {errMsg:'云端轨迹版本无效，拒绝覆盖'};
    const version=current?.version??0;
    if(version!==expectedVersion)return {errMsg:'云端轨迹已在其他设备更新，请先恢复最新云端副本'};
    if(current?.deleted===true&&event.restoreDeleted!==true)return {errMsg:'云端轨迹已删除；请从本机手动发起重新备份'};
    const nextVersion=version+1;
    await ref.set({ data: {
      owner: OPENID, trackId: track.id, name: String(track.name ?? "").slice(0, 60),
      routeId: typeof track.routeId === "string" ? track.routeId.slice(0, 128) : "", points,
      distanceM: nonNegative(track.distanceM), ascentM: nonNegative(track.ascentM), descentM: nonNegative(track.descentM),
      activeDurationMs: nonNegative(track.activeDurationMs), startedAt: track.startedAt, endedAt: track.endedAt,
      version:nextVersion, syncedAt: Date.now(),
    } });
    return { synced: true, version: nextVersion };
  });
};
