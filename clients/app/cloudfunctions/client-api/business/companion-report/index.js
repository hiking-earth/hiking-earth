const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async (event) => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: "请先登录" };
  if (typeof event.postId !== "string" || !event.postId) return { errMsg: "帖子无效" };
  const reason = String(event.reason || "").trim().slice(0, 300);
  if (!reason) return { errMsg: "请填写举报原因" };
  const id = require("crypto").createHash("sha256").update(JSON.stringify([OPENID, event.postId])).digest("hex");
  return db.runTransaction(async tx => {
    const post = (await tx.collection("companion_posts").doc(event.postId).get()).data;
    if (!post || !["open", "full", "closed"].includes(post.status)) return { errMsg: "帖子不存在或当前不可举报" };
    const ref = tx.collection("community_reports").doc(id);
    const existing = (await ref.get()).data;
    // Retrying or repeating a report must never reset a handled report or erase
    // its moderation audit fields.
    if (existing) return { reported: true, duplicate: true, status: existing.status };
    await ref.set({ data: { reporter: OPENID, postId: event.postId, reason, createdAt: Date.now(), status: "pending" } });
    return { reported: true, duplicate: false, status: "pending" };
  });
};
