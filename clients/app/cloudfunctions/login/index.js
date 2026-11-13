// Trusted Mini Program context; never accept OPENID/UNIONID from request data.
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { assertNoForeignIdentityOwners, readIdentityRegistryVersion, lockIdentityRegistry } = require('./identity-ownership');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
function verifiedPhoneIdentity(response, hmacKey) {
  const info = response?.phoneInfo || response?.phone_info || {};
  const countryCode = String(info.countryCode || info.country_code || '').replace(/\D/g, '');
  const pureNumber = String(info.purePhoneNumber || info.pure_phone_number || '').replace(/\D/g, '');
  const fullNumber = String(info.phoneNumber || info.phone_number || '').replace(/\D/g, '');
  // WeChat's full phoneNumber can include the country prefix. Only strip it
  // when falling back to that field; purePhoneNumber is already national form.
  const number = pureNumber || (countryCode && fullNumber.startsWith(countryCode)
    ? fullNumber.slice(countryCode.length) : fullNumber);
  if (!/^[1-9][0-9]{0,2}$/.test(countryCode) || !/^[0-9]{6,12}$/.test(number)
      || !/^[1-9][0-9]{7,14}$/.test(`${countryCode}${number}`)) {
    throw new Error('微信未返回有效的授权手机号');
  }
  return {
    hash: crypto.createHmac('sha256', hmacKey).update(`+${countryCode}${number}`).digest('hex'),
    masked: `+${countryCode} ****${number.slice(-4)}`,
    verifiedAt: Date.now(),
  };
}
function wechatIdentities(account) {
  const stored = account?.wechatIdentities;
  if (stored !== undefined && (!Array.isArray(stored) || stored.length > 128)) {
    throw new Error('微信历史身份资料格式异常，身份关联已暂停');
  }
  const rows = stored === undefined ? [] : [...stored];
  const hasLegacyApp = account?.wechatAppId !== undefined, hasLegacyOpen = account?.wechatOpenId !== undefined;
  if (hasLegacyApp !== hasLegacyOpen) throw new Error('微信历史身份资料不完整，身份关联已暂停');
  if (hasLegacyApp) {
    if (typeof account.wechatAppId !== 'string' || !account.wechatAppId || account.wechatAppId.length > 64
        || typeof account.wechatOpenId !== 'string' || !account.wechatOpenId || account.wechatOpenId.length > 128) {
      throw new Error('微信历史身份资料格式异常，身份关联已暂停');
    }
    if (account.wechatUnionId !== undefined
        && (typeof account.wechatUnionId !== 'string' || !account.wechatUnionId || account.wechatUnionId.length > 128)) {
      throw new Error('微信历史统一身份资料格式异常，身份关联已暂停');
    }
    rows.unshift({ appId: account.wechatAppId,
      openId: account.wechatOpenId, ...(account.wechatUnionId ? { unionId: account.wechatUnionId } : {}) });
  } else if (account?.wechatUnionId !== undefined) {
    throw new Error('微信历史统一身份资料缺少对应账号，身份关联已暂停');
  }
  const unique = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.appId !== 'string' || !row.appId || row.appId.length > 64
        || typeof row.openId !== 'string' || !row.openId || row.openId.length > 128
        || (row.unionId !== undefined && (typeof row.unionId !== 'string' || !row.unionId || row.unionId.length > 128))) {
      throw new Error('微信历史身份资料格式异常，身份关联已暂停');
    }
    const key = JSON.stringify([row.appId, row.openId]), previous = unique.get(key);
    if (previous?.unionId && row.unionId && previous.unionId !== row.unionId) {
      throw new Error('同一微信身份存在冲突的统一身份记录，关联已暂停');
    }
    unique.set(key, { appId: row.appId, openId: row.openId,
      ...(row.unionId || previous?.unionId ? { unionId: row.unionId || previous.unionId } : {}) });
  }
  return [...unique.values()];
}
function validatedWechatUnionIds(account) {
  const value = account?.wechatUnionIds;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128
      || value.some(id => typeof id !== 'string' || !id || id.length > 128)) {
    throw new Error('微信历史统一身份资料格式异常，身份关联已暂停');
  }
  return [...new Set(value)];
}
function accountWechatUnionIds(account) {
  const ids = validatedWechatUnionIds(account);
  if (account?.wechatUnionId !== undefined) {
    if (typeof account.wechatUnionId !== 'string' || !account.wechatUnionId || account.wechatUnionId.length > 128) {
      throw new Error('微信历史统一身份资料格式异常，身份关联已暂停');
    }
    ids.push(account.wechatUnionId);
  }
  const unique = [...new Set(ids)];
  if (unique.length > 128) throw new Error('微信统一身份数量超过安全上限，身份关联已暂停');
  return unique;
}
function withWeChatIdentity(account, context) {
  if (typeof context?.APPID !== 'string' || !context.APPID || context.APPID.length > 64
      || typeof context?.OPENID !== 'string' || !context.OPENID || context.OPENID.length > 128
      || (context.UNIONID && (typeof context.UNIONID !== 'string' || context.UNIONID.length > 128))) {
    throw new Error('当前微信身份凭证格式异常，关联已暂停');
  }
  const rows = new Map(wechatIdentities(account).map(row => [JSON.stringify([row.appId, row.openId]), row]));
  const key = JSON.stringify([context.APPID, context.OPENID]);
  const prior = rows.get(key);
  if (prior?.unionId && context.UNIONID && prior.unionId !== context.UNIONID) {
    throw new Error('当前微信身份与历史统一身份记录冲突，关联已暂停');
  }
  rows.set(key, { appId: context.APPID, openId: context.OPENID,
    ...(context.UNIONID || prior?.unionId ? { unionId: context.UNIONID || prior.unionId } : {}) });
  const wechatIdentitiesList = [...rows.values()];
  if (wechatIdentitiesList.length > 128) throw new Error('微信身份数量超过安全上限，身份关联已暂停');
  const wechatUnionIds = [...new Set([...accountWechatUnionIds(account), ...wechatIdentitiesList.map(row => row.unionId).filter(Boolean)])];
  if (wechatUnionIds.length > 128) throw new Error('微信统一身份数量超过安全上限，身份关联已暂停');
  return { wechatIdentities: wechatIdentitiesList,
    wechatUnionIds };
}
function hasWeChatIdentity(account, context) {
  return wechatIdentities(account).some(row => row.appId === context.APPID && row.openId === context.OPENID
    && (!row.unionId || !context.UNIONID || row.unionId === context.UNIONID));
}

function validatedIdentityAliases(account) {
  const value = account?.identityAliases;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100
      || value.some(identity => typeof identity !== 'string' || !identity || identity.length > 128)) {
    throw new Error('账号历史身份资料格式异常，身份关联已暂停以保护云端数据');
  }
  return [...new Set(value.filter(identity => identity !== account.identity))];
}

function validateDistinctIdentityOwners(owners) {
  const claimed = new Map();
  for (const owner of owners) {
    if (!owner || !/^[a-f0-9]{64}$/.test(owner.accountId || '')
        || typeof owner.identity !== 'string' || !owner.identity || owner.identity.length > 128) {
      throw new Error('账号身份资料格式异常，关联已暂停以保护云端数据');
    }
    const identities = new Set([owner.identity, ...validatedIdentityAliases(owner)]);
    for (const identity of identities) {
      const priorOwner = claimed.get(identity);
      if (priorOwner !== undefined && priorOwner !== owner.accountId) {
        throw new Error('不同账号的历史身份资料存在重叠，关联已暂停以避免跨账号迁移');
      }
      claimed.set(identity, owner.accountId);
    }
  }
}

function sameIdentityOwnerSnapshots(left, right) {
  const signature = owners => JSON.stringify(owners.map(owner => JSON.stringify([
    owner.accountId,
    owner.identity,
    [...new Set(validatedIdentityAliases(owner))].sort(),
  ])).sort());
  return signature(left) === signature(right);
}

async function beginVerifiedMerge(db, { targetAccountId, sourceAccountIds, phone, context }) {
  if (!/^[a-f0-9]{64}$/.test(targetAccountId || '')
      || !Array.isArray(sourceAccountIds) || sourceAccountIds.length > 32
      || sourceAccountIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || id === targetAccountId)
      || new Set(sourceAccountIds).size !== sourceAccountIds.length) {
    throw new Error('待关联账号标识异常，关联已暂停以保护云端数据');
  }
  const sources = sourceAccountIds.slice().sort().map(accountId => ({ accountId }));
  if (!sources.length) throw new Error('账号关联状态不需要迁移');
  const ids = [targetAccountId, ...sources.map(source => source.accountId)].sort();
  const jobId = hash(`verified-account-merge:${ids.join(':')}`);
  const mergeToken = random();
  const now = Date.now(), sessionExpiresAt = now + 7 * 24 * 60 * 60 * 1000;
  const existingJobSnapshot = (await db.collection('client_account_merges').doc(jobId).get()).data;
  let ownershipPreflightOwners = null;
  let identityRegistryVersion = null;
  if (existingJobSnapshot?.status === 'running') {
    ownershipPreflightOwners = [
      { accountId: existingJobSnapshot.targetAccountId, identity: existingJobSnapshot.target?.identity,
        identityAliases: existingJobSnapshot.target?.identityAliases },
      ...(existingJobSnapshot.sources || []),
    ];
    validateDistinctIdentityOwners(ownershipPreflightOwners);
    identityRegistryVersion = await readIdentityRegistryVersion(db);
    await assertNoForeignIdentityOwners(db, db.command, ownershipPreflightOwners);
  } else if (existingJobSnapshot?.status !== 'complete') {
    const targetSnapshot = (await db.collection('client_accounts').doc(targetAccountId).get()).data;
    const sourceSnapshots = await Promise.all(sources.map(source =>
      db.collection('client_accounts').doc(source.accountId).get().then(result => result.data)));
    if (targetSnapshot && sourceSnapshots.every(Boolean)) {
      ownershipPreflightOwners = [
        { accountId: targetAccountId, identity: targetSnapshot.identity,
          identityAliases: targetSnapshot.identityAliases },
        ...sourceSnapshots.map((account, index) => ({ accountId: sources[index].accountId,
          identity: account.identity, identityAliases: account.identityAliases })),
      ];
      validateDistinctIdentityOwners(ownershipPreflightOwners);
      identityRegistryVersion = await readIdentityRegistryVersion(db);
      await assertNoForeignIdentityOwners(db, db.command, ownershipPreflightOwners);
    }
  }
  await db.runTransaction(async tx => {
    if (identityRegistryVersion !== null) await lockIdentityRegistry(tx, identityRegistryVersion);
    const jobs = tx.collection('client_account_merges'), jobRef = jobs.doc(jobId);
    const existingJob = (await jobRef.get()).data;
    if (existingJob?.status === 'running') {
      if (!/^[a-f0-9]{64}$/.test(existingJob.targetAccountId || '')
          || !existingJob.target || typeof existingJob.target.identity !== 'string'
          || !existingJob.target.identity || existingJob.target.identity.length > 128
          || !Array.isArray(existingJob.sources) || !existingJob.sources.length
          || existingJob.sources.length > 128
          || !existingJob.phone || !/^[a-f0-9]{64}$/.test(existingJob.phone.hash || '')
          || typeof existingJob.phone.masked !== 'string'
          || !/^\+[1-9][0-9]{0,2} \*{4}[0-9]{4}$/.test(existingJob.phone.masked)
          || !Number.isSafeInteger(existingJob.phone.verifiedAt) || existingJob.phone.verifiedAt <= 0) {
        throw new Error('历史账号关联任务资料格式异常，请联系管理员核对');
      }
      const existingSourceIds = new Set();
      for (const source of existingJob.sources) {
        if (!source || !/^[a-f0-9]{64}$/.test(source.accountId || '')
            || source.accountId === existingJob.targetAccountId || existingSourceIds.has(source.accountId)) {
          throw new Error('历史账号关联来源账号格式异常，请联系管理员核对');
        }
        existingSourceIds.add(source.accountId);
      }
      validatedIdentityAliases(existingJob.target);
      wechatIdentities({ wechatIdentities: existingJob.target.wechatIdentities });
      validatedWechatUnionIds({ wechatUnionIds: existingJob.target.wechatUnionIds });
      for (const source of existingJob.sources) {
        if (!source || typeof source.identity !== 'string' || !source.identity || source.identity.length > 128) {
          throw new Error('历史账号关联来源身份格式异常，请联系管理员核对');
        }
        validatedIdentityAliases(source);
        wechatIdentities({ wechatIdentities: source.wechatIdentities });
        validatedWechatUnionIds({ wechatUnionIds: source.wechatUnionIds });
      }
      validateDistinctIdentityOwners([
        { accountId: existingJob.targetAccountId, identity: existingJob.target.identity,
          identityAliases: existingJob.target.identityAliases },
        ...existingJob.sources,
      ]);
      const currentOwnershipOwners = [
        { accountId: existingJob.targetAccountId, identity: existingJob.target.identity,
          identityAliases: existingJob.target.identityAliases },
        ...existingJob.sources,
      ];
      if (!ownershipPreflightOwners || !sameIdentityOwnerSnapshots(ownershipPreflightOwners, currentOwnershipOwners)) {
        throw new Error('账号身份资料在核对期间发生变化，请重新授权后再试');
      }
      if (typeof existingJob.wechat?.appId !== 'string' || !existingJob.wechat.appId || existingJob.wechat.appId.length > 64
          || typeof existingJob.wechat?.openId !== 'string' || !existingJob.wechat.openId || existingJob.wechat.openId.length > 128
          || (existingJob.wechat.unionId !== undefined && (!existingJob.wechat.unionId
            || typeof existingJob.wechat.unionId !== 'string' || existingJob.wechat.unionId.length > 128))) {
        throw new Error('历史账号关联微信身份格式异常，请联系管理员核对');
      }
      if (existingJob.targetAccountId !== targetAccountId
          || JSON.stringify([...(existingJob.sources || []).map(item => item.accountId)].sort()) !== JSON.stringify(sources.map(item => item.accountId))
          || existingJob.phone?.hash !== phone.hash
          || existingJob.wechat?.appId !== context.APPID || existingJob.wechat?.openId !== context.OPENID
          || (existingJob.wechat?.unionId || '') !== (context.UNIONID || '')) {
        throw new Error('账号关联任务与当前身份不一致，请重新登录核对');
      }
      await jobRef.update({ data: { secretHash: hash(mergeToken), sessionExpiresAt, updatedAt: now } });
      return;
    }
    if (existingJob?.status === 'complete') throw new Error('账号身份已完成关联，请重新登录');
    const targetRef = tx.collection('client_accounts').doc(targetAccountId);
    const target = (await targetRef.get()).data;
    if (!target || hash(target.username) !== targetAccountId || typeof target.identity !== 'string'
        || !target.identity || target.identity.length > 128 || target.disabled || target.deleting
        || target.merging || target.mergeJobId) {
      throw new Error('目标账号不可用于关联，请先使用有效账号登录');
    }
    if (target.phoneIdentityHash && target.phoneIdentityHash !== phone.hash) {
      throw new Error('此账号已绑定其他手机号；为保护资料，不会替换手机号');
    }
    const targetAliases = validatedIdentityAliases(target);
    const lockedSources = [];
    for (const item of sources) {
      const ref = tx.collection('client_accounts').doc(item.accountId);
      const account = (await ref.get()).data;
      if (!account || hash(account.username) !== item.accountId || typeof account.identity !== 'string'
          || !account.identity || account.identity.length > 128 || account.disabled || account.deleting
          || account.merging || account.mergeJobId) {
        throw new Error('一个待关联身份对应的账号已停用或不存在；请使用原账号核对');
      }
      if (account.operations?.some(operation => operation.until > now)) {
        throw new Error('账号正在保存数据，请稍后重新授权关联');
      }
      lockedSources.push({ accountId: item.accountId, identity: account.identity,
        username: account.username, nickname: account.nickname || '山友', wechatIdentities: wechatIdentities(account),
        wechatUnionIds: accountWechatUnionIds(account),
        identityAliases: validatedIdentityAliases(account) });
    }
    if (target.operations?.some(operation => operation.until > now)) {
      throw new Error('账号正在保存数据，请稍后重新授权关联');
    }
    const currentOwnershipOwners = [
      { accountId: targetAccountId, identity: target.identity, identityAliases: targetAliases },
      ...lockedSources,
    ];
    validateDistinctIdentityOwners(currentOwnershipOwners);
    if (!ownershipPreflightOwners || !sameIdentityOwnerSnapshots(ownershipPreflightOwners, currentOwnershipOwners)) {
      throw new Error('账号身份资料在核对期间发生变化，请重新授权后再试');
    }
    const aliases = new Set([...targetAliases,
      ...lockedSources.flatMap(item => [item.identity, ...item.identityAliases])]
      .filter(value => typeof value === 'string' && value && value !== target.identity && value.length <= 128));
    if (aliases.size > 100) throw new Error('该账号关联身份数量超过安全迁移上限，请联系管理员处理');
    const targetWechat = withWeChatIdentity(target, context);
    await targetRef.update({ data: { merging: true, mergeJobId: jobId,
      sessionVersion: (Number(target.sessionVersion) || 0) + 1 } });
    for (const item of lockedSources) {
      const ref = tx.collection('client_accounts').doc(item.accountId);
      const account = (await ref.get()).data;
      await ref.update({ data: { merging: true, mergeJobId: jobId,
        sessionVersion: (Number(account.sessionVersion) || 0) + 1 } });
    }
    await jobRef.set({ data: { status: 'running', targetAccountId,
      target: { identity: target.identity, identityAliases: targetAliases,
        wechatIdentities: targetWechat.wechatIdentities,
        wechatUnionIds: targetWechat.wechatUnionIds }, sources: lockedSources,
      phone: { hash: phone.hash, masked: phone.masked, verifiedAt: phone.verifiedAt },
      phoneHash: phone.hash,
      wechat: { appId: context.APPID, openId: context.OPENID, ...(context.UNIONID ? { unionId: context.UNIONID } : {}) },
      secretHash: hash(mergeToken), phaseIndex: 0, sourceIndex: 0, migrated: 0,
      sessionExpiresAt, createdAt: now, updatedAt: now } });
  });
  return { mergeRequired: true, mergeToken, expiresAt: sessionExpiresAt };
}

async function bindVerifiedPhone(db, context, event = {}) {
  if (process.env.PHONE_BIND_ENABLED !== 'true') {
    throw new Error('手机号关联尚未启用；当前可使用微信扫码或账号密码登录');
  }
  const code = typeof event.phoneCode === 'string' ? event.phoneCode : '';
  const token = typeof event.sessionToken === 'string' ? event.sessionToken : '';
  const hmacKey = process.env.PHONE_IDENTITY_HMAC_KEY || '';
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[A-Za-z0-9_-]{8,512}$/.test(code)) {
    throw new Error('手机号授权已失效，请重新点击授权');
  }
  // Do not consume the one-time WeChat code until the required server secret
  // and the currently signed-in account have both been verified.
  if (Buffer.byteLength(hmacKey) < 32) throw new Error('手机号关联服务尚未完成安全配置');
  const session = (await db.collection('client_sessions').doc(hash(token)).get()).data;
  if (!session || session.expiresAt <= Date.now()) throw new Error('登录已过期，请重新登录');
  const account = (await db.collection('client_accounts').doc(session.accountId).get()).data;
  if (!account || account.disabled || account.deleting || account.merging || account.sessionVersion !== session.sessionVersion) {
    throw new Error('请在小程序中使用当前账号确认微信和手机号关联');
  }
  const accountId = hash(account.username);
  if (session.accountId !== accountId) throw new Error('当前微信身份与登录账号不一致');

  const rateId = hash(`phone-bind:${accountId}`);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const ref = tx.collection('client_rate_limits').doc(rateId);
    const prior = (await ref.get()).data;
    const bucket = prior?.resetAt > now ? prior : { count: 0, resetAt: now + 10 * 60 * 1000 };
    if (bucket.count >= 5) throw new Error('手机号授权操作过于频繁，请稍后再试');
    await ref.set({ data: { count: bucket.count + 1, resetAt: bucket.resetAt, expiresAt: bucket.resetAt } });
  });

  let response;
  try {
    response = await cloud.openapi.phonenumber.getPhoneNumber({ code });
  } catch {
    throw new Error('微信手机号授权服务暂不可用，请确认小程序主体资格和接口权限');
  }
  const phoneIdentity = verifiedPhoneIdentity(response, hmacKey);
  const phoneKey = phoneIdentity.hash, masked = phoneIdentity.masked;
  const identityRegistryVersion = await readIdentityRegistryVersion(db);
  await db.runTransaction(async tx => {
    await lockIdentityRegistry(tx, identityRegistryVersion);
    const sessionNow = (await tx.collection('client_sessions').doc(hash(token)).get()).data;
    const accountRef = tx.collection('client_accounts').doc(accountId);
    const accountNow = (await accountRef.get()).data;
    if (!sessionNow || sessionNow.expiresAt <= Date.now() || sessionNow.accountId !== accountId
        || !accountNow || accountNow.disabled || accountNow.deleting || accountNow.merging
        || accountNow.sessionVersion !== sessionNow.sessionVersion) {
      throw new Error('账号状态已变化，请重新登录后再试');
    }
    if (accountNow.phoneIdentityHash && accountNow.phoneIdentityHash !== phoneKey) {
      throw new Error('此账号已关联其他手机号；为避免账号数据错配，不能自动替换');
    }
    const linkRef = tx.collection('client_phone_identity_links').doc(phoneKey);
    const link = (await linkRef.get()).data;
    const wechatUsername = 'wx_' + hash(`${context.APPID}:${context.OPENID}`).slice(0, 24);
    const wechatAccountId = hash(wechatUsername);
    const openidKey = hash(`wechat-openid:${context.APPID}:${context.OPENID}`);
    const openRef = tx.collection('client_wechat_identity_links').doc(openidKey);
    const openLink = (await openRef.get()).data;
    const unionidKey = context.UNIONID ? hash(`wechat-unionid:${context.UNIONID}`) : '';
    const unionRef = unionidKey ? tx.collection('client_wechat_identity_links').doc(unionidKey) : null;
    const unionLink = unionRef ? (await unionRef.get()).data : null;
    const legacyWechat = wechatAccountId === accountId ? null : (await tx.collection('client_accounts').doc(wechatAccountId).get()).data;
    const legacyUnion = context.UNIONID
      ? (await tx.collection('client_accounts').where({ authProvider: 'wechat', wechatUnionId: context.UNIONID }).limit(21).get()).data || []
      : [];
    if (legacyUnion.length > 20) throw new Error('微信统一身份关联账号超过安全处理范围，请联系管理员核对');
    const activeLegacyUnion = legacyUnion.filter(row => !row.mergedIntoAccountId);
    const conflictingIds = [...new Set([link?.accountId, openLink?.accountId, unionLink?.accountId,
      legacyWechat && !legacyWechat.mergedIntoAccountId ? wechatAccountId : '',
      ...activeLegacyUnion.map(row => hash(row.username))]
      .filter(id => id && id !== accountId))];
    if (conflictingIds.length) return;
    // A user who signs in to their existing account on the mini program can
    // attach the current WeChat identity and verified phone to that same
    // account. Web/desktop QR login will then resolve to this account.
    if (!openLink) await openRef.set({ data: { accountId, kind: 'openid', appId: context.APPID, createdAt: now } });
    if (unionRef && !unionLink) await unionRef.set({ data: { accountId, kind: 'unionid', createdAt: now } });
    await linkRef.set({ data: { accountId, verifiedAt: phoneIdentity.verifiedAt, masked } });
    await accountRef.update({ data: { phoneIdentityHash: phoneKey, phoneMasked: masked, phoneVerifiedAt: phoneIdentity.verifiedAt,
      wechatAppId: context.APPID, wechatOpenId: context.OPENID, ...(context.UNIONID ? { wechatUnionId: context.UNIONID } : {}),
      ...withWeChatIdentity(accountNow, context) } });
  });
  const latestPhoneLink = (await db.collection('client_phone_identity_links').doc(phoneKey).get()).data;
  const username = 'wx_' + hash(`${context.APPID}:${context.OPENID}`).slice(0, 24);
  const wechatAccountId = hash(username);
  const openidKey = hash(`wechat-openid:${context.APPID}:${context.OPENID}`);
  const openLink = (await db.collection('client_wechat_identity_links').doc(openidKey).get()).data;
  const unionidKey = context.UNIONID ? hash(`wechat-unionid:${context.UNIONID}`) : '';
  const unionLink = unionidKey ? (await db.collection('client_wechat_identity_links').doc(unionidKey).get()).data : null;
  const legacyWechat = wechatAccountId === accountId ? null : (await db.collection('client_accounts').doc(wechatAccountId).get()).data;
  const legacyUnion = context.UNIONID
      ? (await db.collection('client_accounts').where({ authProvider: 'wechat', wechatUnionId: context.UNIONID }).limit(21).get()).data || []
      : [];
  if (legacyUnion.length > 20) throw new Error('微信统一身份关联账号超过安全处理范围，请联系管理员核对');
  const activeLegacyUnion = legacyUnion.filter(row => !row.mergedIntoAccountId);
  const sourceIds = [...new Set([latestPhoneLink?.accountId, openLink?.accountId, unionLink?.accountId,
    legacyWechat && !legacyWechat.mergedIntoAccountId ? wechatAccountId : '',
      ...activeLegacyUnion.map(row => hash(row.username))]
    .filter(id => id && id !== accountId))];
  if (sourceIds.length) return beginVerifiedMerge(db, { targetAccountId: accountId, sourceAccountIds: sourceIds,
    phone: phoneIdentity, context });
  return { phoneMasked: masked, phoneVerifiedAt: phoneIdentity.verifiedAt };
}

async function resolveWeChatAccount(db, APPID, OPENID, UNIONID, reauth, phoneIdentity) {
  const username = 'wx_' + hash(`${APPID}:${OPENID}`).slice(0, 24);
  const directAccountId = hash(username);
  const openidKey = hash(`wechat-openid:${APPID}:${OPENID}`);
  const unionidKey = UNIONID ? hash(`wechat-unionid:${UNIONID}`) : '';
  const [phoneLink, openLink, unionLink, directAccount] = await Promise.all([
    phoneIdentity ? db.collection('client_phone_identity_links').doc(phoneIdentity.hash).get().then(value => value.data) : null,
    db.collection('client_wechat_identity_links').doc(openidKey).get().then(value => value.data),
    unionidKey ? db.collection('client_wechat_identity_links').doc(unionidKey).get().then(value => value.data) : null,
    db.collection('client_accounts').doc(directAccountId).get().then(value => value.data),
  ]);

  if (phoneIdentity) {
    const running = (await db.collection('client_account_merges').where({ phoneHash: phoneIdentity.hash, status: 'running' }).limit(2).get()).data || [];
    if (running.length > 1) throw new Error('手机号存在多个未完成的账号关联任务，请联系管理员核对');
    if (running.length === 1) {
      const job = running[0];
      return beginVerifiedMerge(db, { targetAccountId: job.targetAccountId,
        sourceAccountIds: (job.sources || []).map(item => item.accountId), phone: phoneIdentity,
        context: { APPID, OPENID, UNIONID } });
    }
  }

  // Recover pre-link deployments without picking arbitrarily among duplicate
  // UnionID records. Collision handling happens before opening a transaction:
  // beginning the resumable merge itself performs its own atomic account lock.
  const legacyUnion = unionidKey && !unionLink
    ? (await db.collection('client_accounts').where({ authProvider: 'wechat', wechatUnionId: UNIONID }).limit(21).get()).data || []
    : [];
  if (legacyUnion.length > 20) throw new Error('微信统一身份关联账号超过安全处理范围，请联系管理员核对');
  const activeLegacyUnion = legacyUnion.filter(row => !row.mergedIntoAccountId);
  if (activeLegacyUnion.length > 1) throw new Error('微信统一身份存在重复账号记录，请联系管理员');
  const legacyUnionId = activeLegacyUnion.length === 1 ? hash(activeLegacyUnion[0].username) : '';
  const linkedIds = [...new Set([openLink?.accountId, unionLink?.accountId, legacyUnionId,
    directAccount && !directAccount.mergedIntoAccountId ? directAccountId : '', phoneLink?.accountId].filter(Boolean))];
  if (linkedIds.length > 1) {
    if (!phoneIdentity) throw new Error('微信身份与手机号已属于不同账号；请使用微信授权手机号登录后安全关联');
    const targetAccountId = phoneLink?.accountId || openLink?.accountId || unionLink?.accountId || legacyUnionId || directAccountId;
    return beginVerifiedMerge(db, { targetAccountId, sourceAccountIds: linkedIds.filter(id => id !== targetAccountId),
      phone: phoneIdentity, context: { APPID, OPENID, UNIONID } });
  }
  if (openLink && unionLink && openLink.accountId !== unionLink.accountId) {
    throw new Error('微信统一身份映射冲突，请联系管理员');
  }
  const accountId = linkedIds[0] || directAccountId;
  if (directAccount && !directAccount.mergedIntoAccountId && accountId !== directAccountId) {
    throw new Error('当前微信身份已存在另一个账号，需先安全核对，不能自动合并数据');
  }

  const identityRegistryVersion = await readIdentityRegistryVersion(db);
  return db.runTransaction(async tx => {
    await lockIdentityRegistry(tx, identityRegistryVersion);
    const links = tx.collection('client_wechat_identity_links');
    const openRef = links.doc(openidKey);
    const latestOpen = (await openRef.get()).data;
    const unionRef = unionidKey ? links.doc(unionidKey) : null;
    const latestUnion = unionRef ? (await unionRef.get()).data : null;
    if ((latestOpen && latestOpen.accountId !== accountId) || (latestUnion && latestUnion.accountId !== accountId)) {
      throw new Error('微信身份映射在登录期间发生变化，请重新授权');
    }

    const accountRef = tx.collection('client_accounts').doc(accountId);
    let account = (await accountRef.get()).data;
    if (account) {
      if (account.disabled || account.merging || (account.deleting && !reauth)) throw new Error('账号已停用或正在完成身份关联');
      const identityLinkedToAccount = latestOpen?.accountId === accountId || latestUnion?.accountId === accountId
        || legacyUnionId === accountId || (directAccount && hash(directAccount.username) === accountId);
      if (!hasWeChatIdentity(account, { APPID, OPENID, UNIONID }) && !phoneIdentity && !identityLinkedToAccount) {
        throw new Error('微信身份尚未安全关联，请使用已绑定手机号完成验证');
      }
      if (UNIONID && !account.wechatUnionId) {
        await accountRef.update({ data: { wechatUnionId: UNIONID } });
        account = { ...account, wechatUnionId: UNIONID };
      }
    } else {
      if (accountId !== directAccountId) throw new Error('微信身份映射指向的账号不存在，请联系管理员');
      account = { username, identity: OPENID, nickname: '山友',
        salt: random(), passwordHash: random(), recoveryHash: random(),
        sessionVersion: 0, createdAt: Date.now(), disabled: false,
        authProvider: 'wechat', wechatAppId: APPID, wechatOpenId: OPENID,
        ...(UNIONID ? { wechatUnionId: UNIONID } : {}),
      };
      await accountRef.set({ data: account });
    }

    if (phoneIdentity) {
      const currentPhoneRef = tx.collection('client_phone_identity_links').doc(phoneIdentity.hash);
      const currentPhoneLink = (await currentPhoneRef.get()).data;
      if ((currentPhoneLink && currentPhoneLink.accountId !== accountId)
          || (account.phoneIdentityHash && account.phoneIdentityHash !== phoneIdentity.hash)) {
        throw new Error('手机号关联状态发生变化，请重新授权以安全关联身份');
      }
      if (!currentPhoneLink) await currentPhoneRef.set({ data: {
        accountId, verifiedAt: phoneIdentity.verifiedAt, masked: phoneIdentity.masked,
      } });
      await accountRef.update({ data: {
        phoneIdentityHash: phoneIdentity.hash,
        phoneMasked: phoneIdentity.masked,
        phoneVerifiedAt: phoneIdentity.verifiedAt,
        wechatAppId: APPID,
        wechatOpenId: OPENID,
        ...(UNIONID ? { wechatUnionId: UNIONID } : {}),
      } });
      account = { ...account, phoneIdentityHash: phoneIdentity.hash, phoneMasked: phoneIdentity.masked,
        phoneVerifiedAt: phoneIdentity.verifiedAt, wechatAppId: APPID, wechatOpenId: OPENID,
        ...(UNIONID ? { wechatUnionId: UNIONID } : {}) };
    } else if (!hasWeChatIdentity(account, { APPID, OPENID, UNIONID }) && !latestOpen && !latestUnion) {
      throw new Error('微信身份尚未安全关联');
    }

    const identityFields = withWeChatIdentity(account, { APPID, OPENID, UNIONID });
    await accountRef.update({ data: { ...identityFields, wechatAppId: APPID, wechatOpenId: OPENID,
      ...(UNIONID ? { wechatUnionId: UNIONID } : {}) } });
    account = { ...account, ...identityFields, wechatAppId: APPID, wechatOpenId: OPENID,
      ...(UNIONID ? { wechatUnionId: UNIONID } : {}) };

    if (!latestOpen) await openRef.set({ data: { accountId, kind: 'openid', appId: APPID, createdAt: Date.now() } });
    if (unionRef) {
      if (!latestUnion) await unionRef.set({ data: { accountId, kind: 'unionid', createdAt: Date.now() } });
    }
    return account;
  });
}

exports.main = async (event = {}) => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext();
  if (!OPENID || !APPID) return { errMsg: '请先在微信小程序登录' };
  const db = cloud.database({ throwOnNotFound: false });
  if (event.action === 'capabilities') {
    const hmacKey = process.env.PHONE_IDENTITY_HMAC_KEY || '';
    return { phoneBindingEnabled: process.env.PHONE_BIND_ENABLED === 'true' && Buffer.byteLength(hmacKey) >= 32 };
  }
  if (event.action === 'bindPhone') return bindVerifiedPhone(db, { OPENID, APPID, UNIONID }, event);
  let phoneIdentity;
  if (event.action === 'loginWithPhone') {
    if (process.env.PHONE_BIND_ENABLED !== 'true') {
      throw new Error('手机号关联尚未启用，请先使用微信登录或账号密码登录');
    }
    const hmacKey = process.env.PHONE_IDENTITY_HMAC_KEY || '';
    const code = typeof event.phoneCode === 'string' ? event.phoneCode : '';
    if (Buffer.byteLength(hmacKey) < 32 || !/^[A-Za-z0-9_-]{8,512}$/.test(code)) {
      throw new Error('手机号关联服务未配置或授权已失效，请重试');
    }
    const rateId = hash(`phone-login:${APPID}:${OPENID}`);
    const now = Date.now();
    await db.runTransaction(async tx => {
      const ref = tx.collection('client_rate_limits').doc(rateId);
      const prior = (await ref.get()).data;
      const bucket = prior?.resetAt > now ? prior : { count: 0, resetAt: now + 10 * 60 * 1000 };
      if (bucket.count >= 5) throw new Error('手机号关联登录过于频繁，请稍后再试');
      await ref.set({ data: { count: bucket.count + 1, resetAt: bucket.resetAt, expiresAt: bucket.resetAt } });
    });
    let response;
    try { response = await cloud.openapi.phonenumber.getPhoneNumber({ code }); }
    catch { throw new Error('微信手机号授权服务暂不可用，请确认小程序主体资格和接口权限'); }
    phoneIdentity = verifiedPhoneIdentity(response, hmacKey);
  }
  const account = await resolveWeChatAccount(db, APPID, OPENID, UNIONID, event.action === 'reauth', phoneIdentity);
  if (account?.mergeRequired) return account;
  const accountId = hash(account.username);
  const ticket = random(), expiresAt = Date.now() + 60000;
  await db.collection('client_wechat_tickets').doc(hash(ticket)).set({ data: {
    accountId, expiresAt, used: false,
  } });
  return { openid: account.identity, nickname: account.nickname, ticket, expiresAt };
};
