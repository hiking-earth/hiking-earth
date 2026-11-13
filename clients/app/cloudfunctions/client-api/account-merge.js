// Resumable account merge for identities proven together by WeChat's one-time
// phone authorization. Source accounts remain locked until every owned record
// and identity link has been moved to the target account.
const crypto = require('crypto');
const { assertNoForeignIdentityOwners, readIdentityRegistryVersion, lockIdentityRegistry } = require('./identity-ownership');

const BATCH_SIZE = 6;
const PHASES = [
  { collection: 'user_documents', field: 'owner', kind: 'identity', move: 'document' },
  { collection: 'team_messages', field: 'owner', kind: 'identity', move: 'field' },
  { collection: 'user_notifications', field: 'owner', kind: 'identity', move: 'field' },
  { collection: 'user_libraries', field: 'owner', kind: 'identity', move: 'library' },
  { collection: 'tracks', field: 'owner', kind: 'identity', move: 'track' },
  { collection: 'team_members', field: 'openid', kind: 'identity', move: 'member' },
  { collection: 'companion_posts', field: 'openid', kind: 'identity', move: 'field' },
  { collection: 'companion_posts', field: 'members', kind: 'identity-array', move: 'post-members' },
  { collection: 'sos_events', field: 'openid', kind: 'identity', move: 'field' },
  { collection: 'community_reports', field: 'reporter', kind: 'identity', move: 'field' },
  { collection: 'teams', field: 'createdBy', kind: 'identity', move: 'field' },
  { collection: 'offline_map_requests', field: 'ownerId', kind: 'owner-hash', move: 'field' },
  { collection: 'offline_map_request_limits', field: 'ownerId', kind: 'owner-hash', move: 'quota' },
  { collection: 'client_phone_identity_links', field: 'accountId', kind: 'account', move: 'field' },
  { collection: 'client_wechat_identity_links', field: 'accountId', kind: 'account', move: 'field' },
  { collection: 'client_qr_logins', field: 'accountId', kind: 'account', move: 'remove' },
  { collection: 'client_wechat_tickets', field: 'accountId', kind: 'account', move: 'remove' },
  { collection: 'client_sessions', field: 'accountId', kind: 'account', move: 'remove' },
  // Append new phases only: phaseIndex is persisted in resumable merge jobs.
  // Preserve overflow snapshots and their IDs when an account is merged again.
  { collection: 'client_account_merge_library_archives', field: 'targetAccountId', kind: 'account', move: 'field' },
  // Keep prior merge-history records under the surviving account so account
  // deletion can remove the full private merge history after chained merges.
  { collection: 'client_account_merges', field: 'targetAccountId', kind: 'account', move: 'field' },
  // Route reviews are shared records, but their reviewer identity must follow a
  // verified account merge without changing the public route-status data.
  { collection: 'route_reviews', field: 'reviewedBy', kind: 'identity', move: 'reviewer' },
];

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const accountId = username => hash(username);
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (message, status = 400, code) => {
  const error = new Error(message); error.status = status; error.code = code; throw error;
};
function validatedMergeCursor(phaseValue, sourceValue, currentSourceCount) {
  const phaseIndex = phaseValue === undefined ? 0 : phaseValue;
  const sourceIndex = sourceValue === undefined ? 0 : sourceValue;
  if (!Number.isSafeInteger(phaseIndex) || phaseIndex < 0 || phaseIndex > PHASES.length
      || !Number.isSafeInteger(sourceIndex) || sourceIndex < 0
      || (phaseIndex === PHASES.length ? sourceIndex !== 0
        : !Number.isSafeInteger(currentSourceCount) || currentSourceCount < 0 || sourceIndex > currentSourceCount)) {
    fail('账号关联进度记录格式异常，迁移已暂停以保护未归并资料', 409, 'MERGE_CURSOR_INVALID');
  }
  return { phaseIndex, sourceIndex };
}
function validateMergeJobIdentity(job) {
  const failJob = () => fail('账号关联任务身份资料格式异常，迁移已暂停以保护未归并资料', 409, 'MERGE_JOB_IDENTITY_INVALID');
  if (!/^[a-f0-9]{64}$/.test(job?.targetAccountId || '')
      || typeof job?.target?.identity !== 'string' || !job.target.identity || job.target.identity.length > 128
      || !Array.isArray(job.sources) || job.sources.length < 1 || job.sources.length > 128
      || !job.phone || !/^[a-f0-9]{64}$/.test(job.phone.hash || '')
      || typeof job.phone.masked !== 'string' || !/^\+[1-9][0-9]{0,2} \*{4}[0-9]{4}$/.test(job.phone.masked)
      || !Number.isSafeInteger(job.phone.verifiedAt) || job.phone.verifiedAt <= 0
      || !job.wechat || typeof job.wechat.appId !== 'string' || !job.wechat.appId || job.wechat.appId.length > 64
      || typeof job.wechat.openId !== 'string' || !job.wechat.openId || job.wechat.openId.length > 128
      || (job.wechat.unionId !== undefined && (typeof job.wechat.unionId !== 'string'
        || !job.wechat.unionId || job.wechat.unionId.length > 128))) failJob();
  const seen = new Set();
  for (const source of job.sources) {
    if (!source || !/^[a-f0-9]{64}$/.test(source.accountId || '') || source.accountId === job.targetAccountId
        || seen.has(source.accountId) || typeof source.identity !== 'string' || !source.identity || source.identity.length > 128) failJob();
    seen.add(source.accountId);
  }
  return true;
}
function validatedAliases(value, label = '账号历史身份资料') {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100
      || value.some(identity => typeof identity !== 'string' || !identity || identity.length > 128)) {
    fail(`${label}格式异常，账号关联已暂停以免遗漏云端数据`, 409, 'MERGE_ALIAS_INVALID');
  }
  return [...new Set(value)];
}
function validatedWechatRows(value, label = '微信历史身份资料') {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) {
    fail(`${label}格式异常，身份关联已暂停以保护账号资料`, 409, 'MERGE_WECHAT_INVALID');
  }
  const rows = new Map();
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.appId !== 'string' || !row.appId || row.appId.length > 64
        || typeof row.openId !== 'string' || !row.openId || row.openId.length > 128
        || (row.unionId !== undefined && (typeof row.unionId !== 'string' || !row.unionId || row.unionId.length > 128))) {
      fail(`${label}格式异常，身份关联已暂停以保护账号资料`, 409, 'MERGE_WECHAT_INVALID');
    }
    const key = JSON.stringify([row.appId, row.openId]), prior = rows.get(key);
    if (prior?.unionId && row.unionId && prior.unionId !== row.unionId) {
      fail(`${label}包含冲突的统一身份，关联已暂停`, 409, 'MERGE_WECHAT_CONFLICT');
    }
    rows.set(key, { appId: row.appId, openId: row.openId,
      ...(row.unionId || prior?.unionId ? { unionId: row.unionId || prior.unionId } : {}) });
  }
  return [...rows.values()];
}
function accountWechatRows(account, label = '微信历史身份资料') {
  const value = account.wechatIdentities;
  const rows = validatedWechatRows(value, label);
  const hasApp = account.wechatAppId !== undefined, hasOpen = account.wechatOpenId !== undefined;
  if (hasApp !== hasOpen) fail(`${label}不完整，身份关联已暂停`, 409, 'MERGE_WECHAT_INVALID');
  const legacy = [];
  if (hasApp) {
    if (typeof account.wechatAppId !== 'string' || !account.wechatAppId || account.wechatAppId.length > 64
        || typeof account.wechatOpenId !== 'string' || !account.wechatOpenId || account.wechatOpenId.length > 128
        || (account.wechatUnionId !== undefined && (typeof account.wechatUnionId !== 'string'
          || !account.wechatUnionId || account.wechatUnionId.length > 128))) {
      fail(`${label}格式异常，身份关联已暂停`, 409, 'MERGE_WECHAT_INVALID');
    }
    legacy.push({ appId: account.wechatAppId, openId: account.wechatOpenId,
      ...(account.wechatUnionId !== undefined ? { unionId: account.wechatUnionId } : {}) });
  }
  else if (account.wechatUnionId !== undefined) fail(`${label}缺少对应账号，身份关联已暂停`, 409, 'MERGE_WECHAT_INVALID');
  return mergeWechatRows(rows, legacy);
}
function mergeWechatRows(...groups) {
  const rows = new Map();
  for (const group of groups) for (const row of group) {
    if (!row || typeof row.appId !== 'string' || !row.appId || row.appId.length > 64
        || typeof row.openId !== 'string' || !row.openId || row.openId.length > 128
        || (row.unionId !== undefined && (typeof row.unionId !== 'string' || !row.unionId || row.unionId.length > 128))) {
      fail('微信历史身份资料格式异常，身份关联已暂停', 409, 'MERGE_WECHAT_INVALID');
    }
    const key = JSON.stringify([row.appId, row.openId]), prior = rows.get(key);
    if (prior?.unionId && row.unionId && prior.unionId !== row.unionId) {
      fail('同一微信身份存在冲突的统一身份记录，关联已暂停', 409, 'MERGE_WECHAT_CONFLICT');
    }
    rows.set(key, { appId: row.appId, openId: row.openId,
      ...(row.unionId || prior?.unionId ? { unionId: row.unionId || prior.unionId } : {}) });
    if (rows.size > 128) fail('微信身份数量超过安全上限，迁移已暂停', 409, 'MERGE_WECHAT_LIMIT');
  }
  return [...rows.values()];
}
function validatedWechatUnionIds(value, label = '微信统一身份资料') {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128
      || value.some(id => typeof id !== 'string' || !id || id.length > 128)) {
    fail(`${label}格式异常，身份关联已暂停以保护账号资料`, 409, 'MERGE_WECHAT_INVALID');
  }
  return [...new Set(value)];
}
const identityValue = (phase, source) => phase.kind === 'account'
  ? source.accountId
  : phase.kind === 'owner-hash' ? hash(source.identity) : source.identity;
const sourceIdentities = job => [...new Set((job.sources || []).flatMap(source => {
  if (!source || typeof source.identity !== 'string' || !source.identity || source.identity.length > 128) {
    fail('账号关联来源身份格式异常，迁移已暂停以免遗漏云端数据', 409, 'MERGE_IDENTITY_INVALID');
  }
  return [source.identity, ...validatedAliases(source.identityAliases, '来源账号历史身份资料')];
}))];

function validateDistinctIdentityOwners(owners) {
  const claimed = new Map();
  for (const owner of owners) {
    if (!owner || !/^[a-f0-9]{64}$/.test(owner.accountId || '')
        || typeof owner.identity !== 'string' || !owner.identity || owner.identity.length > 128) {
      fail('账号身份资料格式异常，关联已暂停以保护云端数据', 409, 'MERGE_IDENTITY_INVALID');
    }
    const identities = new Set([owner.identity, ...validatedAliases(owner.identityAliases, '账号历史身份资料')]);
    for (const identity of identities) {
      const priorOwner = claimed.get(identity);
      if (priorOwner !== undefined && priorOwner !== owner.accountId) {
        fail('不同账号的历史身份资料存在重叠，关联已暂停以避免跨账号迁移', 409, 'MERGE_IDENTITY_COLLISION');
      }
      claimed.set(identity, owner.accountId);
    }
  }
}

function validatedLibrarySnapshot(row, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail(`${label}格式异常，账号关联已暂停以保护收藏与行程`, 409, 'MERGE_LIBRARY_INVALID');
  }
  const favorites = row.favorites === undefined ? [] : row.favorites;
  const plans = row.plans === undefined ? [] : row.plans;
  if (!Array.isArray(favorites) || favorites.length > 400
      || favorites.some(id => typeof id !== 'string' || !id || id.length > 128)
      || !Array.isArray(plans) || plans.length > 200) {
    fail(`${label}格式异常，账号关联已暂停以保护收藏与行程`, 409, 'MERGE_LIBRARY_INVALID');
  }
  for (const plan of plans) {
    let dateValid = false;
    if (typeof plan?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(plan.date)) {
      const parsed = Date.parse(plan.date);
      dateValid = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === plan.date;
    }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)
        || Object.keys(plan).length !== 5 || !['id', 'routeId', 'date', 'notes', 'packed'].every(key => key in plan)
        || typeof plan.id !== 'string' || !plan.id || plan.id.length > 128
        || typeof plan.routeId !== 'string' || !plan.routeId || plan.routeId.length > 128
        || !dateValid || typeof plan.notes !== 'string' || plan.notes.length > 2000
        || typeof plan.packed !== 'boolean') {
      fail(`${label}中的行程格式异常，账号关联已暂停以保护资料`, 409, 'MERGE_LIBRARY_INVALID');
    }
  }
  if (row.version !== undefined && (!Number.isSafeInteger(row.version) || row.version < 0)) {
    fail(`${label}版本异常，账号关联已暂停以保护资料`, 409, 'MERGE_LIBRARY_INVALID');
  }
  return { ...row, favorites, plans, version: row.version === undefined ? 0 : row.version };
}

function mergeLibrary(source, target, targetIdentity) {
  source = validatedLibrarySnapshot(source, '来源账号收藏与行程');
  target = validatedLibrarySnapshot(target, '目标账号收藏与行程');
  const favorites = [...new Set([...target.favorites, ...source.favorites])];
  const plans = new Map();
  const samePlan = (left, right) => ['routeId', 'date', 'notes'].every(key => left?.[key] === right?.[key]);
  for (const plan of [...target.plans, ...source.plans]) {
    if (plan && typeof plan.id === 'string') {
      const existing = plans.get(plan.id);
      if (!existing) { plans.set(plan.id, plan); continue; }
      if (samePlan(existing, plan)) {
        if (plan.packed === true && existing.packed !== true) plans.set(plan.id, { ...existing, packed: true });
      } else {
        // Same ID with different trip content is a conflict, not a duplicate.
        // Preserve the alternate under a deterministic ID so retries do not
        // create copies and neither account's plan is silently discarded.
        const planRevision = value => Number(value.updatedAt || value.createdAt || 0);
        const incomingWins = planRevision(plan) > planRevision(existing);
        const kept = incomingWins ? plan : existing;
        const alternate = incomingWins ? existing : plan;
        plans.set(plan.id, kept);
        const seed = hash(JSON.stringify([targetIdentity, alternate]));
        for (let attempt = 0; ; attempt++) {
          const restoredId = `restored-${seed.slice(0, 32)}${attempt ? `-${attempt}` : ''}`;
          const priorRestored = plans.get(restoredId);
          if (!priorRestored) { plans.set(restoredId, { ...alternate, id: restoredId }); break; }
          if (samePlan(priorRestored, alternate)) {
            if (alternate.packed === true && priorRestored.packed !== true) {
              plans.set(restoredId, { ...priorRestored, packed: true });
            }
            break;
          }
        }
      }
    }
  }
  const merged = { ...target, owner: targetIdentity, favorites, plans: [...plans.values()],
    version: Math.max(Number(target.version) || 0, Number(source.version) || 0) + 1,
    updatedAt: Math.max(Number(target.updatedAt) || 0, Number(source.updatedAt) || 0, Date.now()) };
  delete merged._id;
  return merged;
}

function documentDestination(row, targetIdentity) {
  if (row.kind === 'team_creation' && typeof row.requestId === 'string' && row.requestId) {
    return hash(JSON.stringify(['team_creation', targetIdentity, row.requestId]));
  }
  if (['diary', 'comment'].includes(row.kind) && typeof row.clientId === 'string' && row.clientId) {
    return hash(`${targetIdentity}:${row.kind}:${row.clientId}`);
  }
  if (row.kind === 'registration' && typeof row.postId === 'string' && row.postId) {
    return hash(`${targetIdentity}:registration:${row.postId}`);
  }
  return row._id;
}

function mergePostMemberIdentity(value, sourceIdentity, targetIdentity) {
  if (!Array.isArray(value) || value.length > 50
      || value.some(identity => typeof identity !== 'string' || !identity || identity.length > 128)) {
    fail('约伴活动成员资料格式异常，账号关联已暂停以保护报名信息', 409, 'MERGE_POST_MEMBERS_INVALID');
  }
  if (!value.includes(sourceIdentity)) return null;
  return [...new Set(value.map(identity => identity === sourceIdentity ? targetIdentity : identity))];
}

async function moveRecord(db, phase, row, source, target) {
  const sourceRef = db.collection(phase.collection).doc(row._id);
  const sourceIdentity = source.identity;
  const targetIdentity = target.identity;
  if (phase.move === 'remove') {
    await db.runTransaction(async tx => {
      const ref = tx.collection(phase.collection).doc(row._id);
      if ((await ref.get()).data) await ref.remove();
    });
    return;
  }
  if (phase.move === 'reviewer') {
    await db.runTransaction(async tx => {
      const ref = tx.collection(phase.collection).doc(row._id);
      const current = (await ref.get()).data;
      if (!current || current[phase.field] !== sourceIdentity) return;
      const version = current.version === undefined ? 0 : current.version;
      if (!Number.isSafeInteger(version) || version < 0) {
        fail('路线审核版本资料格式异常，账号关联已暂停以保护审核记录', 409, 'MERGE_REVIEW_VERSION_INVALID');
      }
      await ref.update({ data: { [phase.field]: targetIdentity, version: version + 1 } });
    });
    return;
  }
  if (phase.move === 'field') {
    await db.runTransaction(async tx => {
      const ref = tx.collection(phase.collection).doc(row._id);
      if (!(await ref.get()).data) return;
      await ref.update({ data: { [phase.field]: phase.kind === 'account' ? target.accountId
        : phase.kind === 'owner-hash' ? hash(targetIdentity) : targetIdentity } });
    });
    return;
  }
  if (phase.move === 'post-members') {
    await db.runTransaction(async tx => {
      const ref = tx.collection(phase.collection).doc(row._id);
      const current = (await ref.get()).data;
      if (!current) return;
      const members = mergePostMemberIdentity(current.members, sourceIdentity, targetIdentity);
      // A concurrent or retried merge may already have moved this identity.
      // Avoid incrementing joinVersion and invalidating moderation on a no-op.
      if (!members) return;
      const joinVersion = current.joinVersion === undefined ? 0 : current.joinVersion;
      if (!Number.isSafeInteger(joinVersion) || joinVersion < 0) {
        fail('约伴活动版本资料格式异常，账号关联已暂停以保护审核状态', 409, 'MERGE_POST_VERSION_INVALID');
      }
      const maxMembers = current.maxMembers === undefined ? Infinity : current.maxMembers;
      if (maxMembers !== Infinity && (!Number.isSafeInteger(maxMembers) || maxMembers < 2 || maxMembers > 50)) {
        fail('约伴活动人数上限资料异常，账号关联已暂停以保护报名信息', 409, 'MERGE_POST_CAPACITY_INVALID');
      }
      await ref.update({ data: { members, _members_count: members.length,
        joinVersion: joinVersion + 1,
        status: ['open', 'full'].includes(current.status) ? (members.length >= maxMembers ? 'full' : 'open') : current.status } });
    });
    return;
  }
  if (phase.move === 'quota') {
    const destinationId = hash(targetIdentity).slice(0, 32);
    if (destinationId === row._id) {
      await sourceRef.update({ data: { ownerId: hash(targetIdentity) } });
      return;
    }
    await db.runTransaction(async tx => {
      const fromRef = tx.collection(phase.collection).doc(row._id);
      const toRef = tx.collection(phase.collection).doc(destinationId);
      const currentSource = (await fromRef.get()).data;
      if (!currentSource) return;
      const currentTarget = (await toRef.get()).data;
      const createdAt = Math.max(Number(currentSource.createdAt) || 0, Number(currentTarget?.createdAt) || 0);
      const expiresAt = Math.max(Number(currentSource.expiresAt) || 0, Number(currentTarget?.expiresAt) || 0);
      await toRef.set({ data: { ...(currentTarget || currentSource), ownerId: hash(targetIdentity), createdAt, expiresAt } });
      await fromRef.remove();
    });
    return;
  }

  const data = { ...row };
  delete data._id;
  let destinationId = row._id;
  if (phase.move === 'document') {
    destinationId = documentDestination(row, targetIdentity);
    data.owner = targetIdentity;
  } else if (phase.move === 'track') {
    destinationId = hash(JSON.stringify([targetIdentity, row.trackId]));
    data.owner = targetIdentity;
  } else if (phase.move === 'library') {
    destinationId = hash(targetIdentity);
    data.owner = targetIdentity;
  } else if (phase.move === 'member') {
    destinationId = hash(JSON.stringify([row.teamId, targetIdentity]));
    data.openid = targetIdentity;
    // Location sharing is opt-in for each account identity; never carry a live
    // coordinate or restore sharing merely because two identities were merged.
    data.latitude = null; data.longitude = null; data.updatedAt = 0;
  }

  if (destinationId === row._id) {
    await sourceRef.update({ data });
    return;
  }
  await db.runTransaction(async tx => {
    const fromRef = tx.collection(phase.collection).doc(row._id);
    const toRef = tx.collection(phase.collection).doc(destinationId);
    const currentSource = (await fromRef.get()).data;
    if (!currentSource) return;
    const currentTarget = (await toRef.get()).data;
    let merged = data;
    if (phase.move === 'library') {
      merged = currentTarget ? mergeLibrary(data, currentTarget, targetIdentity) : { ...data, owner: targetIdentity };
      if (merged.favorites.length > 400 || merged.plans.length > 200) {
        const archiveId = hash(JSON.stringify(['client_account_merge_library', target.accountId, sourceIdentity]));
        const archiveRef = tx.collection('client_account_merge_library_archives').doc(archiveId);
        const archive = (await archiveRef.get()).data;
        if (archive && (archive.targetAccountId !== target.accountId || archive.sourceIdentity !== sourceIdentity)) {
          fail('收藏与行程归档标识冲突，账号关联已暂停保护资料', 409, 'MERGE_LIBRARY_ARCHIVE_CONFLICT');
        }
        if (!archive) await archiveRef.set({ data: {
          targetAccountId: target.accountId, sourceIdentity,
          favorites: Array.isArray(data.favorites) ? data.favorites : [],
          plans: Array.isArray(data.plans) ? data.plans : [],
          sourceVersion: Number(data.version) || 0,
          sourceUpdatedAt: Number(data.updatedAt) || 0,
          createdAt: Date.now(),
        } });
        await fromRef.remove();
        return;
      }
      await toRef.set({ data: merged });
      await fromRef.remove();
      return;
    }
    else if (currentTarget && phase.move === 'track') {
      const sourceTime = Math.max(Number(data.syncedAt) || 0, Number(data.deletedAt) || 0);
      const targetTime = Math.max(Number(currentTarget.syncedAt) || 0, Number(currentTarget.deletedAt) || 0);
      const sourceWins = (Number(data.version) || 0) > (Number(currentTarget.version) || 0)
        || ((Number(data.version) || 0) === (Number(currentTarget.version) || 0) && sourceTime > targetTime);
      merged = sourceWins ? data : currentTarget;
      merged = { ...merged, owner: targetIdentity };
    } else if (currentTarget && phase.move === 'member') {
      merged = { ...data, ...currentTarget, openid: targetIdentity,
        isLeader: data.isLeader === true || currentTarget.isLeader === true,
        joinedAt: Math.min(Number(data.joinedAt) || Date.now(), Number(currentTarget.joinedAt) || Date.now()),
        latitude: null, longitude: null, updatedAt: 0 };
      const teamRef = tx.collection('teams').doc(row.teamId);
      const team = (await teamRef.get()).data;
      if (team && Number.isFinite(team.memberCount)) await teamRef.update({ data: { memberCount: Math.max(0, team.memberCount - 1) } });
    } else if (currentTarget && phase.move === 'document') {
      const sourceRevision = Math.max(Number(data.version) || 0, Number(data.updatedAt) || 0, Number(data.createdAt) || 0);
      const targetRevision = Math.max(Number(currentTarget.version) || 0, Number(currentTarget.updatedAt) || 0, Number(currentTarget.createdAt) || 0);
      merged = sourceRevision > targetRevision ? data : currentTarget;
      merged = { ...merged, owner: targetIdentity };
    }
    await toRef.set({ data: merged });
    await fromRef.remove();
  });
}

function service({ db, newSession }) {
  async function listLibraryArchives(account) {
    const targetAccountId = accountId(account.username);
    const rows = (await db.collection('client_account_merge_library_archives')
      .where({ targetAccountId }).orderBy('createdAt', 'desc').limit(100).get()).data || [];
    return { archives: rows.map(row => ({ id: row._id,
      favorites: Array.isArray(row.favorites) ? row.favorites.length : 0,
      plans: Array.isArray(row.plans) ? row.plans.length : 0,
      createdAt: Number(row.createdAt) || 0 })) };
  }

  async function restoreLibraryArchive(account, archiveId) {
    if (!/^[a-f0-9]{64}$/.test(archiveId || '')) fail('收藏与行程归档编号无效');
    const targetAccountId = accountId(account.username);
    const targetIdentity = account.identity;
    return db.runTransaction(async tx => {
      const archiveRef = tx.collection('client_account_merge_library_archives').doc(archiveId);
      const archive = (await archiveRef.get()).data;
      if (!archive || archive.targetAccountId !== targetAccountId) fail('没有这份收藏与行程归档', 404, 'LIBRARY_ARCHIVE_NOT_FOUND');
      if (!Array.isArray(archive.favorites) || !Array.isArray(archive.plans)
          || archive.favorites.length > 400 || archive.plans.length > 200) {
        fail('归档资料结构超出当前恢复范围；归档仍保留，请联系管理员', 409, 'LIBRARY_ARCHIVE_INVALID');
      }
      const libraryRef = tx.collection('user_libraries').doc(hash(targetIdentity));
      const current = (await libraryRef.get()).data || { owner: targetIdentity, favorites: [], plans: [], version: 0 };
      if (!Array.isArray(current.favorites) || !Array.isArray(current.plans)) {
        fail('当前云端收藏或行程格式异常，归档仍保留；请先导出并修复当前资料', 409, 'LIBRARY_CURRENT_INVALID');
      }
      const merged = mergeLibrary(archive, current, targetIdentity);
      if (merged.favorites.length > 400 || merged.plans.length > 200) {
        fail('恢复后会超过收藏400条或行程200项的容量；请先整理当前资料，归档仍保留', 409, 'LIBRARY_ARCHIVE_CAPACITY');
      }
      await libraryRef.set({ data: { ...merged,
        version: (Number(current.version) || 0) + 1,
        updatedAt: Date.now() } });
      await archiveRef.remove();
      return { restored: true, favorites: archive.favorites.length, plans: archive.plans.length,
        version: (Number(current.version) || 0) + 1 };
    });
  }

  async function continueMerge(token) {
    if (!validToken(token)) fail('账号关联凭据无效，请重新授权', 401, 'MERGE_TOKEN_INVALID');
    const jobId = (await db.collection('client_account_merges').where({ secretHash: hash(token), status: 'running' }).limit(1).get()).data?.[0]?._id;
    if (!jobId) {
      const completed = (await db.collection('client_account_merges').where({ secretHash: hash(token), status: 'complete' }).limit(1).get()).data?.[0];
      if (!completed) fail('账号关联任务已失效，请重新授权手机号', 401, 'MERGE_TOKEN_INVALID');
      const account = (await db.collection('client_accounts').doc(completed.targetAccountId).get()).data;
      if (!account || account.disabled || account.deleting || account.merging) fail('合并后账号状态异常，请联系管理员', 409, 'MERGE_ACCOUNT_INVALID');
      // A completed merge token may only recover the session created by the
      // completion response. If the user has signed out and that session was
      // removed, the old merge token must not silently mint it again.
      const session = await newSession(account, { token, expiresAt: completed.sessionExpiresAt, allowExistingOnly: true });
      return { complete: true, session, sourceIdentities: completed.sourceIdentities || [] };
    }
    const jobRef = db.collection('client_account_merges').doc(jobId);
    const job = (await jobRef.get()).data;
    if (!job || job.status !== 'running' || !Array.isArray(job.sources) || !job.target) fail('账号关联任务状态无效', 409, 'MERGE_JOB_INVALID');
    validateMergeJobIdentity(job);
    validatedAliases(job.target.identityAliases, '目标账号历史身份资料');
    for (const source of job.sources) {
      if (source?.identityAliases !== undefined) validatedAliases(source.identityAliases, '来源账号历史身份资料');
    }
    if (job.secretHash !== hash(token)) fail('账号关联凭据无效，请重新授权', 401, 'MERGE_TOKEN_INVALID');
    if (!Number.isSafeInteger(job.sessionExpiresAt) || job.sessionExpiresAt <= Date.now()) {
      fail('关联凭据已过期，请重新进行微信手机号授权后继续迁移', 401, 'MERGE_TOKEN_EXPIRED');
    }
    // Older resumable jobs were created before identityAliases were snapshotted.
    // Their source accounts remain locked until completion, so hydrate aliases
    // from that locked record and persist them before any identity phase runs.
    if (job.sources.some(source => source.identityAliases === undefined)) {
      const sources = await Promise.all(job.sources.map(async source => {
        if (source.identityAliases !== undefined) {
          validatedAliases(source.identityAliases, '来源账号历史身份资料');
          return source;
        }
        const account = (await db.collection('client_accounts').doc(source.accountId).get()).data;
        if (!account || account.merging !== true || account.mergeJobId !== jobId || account.identity !== source.identity) {
          fail('旧版账号关联任务的来源锁已改变，暂停迁移保护资料', 409, 'MERGE_SOURCE_CHANGED');
        }
        const aliases = validatedAliases(account.identityAliases, '来源账号历史身份资料')
          .filter(value => value !== account.identity);
        return { ...source, identityAliases: aliases };
      }));
      await db.runTransaction(async tx => {
        const current = (await tx.collection('client_account_merges').doc(jobId).get()).data;
        if (!current || current.status !== 'running' || current.secretHash !== hash(token)) {
          fail('账号关联任务状态已改变，请重新授权', 409, 'MERGE_JOB_CHANGED');
        }
        await tx.collection('client_account_merges').doc(jobId).update({ data: { sources, updatedAt: Date.now() } });
      });
      job.sources = sources;
    }
    const currentTarget = (await db.collection('client_accounts').doc(job.targetAccountId).get()).data;
    if (!currentTarget || !currentTarget.merging || currentTarget.mergeJobId !== jobId
        || currentTarget.identity !== job.target.identity) {
      fail('目标账号关联状态已改变，暂停迁移保护资料', 409, 'MERGE_TARGET_CHANGED');
    }
    const targetAliases = validatedAliases(currentTarget.identityAliases, '目标账号历史身份资料');
    job.target = { ...job.target, identityAliases: targetAliases };
    validateDistinctIdentityOwners([
      { accountId: job.targetAccountId, identity: job.target.identity, identityAliases: targetAliases },
      ...job.sources,
    ]);
    await assertNoForeignIdentityOwners(db, db.command, [
      { accountId: job.targetAccountId, identity: job.target.identity, identityAliases: targetAliases },
      ...job.sources,
    ]);
    const resultingAliases = [...new Set([...targetAliases, ...sourceIdentities(job)]
      .filter(value => value !== currentTarget.identity))];
    if (resultingAliases.length > 100) {
      fail('合并后的历史身份超过100项安全上限，迁移已暂停以免注销时遗漏资料', 409, 'MERGE_ALIAS_LIMIT');
    }
    const target = { ...job.target, accountId: job.targetAccountId };
    const phaseValue = job.phaseIndex === undefined ? 0 : job.phaseIndex;
    const currentPhaseSourceCount = phaseValue < PHASES.length
      ? (PHASES[phaseValue]?.kind === 'account' ? job.sources.length : sourceIdentities(job).length)
      : 0;
    const cursor = validatedMergeCursor(job.phaseIndex, job.sourceIndex, currentPhaseSourceCount);
    let phaseIndex = cursor.phaseIndex;
    let sourceIndex = cursor.sourceIndex;
    let budget = BATCH_SIZE;

    while (phaseIndex < PHASES.length && budget > 0) {
      const phase = PHASES[phaseIndex];
      // Account-linked records are keyed by the unique source account ID;
      // identity-owned records also include aliases from earlier merges.
      const sources = phase.kind === 'account' ? job.sources : sourceIdentities(job).map(identity => ({ identity }));
      const source = sources[sourceIndex];
      if (!source) { phaseIndex++; sourceIndex = 0; continue; }
      const key = identityValue(phase, source);
      if (phase.kind !== 'account' && key === identityValue(phase, target)) { sourceIndex++; continue; }
      const rows = (await db.collection(phase.collection).where({ [phase.field]: key }).limit(Math.min(budget, BATCH_SIZE)).get()).data || [];
      if (!rows.length) { sourceIndex++; continue; }
      for (const row of rows) {
        await moveRecord(db, phase, row, source, target);
        budget--;
      }
      const migrated = (Number(job.migrated) || 0) + rows.length;
      await jobRef.update({ data: { phaseIndex, sourceIndex, migrated, updatedAt: Date.now() } });
      return { complete: false, migrated };
    }
    if (phaseIndex < PHASES.length) {
      await jobRef.update({ data: { phaseIndex, sourceIndex, migrated: Number(job.migrated) || 0, updatedAt: Date.now() } });
      return { complete: false, migrated: Number(job.migrated) || 0 };
    }

    const latestJob = (await jobRef.get()).data;
    const identityRegistryVersion = await readIdentityRegistryVersion(db);
    await assertNoForeignIdentityOwners(db, db.command, [
      { accountId: job.targetAccountId, identity: job.target.identity, identityAliases: job.target.identityAliases },
      ...job.sources,
    ]);
    await db.runTransaction(async tx => {
      await lockIdentityRegistry(tx, identityRegistryVersion);
      const currentJob = (await tx.collection('client_account_merges').doc(jobId).get()).data;
      if (!currentJob || currentJob.status !== 'running' || currentJob.secretHash !== hash(token)) fail('账号关联任务状态已改变，请重新授权', 409, 'MERGE_JOB_CHANGED');
      const targetRef = tx.collection('client_accounts').doc(currentJob.targetAccountId);
      const currentTarget = (await targetRef.get()).data;
      if (!currentTarget || !currentTarget.merging || currentTarget.mergeJobId !== jobId) fail('目标账号关联状态已改变', 409, 'MERGE_TARGET_CHANGED');
      const targetAliases = validatedAliases(currentTarget.identityAliases, '目标账号历史身份资料');
      const mergedAliases = [...new Set([...targetAliases, ...sourceIdentities(currentJob)]
        .filter(value => value !== currentTarget.identity))];
      if (mergedAliases.length > 100) {
        fail('合并后的历史身份超过100项安全上限，迁移已暂停以免注销时遗漏资料', 409, 'MERGE_ALIAS_LIMIT');
      }
      const now = Date.now();
      const wechat = currentJob.wechat || {};
      if (typeof wechat.appId !== 'string' || !wechat.appId || wechat.appId.length > 64
          || typeof wechat.openId !== 'string' || !wechat.openId || wechat.openId.length > 128
          || (wechat.unionId !== undefined && (!wechat.unionId || typeof wechat.unionId !== 'string' || wechat.unionId.length > 128))) {
        fail('待关联微信身份资料格式异常，迁移已暂停', 409, 'MERGE_WECHAT_INVALID');
      }
      const allWechatIdentities = mergeWechatRows(
        accountWechatRows(currentTarget),
        validatedWechatRows(currentJob.target?.wechatIdentities),
        ...currentJob.sources.map(item => validatedWechatRows(item.wechatIdentities, '来源微信历史身份资料')),
        [{ appId: wechat.appId, openId: wechat.openId, ...(wechat.unionId ? { unionId: wechat.unionId } : {}) }],
      );
      const mergedWechatIdentities = allWechatIdentities;
      const unionIdLists = [
        validatedWechatUnionIds(currentTarget.wechatUnionIds),
        ...(currentTarget.wechatUnionId !== undefined ? [[currentTarget.wechatUnionId]] : []),
        validatedWechatUnionIds(currentJob.target?.wechatUnionIds),
        ...currentJob.sources.map(item => validatedWechatUnionIds(item.wechatUnionIds, '来源微信统一身份资料')),
        mergedWechatIdentities.map(item => item.unionId).filter(Boolean),
        ...(wechat.unionId ? [[wechat.unionId]] : []),
      ];
      if (currentTarget.wechatUnionId !== undefined
          && (typeof currentTarget.wechatUnionId !== 'string' || !currentTarget.wechatUnionId || currentTarget.wechatUnionId.length > 128)) {
        fail('微信统一身份资料格式异常，迁移已暂停', 409, 'MERGE_WECHAT_INVALID');
      }
      const mergedWechatUnionIds = [...new Set(unionIdLists.flat())];
      if (mergedWechatUnionIds.length > 128) fail('微信统一身份数量超过安全上限，迁移已暂停', 409, 'MERGE_WECHAT_LIMIT');
      const acceptedAccountIds = new Set([currentJob.targetAccountId, ...currentJob.sources.map(item => item.accountId)]);
      const ensureIdentityLink = async (collection, key, value) => {
        if (!key || !value) return;
        const ref = tx.collection(collection).doc(key);
        const existing = (await ref.get()).data;
        if (existing && !acceptedAccountIds.has(existing.accountId)) {
          fail('微信身份已被另一个账号占用，关联已暂停保护双方资料', 409, 'MERGE_IDENTITY_CONFLICT');
        }
        await ref.set({ data: { ...(existing || {}), ...value, accountId: currentJob.targetAccountId,
          createdAt: existing?.createdAt || now, updatedAt: now } });
      };
      await ensureIdentityLink('client_phone_identity_links', currentJob.phone.hash,
        { kind: 'phone', masked: currentJob.phone.masked, verifiedAt: currentJob.phone.verifiedAt });
      await ensureIdentityLink('client_wechat_identity_links', hash(`wechat-openid:${wechat.appId}:${wechat.openId}`),
        { kind: 'openid', appId: wechat.appId });
      if (wechat.unionId) await ensureIdentityLink('client_wechat_identity_links', hash(`wechat-unionid:${wechat.unionId}`),
        { kind: 'unionid' });
      await targetRef.update({ data: {
        identityAliases: mergedAliases,
        phoneIdentityHash: currentJob.phone.hash,
        phoneMasked: currentJob.phone.masked,
        phoneVerifiedAt: currentJob.phone.verifiedAt,
        wechatAppId: wechat.appId,
        wechatOpenId: wechat.openId,
        ...(wechat.unionId ? { wechatUnionId: wechat.unionId } : {}),
        wechatIdentities: mergedWechatIdentities,
        wechatUnionIds: mergedWechatUnionIds,
        nickname: currentTarget.nickname && currentTarget.nickname !== '山友' ? currentTarget.nickname
          : (currentJob.sources.find(item => item.nickname && item.nickname !== '山友')?.nickname || currentTarget.nickname || '山友'),
        merging: false, mergeJobId: '', mergedAt: now, sessionVersion: (Number(currentTarget.sessionVersion) || 0) + 1,
      } });
      for (const source of currentJob.sources) {
        const sourceRef = tx.collection('client_accounts').doc(source.accountId);
        const currentSource = (await sourceRef.get()).data;
        if (!currentSource) continue;
        if (!currentSource.merging || currentSource.mergeJobId !== jobId) fail('来源账号关联状态已改变', 409, 'MERGE_SOURCE_CHANGED');
        await sourceRef.update({ data: { disabled: true, mergedIntoAccountId: currentJob.targetAccountId,
          mergedAt: now, merging: false, mergeJobId: '', sessionVersion: (Number(currentSource.sessionVersion) || 0) + 1 } });
      }
      await tx.collection('client_account_merges').doc(jobId).update({ data: { status: 'complete', completedAt: now,
        secretHash: hash(token), sessionExpiresAt: latestJob.sessionExpiresAt || now + 7 * 24 * 60 * 60 * 1000,
        phaseIndex: PHASES.length, sourceIdentities: mergedAliases } });
    });
    const account = (await db.collection('client_accounts').doc(job.targetAccountId).get()).data;
    const session = await newSession(account, { token, expiresAt: job.sessionExpiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return { complete: true, session, sourceIdentities: [...new Set([...validatedAliases(job.target.identityAliases, '目标账号历史身份资料'), ...sourceIdentities(job)].filter(value => value !== job.target.identity))] };
  }
  return { continueMerge, listLibraryArchives, restoreLibraryArchive };
}

module.exports = { service, hash, accountId, validToken, PHASES, mergeLibrary, validatedLibrarySnapshot,
  mergePostMemberIdentity, validatedMergeCursor, validateMergeJobIdentity };
