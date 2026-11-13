const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { errMsg: '请先登录' };
  const id = require('crypto').createHash('sha256').update(OPENID).digest('hex');
  if (event.action === 'get') {
    const row = (await db.collection('user_libraries').doc(id).get()).data;
    return { favorites: row?.favorites || [], plans: row?.plans || [], version: row?.version || 0 };
  }
  if (event.action !== 'save') return { errMsg: '操作无效' };
  if (!Array.isArray(event.favorites) || event.favorites.length > 400 || !event.favorites.every(x => typeof x === 'string' && x.length > 0 && x.length <= 128) || new Set(event.favorites).size !== event.favorites.length || !Array.isArray(event.plans) || event.plans.length > 200) return { errMsg: '收藏或行程数量或格式无效' };
  const plans = [];
  for (const p of event.plans) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 5 || !['id', 'routeId', 'date', 'notes', 'packed'].every(key => key in p)
      || typeof p.id !== 'string' || p.id.length === 0 || p.id.length > 128 || typeof p.routeId !== 'string' || p.routeId.length === 0 || p.routeId.length > 128
      || typeof p.notes !== 'string' || p.notes.length > 2000 || typeof p.packed !== 'boolean'
      || typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(Date.parse(p.date)) || new Date(p.date).toISOString().slice(0,10) !== p.date) return { errMsg: '行程格式不正确' };
    plans.push({ id: p.id, routeId: p.routeId, date: p.date, notes: p.notes, packed: p.packed });
  }
  if (new Set(plans.map(plan => plan.id)).size !== plans.length) return { errMsg: '行程包含重复编号，未保存' };
  return db.runTransaction(async tx => {
    const ref = tx.collection('user_libraries').doc(id), current = (await ref.get()).data;
    const version = current?.version || 0;
    if (event.version !== version) return { errMsg: '另一设备已更新资料，请先恢复云端资料后再保存' };
    await ref.set({ data: { owner: OPENID, favorites: [...new Set(event.favorites)], plans, version: version + 1, updatedAt: Date.now() } });
    return { version: version + 1 };
  });
};
