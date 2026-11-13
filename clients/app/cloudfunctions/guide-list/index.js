// Only published, rights-reviewed operator entries are returned; no invented products or prices.
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const categories = new Set(["鞋靴", "背包", "服装", "露营", "导航", "应急", "其他"]);
function safeLink(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443"); } catch { return false; }
}
exports.main = async () => {
  const res = await db.collection("guide_items").where({ published: true, rightsConfirmed: true }).orderBy("updatedAt", "desc").limit(200).get();
  const now = Date.now();
  const items = res.data.filter(i => typeof i._id === "string" && typeof i.title === "string" && i.title.trim() && i.title.length <= 200 && categories.has(i.category) && typeof i.summary === "string" && i.summary.length <= 2000 && safeLink(i.link) && safeLink(i.sourceUrl) && typeof i.rightsNote === "string" && i.rightsNote.trim().length > 0 && i.rightsNote.length <= 1000 && Number.isSafeInteger(i.expiresAt) && i.expiresAt > now).slice(0, 100).map(i => ({id:i._id,title:i.title,category:i.category,summary:i.summary,image:"",link:i.link,sourcePlatform:["taobao","jd","pdd","xianyu","other"].includes(i.sourcePlatform)?i.sourcePlatform:"unknown",expiresAt:i.expiresAt,priceHint:typeof i.priceHint === "string" && i.priceHint.length <= 100 ? i.priceHint : ""}));
  return { items };
};
