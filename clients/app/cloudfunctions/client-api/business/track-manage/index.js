const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = async event => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: '请先登录' };
  if (event.action === 'list') {
    if (Object.prototype.hasOwnProperty.call(event, 'afterCursor')) {
      const afterCursor=event.afterCursor;
      if(typeof afterCursor!=='string'||afterCursor.length>128)return {errMsg:'轨迹目录游标无效'};
      const criteria={owner:OPENID};
      if(afterCursor)criteria._id=db.command.gt(afterCursor);
      const result=await db.collection('tracks').where(criteria).orderBy('_id','asc').limit(20)
        .field({_id:true,trackId:true,name:true,distanceM:true,version:true,deleted:true}).get();
      if(result.data.some(t=>t.deleted!==undefined&&typeof t.deleted!=='boolean'))return {errMsg:'云端轨迹删除状态无效'};
      // The cursor endpoint is reserved for the authenticated auto-sync client.
      // Return tombstones as metadata so another device can stop advertising a
      // stale local copy as synchronized without exposing deleted track points.
      const tracks=result.data.map(t=>({trackId:t.trackId,name:t.deleted===true?'':t.name,distanceM:t.deleted===true?0:t.distanceM,version:t.version??0,deleted:t.deleted===true}));
      return {tracks,hasMore:result.data.length===20,nextCursor:result.data.length?result.data[result.data.length-1]._id:null};
    }
    const page = Number.isInteger(event.page) && event.page >= 0 ? event.page : 0;
    const result = await db.collection('tracks').where({ owner: OPENID, deleted: db.command.neq(true) }).orderBy('syncedAt', 'desc').skip(page * 20).limit(20).field({ trackId: true, name: true, distanceM: true, version: true, syncedAt: true }).get();
    return { tracks: result.data.map(t=>({trackId:t.trackId,name:t.name,distanceM:t.distanceM,version:t.version??0})), hasMore: result.data.length === 20 };
  }
  if (typeof event.trackId !== 'string' || !event.trackId || event.trackId.length > 128) return { errMsg: '轨迹无效' };
  const query = db.collection('tracks').where({ owner: OPENID, trackId: event.trackId, deleted: db.command.neq(true) });
  if (event.action === 'delete') {
    const expectedVersion=event.expectedVersion===undefined?0:event.expectedVersion;
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)return {errMsg:'请刷新云端轨迹后再删除'};
    const id=crypto.createHash('sha256').update(JSON.stringify([OPENID,event.trackId])).digest('hex');
    return db.runTransaction(async tx=>{
      const ref=tx.collection('tracks').doc(id),current=(await ref.get()).data;
      if(!current||current.owner!==OPENID)return {errMsg:'云端轨迹已不存在，请刷新目录'};
      if(current.version!==undefined&&(!Number.isSafeInteger(current.version)||current.version<0))return {errMsg:'云端轨迹版本无效，拒绝删除'};
      const version=current.version??0;
      if(current.deleted===true)return {deleted:true,version};
      if(current.trackId!==event.trackId)return {errMsg:'云端轨迹已不存在，请刷新目录'};
      if(version!==expectedVersion)return {errMsg:'云端轨迹已在其他设备更新，请刷新后再删除'};
      const nextVersion=version+1,now=Date.now();
      await ref.set({data:{owner:OPENID,deleted:true,version:nextVersion,deletedAt:now,syncedAt:now}});
      return {deleted:true,version:nextVersion};
    });
  }
  if (event.action === 'get') {
    const { data } = await query.orderBy('syncedAt', 'desc').limit(1).get();
    if (!data.length) return { errMsg: '云端轨迹不存在' };
    const t = data[0];
    if(t.version!==undefined&&(!Number.isSafeInteger(t.version)||t.version<0))return {errMsg:'云端轨迹版本无效，无法安全恢复'};
    return { track: { id: t.trackId, name: t.name, routeId: t.routeId, points: t.points, distanceM: t.distanceM, ascentM: t.ascentM,
      descentM: t.descentM ?? 0, activeDurationMs: t.activeDurationMs, startedAt: t.startedAt, endedAt: t.endedAt, state: 'finished', synced: true, cloudVersion: t.version??0 } };
  }
  return { errMsg: '操作无效' };
};
