'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
const COLLECTION = 'route_access_audit_snapshots';
const SNAPSHOT_ID = 'latest';
const MAX_ITEMS = 2000;
const MAX_CANDIDATES = 20000;
const CHUNK_ITEMS = 100;
const MAX_CHUNKS = Math.ceil(MAX_CANDIDATES / CHUNK_ITEMS);
const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const PAGE_SIZE = 25;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SOURCE_CHANGE_REASON = 'source-membership-change';
const validSourceChangeAt = value => typeof value === 'string' && value.length <= 40
  && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 5 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stableStringify = value => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const chunkId = (snapshot, index) => `items-${snapshot}-${String(index).padStart(3, '0')}`;

function validCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || typeof candidate.sourceId !== 'string' || !SOURCE_ID.test(candidate.sourceId)
      || typeof candidate.sourceLabel !== 'string' || !candidate.sourceLabel || candidate.sourceLabel.length > 128
      || typeof candidate.routeId !== 'string' || !ROUTE_ID.test(candidate.routeId)
      || typeof candidate.name !== 'string' || candidate.name.length > 500
      || typeof candidate.region !== 'string' || candidate.region.length > 256
      || typeof candidate.sourceUrl !== 'string' || candidate.sourceUrl.length > 2048
      || candidate.disposition !== 'human-review-required'
      || !Array.isArray(candidate.findings) || candidate.findings.length < 1 || candidate.findings.length > 32) return false;
  let url;
  try { url = new URL(candidate.sourceUrl); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return candidate.findings.every(finding => finding && typeof finding === 'object' && !Array.isArray(finding)
    && typeof finding.field === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(finding.field)
    && (typeof finding.value === 'boolean' || typeof finding.value === 'string' && finding.value.length <= 240)
    && (finding.reason === 'negative-access-signal'
      || finding.reason === SOURCE_CHANGE_REASON && candidate.sourceId.indexOf('osm-pbf-') === 0
        && finding.field === 'sourceMembership' && ['source-released', 'catalog-removed'].includes(finding.value)
        && validSourceChangeAt(candidate.sourceChangeAt)));
}

async function attachMembershipReviewStatus(items) {
  return Promise.all(items.map(async candidate => {
    if (!candidate.findings.some(finding => finding.reason === SOURCE_CHANGE_REASON)) return candidate;
    const id = crypto.createHash('sha256').update(candidate.routeId).digest('hex');
    const review = (await db.collection('route_reviews').doc(id).get()).data;
    const checkedAt = Date.parse(review?.checkedAt);
    const changedAt = Date.parse(candidate.sourceChangeAt);
    const now = Date.now();
    const reviewed = review?.routeId === candidate.routeId
      && Number.isFinite(checkedAt) && checkedAt >= changedAt && checkedAt <= now
      && Number.isSafeInteger(review.expiresAt) && review.expiresAt > now
      && review.expiresAt <= checkedAt + 7 * 86400000
      && ['开放中', '即将开放', '临时关闭', '永久关闭'].includes(review.status);
    return { ...candidate, membershipReviewStatus: reviewed ? 'reviewed-after-change' : 'pending',
      membershipCheckedAt: reviewed ? review.checkedAt : null };
  }));
}

async function list(page = 0, expectedSnapshot) {
  if (!Number.isSafeInteger(page) || page < 0 || page >= Math.ceil(MAX_CANDIDATES / PAGE_SIZE)) {
    return { errMsg: '路线审核候选页码无效' };
  }
  if (expectedSnapshot !== undefined && (typeof expectedSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSnapshot))) {
    return { errMsg: '路线审核快照标识无效' };
  }
  const snapshot = (await db.collection(COLLECTION).doc(SNAPSHOT_ID).get()).data;
  if (!snapshot) return expectedSnapshot
    ? { available: false, changed: true, items: [], page, hasMore: false }
    : { available: false, items: [], page, hasMore: false };
  if (snapshot.schemaVersion === 2) {
    const { snapshot: snapshotId, publishedAt, stageStartedAt, ...core } = snapshot;
    const generatedAt = Date.parse(snapshot.generatedAt);
    let signals = 0;
    if (!snapshot.sources || typeof snapshot.sources !== 'object' || Array.isArray(snapshot.sources)) return { errMsg: '云端路线审核快照格式异常' };
    for (const [sourceId, source] of Object.entries(snapshot.sources)) {
      if (!SOURCE_ID.test(sourceId) || !source || typeof source !== 'object'
          || typeof source.label !== 'string' || source.label.length > 128
          || !Number.isSafeInteger(source.routeCount) || source.routeCount < 0 || source.routeCount > 50000000
          || !Number.isSafeInteger(source.negativeSignalCount) || source.negativeSignalCount < 0
          || source.negativeSignalCount > source.routeCount
          || source.sourceChangeCount !== undefined && (!Number.isSafeInteger(source.sourceChangeCount)
            || source.sourceChangeCount < 0 || source.sourceChangeCount > source.routeCount)
          || source.disposition !== 'discovery-only') return { errMsg: '云端路线审核快照格式异常' };
      signals += source.negativeSignalCount + (source.sourceChangeCount ?? 0);
    }
    const chunks = snapshot.chunks;
    if (typeof snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotId)
        || hash(stableStringify(core)) !== snapshotId || !Number.isFinite(generatedAt)
        || generatedAt > Date.now() + 5 * 60 * 1000 || generatedAt < Date.now() - 72 * 60 * 60 * 1000
        || !Number.isSafeInteger(snapshot.reviewCandidateCount) || snapshot.reviewCandidateCount !== signals
        || !Number.isSafeInteger(snapshot.listedCount) || snapshot.listedCount < 0 || snapshot.listedCount > MAX_CANDIDATES
        || snapshot.reviewCandidateCount !== snapshot.listedCount || snapshot.reviewCandidatesTruncated !== false
        || snapshot.chunkSize !== CHUNK_ITEMS || !Array.isArray(chunks) || chunks.length > MAX_CHUNKS
        || chunks.length !== Math.ceil(snapshot.listedCount / CHUNK_ITEMS)
        || !Number.isSafeInteger(snapshot.candidateBytes) || snapshot.candidateBytes < 0 || snapshot.candidateBytes > MAX_TOTAL_BYTES) {
      return { errMsg: '云端路线审核快照格式异常' };
    }
    let listed = 0, bytes = 0;
    for (let index = 0; index < chunks.length; index++) {
      const descriptor = chunks[index], expectedCount = Math.min(CHUNK_ITEMS, snapshot.listedCount - listed);
      if (!descriptor || descriptor.index !== index || descriptor.count !== expectedCount
          || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 2 || descriptor.bytes > MAX_CHUNK_BYTES
          || typeof descriptor.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) return { errMsg: '云端路线审核快照格式异常' };
      listed += descriptor.count;
      bytes += descriptor.bytes;
    }
    if (listed !== snapshot.listedCount || bytes !== snapshot.candidateBytes) return { errMsg: '云端路线审核快照格式异常' };
    if (expectedSnapshot && expectedSnapshot !== snapshotId) return { available: false, changed: true, items: [], page, hasMore: false };
    if (snapshot.listedCount === 0) return { available: true, snapshot: snapshotId,
      generatedAt: snapshot.generatedAt, total: snapshot.reviewCandidateCount, listed: 0, truncated: false,
      sourceCount: Object.keys(snapshot.sources).length, items: [], page, hasMore: false };
    const offset = page * PAGE_SIZE;
    if (offset >= snapshot.listedCount) return { errMsg: '路线审核候选页码超出范围' };
    const chunkIndex = Math.floor(offset / CHUNK_ITEMS);
    const chunk = (await db.collection(COLLECTION).doc(chunkId(snapshotId, chunkIndex)).get()).data;
    const descriptor = chunks[chunkIndex];
    if (!chunk || chunk.snapshot !== snapshotId || chunk.index !== chunkIndex
        || chunk.sha256 !== descriptor.sha256 || chunk.bytes !== descriptor.bytes
        || !Array.isArray(chunk.items) || chunk.items.length !== descriptor.count
        || hash(stableStringify(chunk.items)) !== descriptor.sha256
        || Buffer.byteLength(stableStringify(chunk.items), 'utf8') !== descriptor.bytes
        || chunk.items.some(item => !validCandidate(item))) return { errMsg: '云端路线审核分片缺失或校验失败' };
    for (const item of chunk.items) if (!snapshot.sources[item.sourceId] || item.sourceLabel !== snapshot.sources[item.sourceId].label) return { errMsg: '云端路线审核分片来源不匹配' };
    const localOffset = offset - chunkIndex * CHUNK_ITEMS;
    const items = await attachMembershipReviewStatus(chunk.items.slice(localOffset, localOffset + PAGE_SIZE));
    return { available: true, snapshot: snapshotId, generatedAt: snapshot.generatedAt,
      total: snapshot.reviewCandidateCount, listed: snapshot.listedCount, truncated: false,
      sourceCount: Object.keys(snapshot.sources).length, items, page,
      hasMore: offset + items.length < snapshot.listedCount };
  }
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (snapshot.schemaVersion !== 1 || typeof snapshot.snapshot !== 'string'
      || !/^[a-f0-9]{64}$/.test(snapshot.snapshot) || !Array.isArray(snapshot.items)
      || snapshot.items.length > MAX_ITEMS || !Number.isFinite(generatedAt)
      || generatedAt > Date.now() + 5 * 60 * 1000 || generatedAt < Date.now() - 72 * 60 * 60 * 1000
      || !Number.isSafeInteger(snapshot.candidateCount) || snapshot.candidateCount < 0
      || !Number.isSafeInteger(snapshot.listedCount) || snapshot.listedCount !== snapshot.items.length
      || snapshot.candidateCount < snapshot.listedCount
      || snapshot.truncated !== (snapshot.candidateCount > snapshot.listedCount)
      || !Number.isSafeInteger(snapshot.sourceCount) || snapshot.sourceCount < 1 || snapshot.sourceCount > 64
      || snapshot.items.some(item => !validCandidate(item))) {
    return { errMsg: '云端路线审核快照格式异常' };
  }
  if (expectedSnapshot && expectedSnapshot !== snapshot.snapshot) {
    return { available: false, changed: true, items: [], page, hasMore: false };
  }
  const offset = page * 25;
  const items = await attachMembershipReviewStatus(snapshot.items.slice(offset, offset + 25));
  return {
    available: true,
    snapshot: snapshot.snapshot,
    generatedAt: snapshot.generatedAt,
    total: snapshot.candidateCount,
    listed: snapshot.listedCount,
    truncated: snapshot.truncated === true,
    sourceCount: snapshot.sourceCount,
    items,
    page,
    hasMore: offset + 25 < snapshot.items.length,
  };
}

module.exports = { list };
