'use strict';

// The scheduled source audit is triage only. Keep its snapshot separate from
// route_reviews so automated signals can never grant access or navigation.
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
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
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const PAGE_SIZE = 25;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REASON = 'negative-access-signal';
const SOURCE_CHANGE_REASON = 'source-membership-change';
const REASONS = new Set([REASON, SOURCE_CHANGE_REASON]);
const validSourceChangeAt = value => typeof value === 'string' && value.length <= 40
  && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 5 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stableStringify = value => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const chunkId = (snapshot, index) => `items-${snapshot}-${String(index).padStart(3, '0')}`;

function fail(message, status = 400, code = 'ROUTE_AUDIT_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function validateReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)
      || report.schemaVersion !== 1
      || report.policy !== 'discovery-only; no access permission inferred or granted'
      || typeof report.generatedAt !== 'string') fail('路线审核快照格式无效');
  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 5 * 60 * 1000
      || generatedAt < Date.now() - 72 * 60 * 60 * 1000) fail('路线审核快照时间无效或已过期');
  if (!report.sources || typeof report.sources !== 'object' || Array.isArray(report.sources)
      || Object.keys(report.sources).length < 1 || Object.keys(report.sources).length > 64) {
    fail('路线审核来源摘要无效');
  }
  let totalSignals = 0;
  for (const [sourceId, source] of Object.entries(report.sources)) {
    if (!SOURCE_ID.test(sourceId) || !source || typeof source !== 'object' || Array.isArray(source)
        || typeof source.label !== 'string' || !source.label || source.label.length > 128
        || !Number.isSafeInteger(source.routeCount) || source.routeCount < 0 || source.routeCount > 50000000
        || !Number.isSafeInteger(source.negativeSignalCount) || source.negativeSignalCount < 0
        || source.negativeSignalCount > source.routeCount
        || source.sourceChangeCount !== undefined && (!Number.isSafeInteger(source.sourceChangeCount)
          || source.sourceChangeCount < 0 || source.sourceChangeCount > source.routeCount)
        || source.disposition !== 'discovery-only') fail('路线审核来源摘要字段无效');
    totalSignals += source.negativeSignalCount + (source.sourceChangeCount ?? 0);
  }
  if (!Number.isSafeInteger(report.reviewCandidateCount) || report.reviewCandidateCount < 0
      || report.reviewCandidateCount !== totalSignals
      || !Array.isArray(report.reviewCandidates) || report.reviewCandidates.length > MAX_ITEMS
      || typeof report.reviewCandidatesTruncated !== 'boolean'
      || report.reviewCandidatesTruncated !== (report.reviewCandidateCount > report.reviewCandidates.length)) {
    fail('路线审核候选数量不一致');
  }
  for (const candidate of report.reviewCandidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || typeof candidate.sourceId !== 'string' || !SOURCE_ID.test(candidate.sourceId) || !report.sources[candidate.sourceId]
        || typeof candidate.sourceLabel !== 'string' || candidate.sourceLabel !== report.sources[candidate.sourceId].label
        || typeof candidate.routeId !== 'string' || !ROUTE_ID.test(candidate.routeId)
        || typeof candidate.name !== 'string' || candidate.name.length > 500
        || typeof candidate.region !== 'string' || candidate.region.length > 256
        || typeof candidate.sourceUrl !== 'string' || candidate.sourceUrl.length > 2048
        || candidate.disposition !== 'human-review-required'
        || !Array.isArray(candidate.findings) || candidate.findings.length < 1 || candidate.findings.length > 32) {
      fail('路线审核候选格式无效');
    }
    let url;
    try { url = new URL(candidate.sourceUrl); } catch { fail('路线审核来源链接格式无效'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port) {
      fail('路线审核来源链接必须为 HTTPS');
    }
    for (const finding of candidate.findings) {
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)
          || typeof finding.field !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(finding.field)
          || !(typeof finding.value === 'string' && finding.value.length <= 240 || typeof finding.value === 'boolean')
          || !REASONS.has(finding.reason)
          || finding.reason === SOURCE_CHANGE_REASON
            && (candidate.sourceId.indexOf('osm-pbf-') !== 0 || finding.field !== 'sourceMembership'
              || !['source-released', 'catalog-removed'].includes(finding.value)
              || !validSourceChangeAt(candidate.sourceChangeAt))) fail('路线审核信号字段无效');
    }
  }
  let encoded;
  try { encoded = JSON.stringify(report); } catch { fail('路线审核快照无法序列化'); }
  const bytes = Buffer.byteLength(encoded, 'utf8');
  if (bytes > MAX_BODY_BYTES) fail('路线审核快照超过4 MiB限制');
  return { report, generatedAt, encoded, bytes, snapshot: hash(encoded) };
}

function validStoredCandidate(candidate) {
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
    && REASONS.has(finding.reason)
    && (finding.reason !== SOURCE_CHANGE_REASON || candidate.sourceId.indexOf('osm-pbf-') === 0
      && finding.field === 'sourceMembership' && ['source-released', 'catalog-removed'].includes(finding.value)
      && validSourceChangeAt(candidate.sourceChangeAt)));
}

async function attachMembershipReviewStatus(items) {
  return Promise.all(items.map(async candidate => {
    if (!candidate.findings.some(finding => finding.reason === SOURCE_CHANGE_REASON)) return candidate;
    const id = hash(candidate.routeId);
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

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || manifest.schemaVersion !== 2
      || manifest.policy !== 'discovery-only; no access permission inferred or granted'
      || typeof manifest.generatedAt !== 'string') fail('路线审核分片清单格式无效');
  const generatedAt = Date.parse(manifest.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 5 * 60 * 1000
      || generatedAt < Date.now() - 72 * 60 * 60 * 1000) fail('路线审核分片清单时间无效或已过期');
  if (!manifest.sources || typeof manifest.sources !== 'object' || Array.isArray(manifest.sources)
      || Object.keys(manifest.sources).length < 1 || Object.keys(manifest.sources).length > 64) fail('路线审核来源摘要无效');
  let totalSignals = 0;
  for (const [sourceId, source] of Object.entries(manifest.sources)) {
    if (!SOURCE_ID.test(sourceId) || !source || typeof source !== 'object' || Array.isArray(source)
        || typeof source.label !== 'string' || !source.label || source.label.length > 128
        || !Number.isSafeInteger(source.routeCount) || source.routeCount < 0 || source.routeCount > 50000000
        || !Number.isSafeInteger(source.negativeSignalCount) || source.negativeSignalCount < 0
        || source.negativeSignalCount > source.routeCount
        || source.sourceChangeCount !== undefined && (!Number.isSafeInteger(source.sourceChangeCount)
          || source.sourceChangeCount < 0 || source.sourceChangeCount > source.routeCount)
        || source.disposition !== 'discovery-only') {
      fail('路线审核来源摘要字段无效');
    }
    totalSignals += source.negativeSignalCount + (source.sourceChangeCount ?? 0);
  }
  if (!Number.isSafeInteger(manifest.reviewCandidateCount) || manifest.reviewCandidateCount < 0
      || manifest.reviewCandidateCount !== totalSignals
      || !Number.isSafeInteger(manifest.listedCount) || manifest.listedCount < 0
      || manifest.listedCount > MAX_CANDIDATES || manifest.reviewCandidateCount < manifest.listedCount
      || manifest.reviewCandidatesTruncated !== (manifest.reviewCandidateCount > manifest.listedCount)
      || manifest.reviewCandidatesTruncated !== false
      || !Number.isSafeInteger(manifest.chunkSize) || manifest.chunkSize !== CHUNK_ITEMS
      || !Array.isArray(manifest.chunks) || manifest.chunks.length > MAX_CHUNKS
      || manifest.chunks.length !== Math.ceil(manifest.listedCount / CHUNK_ITEMS)
      || !Number.isSafeInteger(manifest.candidateBytes) || manifest.candidateBytes < 0
      || manifest.candidateBytes > MAX_TOTAL_BYTES) fail('路线审核分片数量或容量不完整');
  let listed = 0;
  let bytes = 0;
  for (let index = 0; index < manifest.chunks.length; index++) {
    const chunk = manifest.chunks[index];
    const expectedCount = Math.min(CHUNK_ITEMS, manifest.listedCount - listed);
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)
        || chunk.index !== index || chunk.count !== expectedCount
        || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 2 || chunk.bytes > MAX_CHUNK_BYTES
        || typeof chunk.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(chunk.sha256)) fail('路线审核分片摘要无效');
    listed += chunk.count;
    bytes += chunk.bytes;
  }
  if (listed !== manifest.listedCount || bytes !== manifest.candidateBytes) fail('路线审核分片总数不一致');
  const { snapshot, publishedAt, stageStartedAt, ...core } = manifest;
  if (typeof snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot)
      || hash(stableStringify(core)) !== snapshot) fail('路线审核分片快照摘要无效');
  return { manifest, generatedAt, bytes };
}

async function removeManifestChunks(manifest) {
  if (!manifest || !Array.isArray(manifest.chunks) || typeof manifest.snapshot !== 'string') return;
  for (let start = 0; start < manifest.chunks.length; start += 10) {
    await Promise.all(manifest.chunks.slice(start, start + 10).map((_, offset) =>
      db.collection(COLLECTION).doc(chunkId(manifest.snapshot, start + offset)).remove()));
  }
}

async function clearPreviousSnapshot(currentSnapshot) {
  const ref = db.collection(COLLECTION).doc('cleanup');
  const prior = (await ref.get()).data;
  if (!prior || prior.snapshot === currentSnapshot) return;
  await removeManifestChunks(prior);
  await ref.remove();
}

async function worker(action, data = {}) {
  if (action === 'route-audit.worker.begin') {
    const validated = validateManifest(data.manifest);
    const current = (await db.collection(COLLECTION).doc(SNAPSHOT_ID).get()).data;
    const currentTime = Date.parse(current?.generatedAt);
    if (current && (!Number.isFinite(currentTime) || currentTime > validated.generatedAt)) fail('路线审核快照比云端当前版本更旧', 409, 'ROUTE_AUDIT_STALE');
    if (current && currentTime === validated.generatedAt && current.snapshot !== validated.manifest.snapshot) fail('同一采集时间存在不同路线审核快照', 409, 'ROUTE_AUDIT_CONFLICT');
    await clearPreviousSnapshot(current?.snapshot);
    const stageRef = db.collection(COLLECTION).doc('staging');
    const oldStage = (await stageRef.get()).data;
    if (current?.snapshot === validated.manifest.snapshot) {
      if (oldStage?.snapshot && oldStage.snapshot !== current.snapshot) await removeManifestChunks(oldStage);
      if (oldStage) await stageRef.remove();
      return { accepted: true, unchanged: true, snapshot: current.snapshot };
    }
    if (oldStage?.snapshot && oldStage.snapshot !== validated.manifest.snapshot
        && oldStage.snapshot !== current?.snapshot) await removeManifestChunks(oldStage);
    await stageRef.set({ data: { ...validated.manifest, stageStartedAt: Date.now() } });
    return { accepted: true, unchanged: false, snapshot: validated.manifest.snapshot, chunkCount: validated.manifest.chunks.length };
  }
  if (action === 'route-audit.worker.chunk') {
    const snapshot = data.snapshot;
    const index = data.index;
    if (typeof snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot)
        || !Number.isSafeInteger(index) || index < 0 || index >= MAX_CHUNKS
        || !Array.isArray(data.items)) fail('路线审核分片请求无效');
    const manifest = (await db.collection(COLLECTION).doc('staging').get()).data;
    if (!manifest || manifest.snapshot !== snapshot) fail('路线审核分片任务已变更', 409, 'ROUTE_AUDIT_STAGE_CHANGED');
    const descriptor = manifest.chunks[index];
    if (!descriptor || descriptor.index !== index || descriptor.count !== data.items.length
        || data.items.length > CHUNK_ITEMS || data.items.some(item => !validStoredCandidate(item))) fail('路线审核候选分片格式无效');
    for (const item of data.items) {
      if (!manifest.sources[item.sourceId] || item.sourceLabel !== manifest.sources[item.sourceId].label) fail('路线审核分片来源不匹配');
    }
    const encoded = stableStringify(data.items);
    const bytes = Buffer.byteLength(encoded, 'utf8');
    const digest = hash(encoded);
    if (bytes !== descriptor.bytes || bytes > MAX_CHUNK_BYTES || digest !== descriptor.sha256) fail('路线审核分片摘要校验失败');
    const ref = db.collection(COLLECTION).doc(chunkId(snapshot, index));
    const prior = (await ref.get()).data;
    if (prior) {
      if (prior.snapshot !== snapshot || prior.index !== index || prior.sha256 !== digest || !isDeepStrictEqual(prior.items, data.items)) {
        fail('同一审核快照的分片内容冲突', 409, 'ROUTE_AUDIT_CHUNK_CONFLICT');
      }
    } else {
      await ref.set({ data: { snapshot, index, sha256: digest, bytes, items: data.items } });
    }
    return { accepted: true, snapshot, index, count: data.items.length, sha256: digest };
  }
  if (action === 'route-audit.worker.commit') {
    const snapshot = data.snapshot;
    if (typeof snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot)) fail('路线审核快照标识无效');
    const current = (await db.collection(COLLECTION).doc(SNAPSHOT_ID).get()).data;
    if (current?.snapshot === snapshot) {
      await clearPreviousSnapshot(current.snapshot);
      const stage = (await db.collection(COLLECTION).doc('staging').get()).data;
      if (stage?.snapshot === snapshot) await db.collection(COLLECTION).doc('staging').remove();
      return { accepted: true, unchanged: true, snapshot,
        candidateCount: current.reviewCandidateCount ?? current.candidateCount,
        listedCount: current.listedCount, truncated: current.reviewCandidatesTruncated ?? current.truncated,
        generatedAt: current.generatedAt };
    }
    const manifest = (await db.collection(COLLECTION).doc('staging').get()).data;
    if (!manifest || manifest.snapshot !== snapshot) fail('路线审核发布任务已变更', 409, 'ROUTE_AUDIT_STAGE_CHANGED');
    const validated = validateManifest(manifest);
    for (let start = 0; start < manifest.chunks.length; start += 10) {
      const rows = await Promise.all(manifest.chunks.slice(start, start + 10).map((_, offset) =>
        db.collection(COLLECTION).doc(chunkId(snapshot, start + offset)).get()));
      rows.forEach((row, offset) => {
        const index = start + offset;
        const descriptor = manifest.chunks[index];
        const chunk = row.data;
        if (!chunk || chunk.snapshot !== snapshot || chunk.index !== index || chunk.bytes !== descriptor.bytes
            || chunk.sha256 !== descriptor.sha256 || !Array.isArray(chunk.items) || chunk.items.length !== descriptor.count
            || chunk.items.some(item => !validStoredCandidate(item))
            || chunk.items.some(item => !manifest.sources[item.sourceId] || item.sourceLabel !== manifest.sources[item.sourceId].label)
            || hash(stableStringify(chunk.items)) !== descriptor.sha256
            || Buffer.byteLength(stableStringify(chunk.items), 'utf8') !== descriptor.bytes) {
          fail(`路线审核分片 ${index} 缺失或校验失败`, 409, 'ROUTE_AUDIT_CHUNK_INCOMPLETE');
        }
      });
    }
    const previous = await db.runTransaction(async transaction => {
      const ref = transaction.collection(COLLECTION).doc(SNAPSHOT_ID);
      const current = (await ref.get()).data;
      const currentTime = Date.parse(current?.generatedAt);
      if (current?.snapshot === snapshot) return current;
      if (current && (!Number.isFinite(currentTime) || currentTime > validated.generatedAt)) fail('路线审核快照比云端当前版本更旧', 409, 'ROUTE_AUDIT_STALE');
      if (current && currentTime === validated.generatedAt) fail('同一采集时间存在不同路线审核快照', 409, 'ROUTE_AUDIT_CONFLICT');
      const published = { ...manifest, schemaVersion: 2, publishedAt: Date.now() };
      delete published.stageStartedAt;
      if (current?.schemaVersion === 2 && current.snapshot !== snapshot) {
        await transaction.collection(COLLECTION).doc('cleanup').set({ data: current });
      }
      await ref.set({ data: published });
      return current;
    });
    await clearPreviousSnapshot(snapshot);
    await db.collection(COLLECTION).doc('staging').remove();
    return { accepted: true, unchanged: previous?.snapshot === snapshot, snapshot,
      candidateCount: manifest.reviewCandidateCount, listedCount: manifest.listedCount,
      truncated: false, generatedAt: manifest.generatedAt };
  }
  fail('路线审核工作流操作无效');
}

async function publish(report) {
  const validated = validateReport(report);
  return db.runTransaction(async transaction => {
    const current = (await transaction.collection(COLLECTION).doc(SNAPSHOT_ID).get()).data;
    if (current?.snapshot === validated.snapshot) {
      const expectedGeneratedAt = new Date(validated.generatedAt).toISOString();
      const expectedCandidateCount = validated.report.reviewCandidateCount;
      const expectedListedCount = validated.report.reviewCandidates.length;
      const expectedTruncated = validated.report.reviewCandidatesTruncated;
      if (current.schemaVersion !== 1
          || current.generatedAt !== expectedGeneratedAt
          || current.candidateCount !== expectedCandidateCount
          || current.listedCount !== expectedListedCount
          || current.truncated !== expectedTruncated
          || current.sourceCount !== Object.keys(validated.report.sources).length
          || current.bytes !== validated.bytes
          || !Array.isArray(current.items)
          || !isDeepStrictEqual(current.items, validated.report.reviewCandidates)) {
        fail('云端现有路线审核快照与相同版本内容不一致', 502, 'ROUTE_AUDIT_CORRUPT');
      }
      return { accepted: true, unchanged: true, snapshot: validated.snapshot,
        candidateCount: current.candidateCount, listedCount: current.listedCount,
        truncated: current.truncated, generatedAt: current.generatedAt };
    }
    const currentGeneratedAt = Date.parse(current?.generatedAt);
    if (current && !Number.isFinite(currentGeneratedAt)) {
      fail('云端现有路线审核快照时间异常', 502, 'ROUTE_AUDIT_CORRUPT');
    }
    if (currentGeneratedAt > validated.generatedAt) {
      fail('路线审核快照比云端当前版本更旧', 409, 'ROUTE_AUDIT_STALE');
    }
    if (currentGeneratedAt === validated.generatedAt) {
      fail('同一采集时间存在不同路线审核快照', 409, 'ROUTE_AUDIT_CONFLICT');
    }
    await transaction.collection(COLLECTION).doc(SNAPSHOT_ID).set({ data: {
      schemaVersion: 1,
      snapshot: validated.snapshot,
      generatedAt: new Date(validated.generatedAt).toISOString(),
      publishedAt: Date.now(),
      candidateCount: validated.report.reviewCandidateCount,
      listedCount: validated.report.reviewCandidates.length,
      truncated: validated.report.reviewCandidatesTruncated,
      sourceCount: Object.keys(validated.report.sources).length,
      bytes: validated.bytes,
      items: validated.report.reviewCandidates,
    } });
    return { accepted: true, unchanged: false, snapshot: validated.snapshot,
      candidateCount: validated.report.reviewCandidateCount,
      listedCount: validated.report.reviewCandidates.length,
      truncated: validated.report.reviewCandidatesTruncated,
      generatedAt: new Date(validated.generatedAt).toISOString() };
  });
}

async function list(page = 0, expectedSnapshot) {
  if (!Number.isSafeInteger(page) || page < 0 || page >= Math.ceil(MAX_CANDIDATES / PAGE_SIZE)) {
    fail('路线审核候选页码无效');
  }
  if (expectedSnapshot !== undefined && (typeof expectedSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSnapshot))) {
    fail('路线审核快照标识无效');
  }
  const snapshot = (await db.collection(COLLECTION).doc(SNAPSHOT_ID).get()).data;
  if (!snapshot) return expectedSnapshot
    ? { available: false, changed: true, items: [], page, hasMore: false }
    : { available: false, items: [], page, hasMore: false };
  if (snapshot.schemaVersion === 2) {
    validateManifest(snapshot);
    if (expectedSnapshot && expectedSnapshot !== snapshot.snapshot) {
      return { available: false, changed: true, items: [], page, hasMore: false };
    }
    if (snapshot.listedCount === 0) return { available: true, snapshot: snapshot.snapshot,
      generatedAt: snapshot.generatedAt, total: snapshot.reviewCandidateCount, listed: 0,
      truncated: false, sourceCount: Object.keys(snapshot.sources).length, items: [], page, hasMore: false };
    const offset = page * PAGE_SIZE;
    if (offset >= snapshot.listedCount) fail('路线审核候选页码超出范围');
    const chunkIndex = Math.floor(offset / CHUNK_ITEMS);
    const chunk = (await db.collection(COLLECTION).doc(chunkId(snapshot.snapshot, chunkIndex)).get()).data;
    const descriptor = snapshot.chunks[chunkIndex];
    if (!chunk || chunk.snapshot !== snapshot.snapshot || chunk.index !== chunkIndex
        || chunk.sha256 !== descriptor.sha256 || chunk.bytes !== descriptor.bytes
        || !Array.isArray(chunk.items) || chunk.items.length !== descriptor.count
        || hash(stableStringify(chunk.items)) !== descriptor.sha256
        || Buffer.byteLength(stableStringify(chunk.items), 'utf8') !== descriptor.bytes
        || chunk.items.some(item => !validStoredCandidate(item))) fail('云端路线审核分片缺失或校验失败', 502, 'ROUTE_AUDIT_CORRUPT');
    const localOffset = offset - chunkIndex * CHUNK_ITEMS;
    const items = await attachMembershipReviewStatus(chunk.items.slice(localOffset, localOffset + PAGE_SIZE));
    return { available: true, snapshot: snapshot.snapshot, generatedAt: snapshot.generatedAt,
      total: snapshot.reviewCandidateCount, listed: snapshot.listedCount, truncated: false,
      sourceCount: Object.keys(snapshot.sources).length, items, page,
      hasMore: offset + items.length < snapshot.listedCount };
  }
  if (snapshot.schemaVersion !== 1 || typeof snapshot.snapshot !== 'string'
      || !/^[a-f0-9]{64}$/.test(snapshot.snapshot) || !Array.isArray(snapshot.items)
      || snapshot.items.length > MAX_ITEMS || !Number.isFinite(Date.parse(snapshot.generatedAt))
      || Date.parse(snapshot.generatedAt) > Date.now() + 5 * 60 * 1000
      || Date.parse(snapshot.generatedAt) < Date.now() - 72 * 60 * 60 * 1000
      || !Number.isSafeInteger(snapshot.candidateCount) || snapshot.candidateCount < 0
      || !Number.isSafeInteger(snapshot.listedCount) || snapshot.listedCount !== snapshot.items.length
      || snapshot.candidateCount < snapshot.listedCount
      || snapshot.truncated !== (snapshot.candidateCount > snapshot.listedCount)
      || !Number.isSafeInteger(snapshot.sourceCount) || snapshot.sourceCount < 1 || snapshot.sourceCount > 64
      || snapshot.items.some(item => !validStoredCandidate(item))) {
    fail('云端路线审核快照格式异常', 502, 'ROUTE_AUDIT_CORRUPT');
  }
  if (expectedSnapshot && expectedSnapshot !== snapshot.snapshot) {
    return { available: false, changed: true, items: [], page, hasMore: false };
  }
  const offset = page * 25;
  if (offset >= snapshot.listedCount) fail('路线审核候选页码无效');
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

module.exports = { publish, list, worker, validateReport, validateManifest };
