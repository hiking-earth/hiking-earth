'use strict';
// Authenticated, rate-limited queue for free custom offline basemap requests.
// User identity comes from the verified client-api session, never request data.
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
const TABLE = 'offline_map_requests';
const LIMIT_TABLE = 'offline_map_request_limits';
const QUEUE_GUARD_TABLE = 'offline_map_queue_guard';
const WORKER_STATUS_TABLE = 'offline_map_worker_status';
const MAX_QUEUE = 25;
const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024;
const LEASE_MS = 90 * 60 * 1000;
const WORKER_READY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PUBLIC_RELEASE_DISCLOSURE_VERSION = 'public-map-release-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const randomId = () => crypto.randomBytes(16).toString('hex');

function validCoordinate(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function publicRequest(row) {
  const attempts = Number.isSafeInteger(row.attempts) ? row.attempts : 0;
  return {
    id: row._id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusKm: row.radiusKm,
    status: row.status,
    retryable: row.status === 'failed' && attempts < 3 && row.failureCode !== 'invalid-request',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.downloadUrl ? { downloadUrl: row.downloadUrl, bytes: row.bytes, sha256: row.sha256 } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
  };
}

function validStoredRequest(row) {
  const attempts = row?.attempts === undefined ? 0 : row.attempts;
  if (!row || typeof row.name !== 'string' || !row.name
      || row.name !== row.name.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 65)
      || !Number.isSafeInteger(attempts) || attempts < 0 || attempts > 3
      || (row.status === 'queued' && attempts >= 3)
      || !validCoordinate(row.latitude, -85.05112878, 85.05112878)
      || !validCoordinate(row.longitude, -180, 180)
      || !validCoordinate(row.radiusKm, 1, 10)) return false;
  const latitudeDelta = row.radiusKm / 110;
  return row.latitude - latitudeDelta > -85.05112878
    && row.latitude + latitudeDelta < 85.05112878;
}

async function workerAvailabilityError() {
  if (!/^[a-f0-9]{64}$/.test(process.env.OFFLINE_MAP_WORKER_TOKEN || '')) return '免费地图申请服务尚未正确配置';
  const workerStatus = (await db.collection(WORKER_STATUS_TABLE).doc('worker').get()).data;
  if (!Number.isSafeInteger(workerStatus?.lastSeenAt)
      || Date.now() - workerStatus.lastSeenAt < 0
      || Date.now() - workerStatus.lastSeenAt > WORKER_READY_MS) return '免费地图构建服务暂不可用，请稍后再试';
  return '';
}

async function createRequest(event, identity) {
  if (event.publicReleaseDisclosureVersion !== PUBLIC_RELEASE_DISCLOSURE_VERSION) {
    return { errMsg: '请先阅读并确认自选地图公开发布说明' };
  }
  const workerError = await workerAvailabilityError();
  if (workerError) return { errMsg: workerError };
  const { name, latitude, longitude, radiusKm } = event;
  if (!validCoordinate(latitude, -85.05112878, 85.05112878)
      || !validCoordinate(longitude, -180, 180)
      || !validCoordinate(radiusKm, 1, 10)) {
    return { errMsg: '地图中心坐标或半径无效；半径须为1至10公里' };
  }
  const latitudeDelta = radiusKm / 110;
  if (latitude - latitudeDelta <= -85.05112878 || latitude + latitudeDelta >= 85.05112878) {
    return { errMsg: '此纬度附近超过当前离线底图支持范围，请选择较低纬度' };
  }
  const cleanName = typeof name === 'string'
    ? name.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 65)
    : '';
  if (!cleanName) return { errMsg: '请填写区域名称' };

  const table = db.collection(TABLE);
  const ownerId = hash(identity);
  const activeStates = db.command.in(['queued', 'processing']);
  const now = Date.now();
  const id = randomId();
  const quotaId = ownerId.slice(0, 32);
  const request = {
    ownerId,
    name: cleanName,
    latitude: Math.round(latitude * 100000) / 100000,
    longitude: Math.round(longitude * 100000) / 100000,
    radiusKm: Math.round(radiusKm * 10) / 10,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    expiresAt: now + RETENTION_MS,
    attempts: 0,
    publicReleaseDisclosureVersion: PUBLIC_RELEASE_DISCLOSURE_VERSION,
    publicReleaseConsentAt: now,
  };
  return db.runTransaction(async tx => {
    // Serialize admissions so simultaneous requests cannot bypass the shared queue cap.
    await tx.collection(QUEUE_GUARD_TABLE).doc('admission').set({ data: { updatedAt: now } });
    const txTable = tx.collection(TABLE);
    const owned = await txTable.where({ ownerId, status: activeStates }).limit(1).get();
    if ((owned.data || []).length) return { errMsg: '你已有一份区域地图正在排队或构建，请先查看进度' };
    const recent = await txTable.where({ ownerId }).orderBy('createdAt', 'desc').limit(1).get();
    if ((recent.data || []).some(row => Number.isFinite(row.createdAt) && now - row.createdAt < 24 * 60 * 60 * 1000)) {
      return { errMsg: '每个账号每24小时最多申请一份免费区域地图' };
    }
    const queued = await txTable.where({ status: 'queued' }).limit(MAX_QUEUE).get();
    if ((queued.data || []).length >= MAX_QUEUE) return { errMsg: '免费构建队列已满，请稍后再申请' };
    const limitRef = tx.collection(LIMIT_TABLE).doc(quotaId);
    const previous = (await limitRef.get()).data;
    if (previous && Number.isFinite(previous.createdAt) && now - previous.createdAt < 24 * 60 * 60 * 1000) {
      return { errMsg: '每个账号每24小时最多申请一份免费区域地图' };
    }
    await limitRef.set({ data: { ownerId, createdAt: now, expiresAt: now + 2 * 24 * 60 * 60 * 1000 } });
    await txTable.doc(id).set({ data: request });
    return publicRequest({ _id: id, ...request });
  });
}

async function listRequests(identity) {
  const rows = await db.collection(TABLE).where({ ownerId: hash(identity) }).orderBy('createdAt', 'desc').limit(100).get();
  return { requests: (rows.data || []).filter(row => row.expiresAt > Date.now()).slice(0, 20).map(publicRequest) };
}

async function deleteRequest(event, identity) {
  if (typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId)) return { errMsg: '申请编号无效' };
  return db.runTransaction(async tx => {
    const ref = tx.collection(TABLE).doc(event.requestId);
    const row = (await ref.get()).data;
    if (!row || row.ownerId !== hash(identity)) return { errMsg: '没有这份地图申请' };
    if (row.status === 'processing') return { errMsg: '地图正在生成，暂时不能删除申请' };
    await ref.remove();
    return { deleted: true };
  });
}

async function retryRequest(event, identity) {
  if (typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId)) return { errMsg: '申请编号无效' };
  const workerError = await workerAvailabilityError();
  if (workerError) return { errMsg: workerError };
  const now = Date.now();
  return db.runTransaction(async tx => {
    await tx.collection(QUEUE_GUARD_TABLE).doc('admission').set({ data: { updatedAt: now } });
    const ref = tx.collection(TABLE).doc(event.requestId);
    const row = (await ref.get()).data;
    if (!row || row.ownerId !== hash(identity)) return { errMsg: '没有这份地图申请' };
    if (row.status !== 'failed' || row.failureCode === 'invalid-request') return { errMsg: '这份地图申请资料无效，不能重新排队；请重新填写申请' };
    if ((Number.isSafeInteger(row.attempts) ? row.attempts : 0) >= 3) return { errMsg: '这份申请已达到免费构建重试上限，请在24小时后重新提交' };
    const queued = await tx.collection(TABLE).where({ status: 'queued' }).limit(MAX_QUEUE).get();
    if ((queued.data || []).length >= MAX_QUEUE) return { errMsg: '免费构建队列已满，请稍后再试' };
    const updated = { status: 'queued', failureCode: '', leaseId: '', leaseExpiresAt: 0, updatedAt: now };
    await ref.update({ data: updated });
    return publicRequest({ ...row, ...updated });
  });
}

async function nextRequest() {
  const table = db.collection(TABLE);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const ref = tx.collection(WORKER_STATUS_TABLE).doc('worker');
    const previous = (await ref.get()).data;
    if (!Number.isSafeInteger(previous?.lastSeenAt) || previous.lastSeenAt !== now) {
      await ref.set({ data: { lastSeenAt: now } });
    }
  });
  const oldLimits = await db.collection(LIMIT_TABLE).where({ expiresAt: db.command.lt(now) }).limit(100).get();
  for (const row of oldLimits.data || []) await db.collection(LIMIT_TABLE).doc(row._id).remove();
  const expiredRows = await table.where({ expiresAt: db.command.lt(now) }).limit(100).get();
  for (const row of expiredRows.data || []) await table.doc(row._id).remove();
  const [queued, expired] = await Promise.all([
    table.where({ status: 'queued' }).orderBy('createdAt', 'asc').limit(1).get(),
    table.where({ status: 'processing', leaseExpiresAt: db.command.lt(now) }).orderBy('createdAt', 'asc').limit(1).get(),
  ]);
  const candidates = [...(expired.data || []), ...(queued.data || [])]
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const candidate of candidates) {
    const leaseId = randomId();
    let claimed;
    await db.runTransaction(async tx => {
      const ref = tx.collection(TABLE).doc(candidate._id);
      const current = (await ref.get()).data;
      if (!current || (current.status !== 'queued'
          && !(current.status === 'processing' && current.leaseExpiresAt <= now))) return;
      if (!validStoredRequest(current)) {
        await ref.update({ data: {
          status: 'failed', failureCode: 'invalid-request',
          leaseId: '', leaseExpiresAt: 0, updatedAt: now,
        } });
        return;
      }
      if (current.status === 'processing' && (current.attempts || 0) >= 3) {
        await ref.update({ data: {
          status: 'failed', failureCode: 'build-attempts-exhausted',
          leaseId: '', leaseExpiresAt: 0, updatedAt: now,
        } });
        return;
      }
      await ref.update({ data: {
        status: 'processing', leaseId, leaseExpiresAt: now + LEASE_MS,
        attempts: (current.attempts || 0) + 1, updatedAt: now,
      } });
      claimed = { id: candidate._id, leaseId, name: current.name,
        latitude: current.latitude, longitude: current.longitude, radiusKm: current.radiusKm };
    });
    if (claimed) return { request: claimed };
  }
  return { request: null };
}

async function completeRequest(event) {
  const { requestId, leaseId, status } = event;
  if (typeof requestId !== 'string' || !/^[a-f0-9]{32}$/.test(requestId)
      || typeof leaseId !== 'string' || !/^[a-f0-9]{32}$/.test(leaseId)
      || !['complete', 'failed'].includes(status)) return { errMsg: '构建回执无效' };
  const ref = db.collection(TABLE).doc(requestId);
  const now = Date.now();
  return db.runTransaction(async tx => {
    const current = (await tx.collection(TABLE).doc(requestId).get()).data;
    if (!current || current.status !== 'processing' || current.leaseId !== leaseId) return { errMsg: '构建任务已过期或已被其他工作进程接管' };
    if (status === 'failed') {
      // Serialize retries with new admissions to preserve the shared queue bound.
      await tx.collection(QUEUE_GUARD_TABLE).doc('admission').set({ data: { updatedAt: now } });
      const queued = await tx.collection(TABLE).where({ status: 'queued' }).limit(MAX_QUEUE).get();
      const retry = current.attempts < 3 && (queued.data || []).length < MAX_QUEUE;
      const failureCode = current.attempts >= 3 ? 'build-attempts-exhausted' : 'queue-full-after-retry';
      await tx.collection(TABLE).doc(requestId).update({ data: {
        status: retry ? 'queued' : 'failed', failureCode: retry ? '' : failureCode,
        leaseId: '', leaseExpiresAt: 0, updatedAt: now,
      } });
      return { accepted: true, retry };
    }
    const { downloadUrl, bytes, sha256 } = event;
    if (typeof downloadUrl !== 'string'
        || !/^https:\/\/github\.com\/hiking-earth\/clients\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.zip$/.test(downloadUrl)
        || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ARCHIVE_BYTES
        || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return { errMsg: '地图下载信息未通过校验' };
    await tx.collection(TABLE).doc(requestId).update({ data: {
      status: 'complete', downloadUrl, bytes, sha256, leaseId: '', leaseExpiresAt: 0,
      failureCode: '', updatedAt: now,
    } });
    return { accepted: true };
  });
}

exports.worker = async (action, event) => {
  if (action === 'offline-map.worker.next') return nextRequest();
  if (action === 'offline-map.worker.complete') return completeRequest(event);
  return { errMsg: '地图工作进程操作无效' };
};

// Unified web, desktop, and mini-program accounts enter through client-api's
// verified session. Keep this method separate from the direct WeChat entry so
// the HTTP gateway never mistakes its own function context for the user.
exports.request = async (event, identity) => {
  if (typeof identity !== 'string' || !identity) return { errMsg: '请先登录' };
  if (event.action === 'create') return createRequest(event, identity);
  if (event.action === 'list') return listRequests(identity);
  if (event.action === 'delete') return deleteRequest(event, identity);
  if (event.action === 'retry') return retryRequest(event, identity);
  return { errMsg: '离线地图申请操作无效' };
};

// Retain direct-function compatibility for existing WeChat callers. New
// cross-client calls must use client-api/business/offline-map-request.
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  return exports.request(event, OPENID);
};
