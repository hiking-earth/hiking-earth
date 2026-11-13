// HTTP gateway. Identity is resolved from an opaque session, never request data.
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { promisify } = require('util');
const { withIdentity } = require('./identity');
const { readIdentityRegistryVersion, lockIdentityRegistry } = require('./identity-ownership');
// CPU photo inference can exceed the SDK's default HTTP timeout on cold start.
// Keep a finite bound consistent with the client's photo request timeout.
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 });
const db = cloud.database({ throwOnNotFound: false });
const derive = promisify(crypto.scrypt);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 6 * 1024 * 1024;
const MINI_PROGRAM_APPID = 'wx73248e013d48b534';
const CLOUD_CONSENT_VERSIONS = Object.freeze({
  gearImageUpload: 'gear-image-upload-v1',
  trackCloudSync: 'track-cloud-sync-v1',
  teamLocation: 'team-location-v1',
});
const handlers = new Set(['catalog-feed', 'route-manage', 'social-manage', 'companion-create', 'companion-list', 'companion-join',
  'companion-report', 'companion-manage', 'team-manage', 'library-manage', 'community-moderate', 'team-create', 'team-join', 'team-leave', 'team-stop',
  'team-report', 'team-locations', 'team-current', 'track-sync', 'track-manage', 'sos-trigger', 'guide-list', 'offline-map-request']);
const publicHandlers = new Set(['catalog-feed', 'companion-list', 'guide-list']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
function fail(message, status = 400, code) { const e = new Error(message); e.status = status; e.code = code; throw e; }
function nameOf(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{3,31}$/.test(name)) fail('账号需为4–32位字母、数字、点、下划线或短横线');
  return name;
}
function passwordOf(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail('密码需为10–128个字符');
  return value;
}
const accountDoc = name => db.collection('client_accounts').doc(hash(name));
function profileAliases(account) {
  if (account.identityAliases === undefined) return undefined;
  if (!Array.isArray(account.identityAliases) || account.identityAliases.length > 100
      || account.identityAliases.some(identity => typeof identity !== 'string' || !identity || identity.length > 128)) {
    fail('账号历史身份资料格式异常，登录已暂停以免遗漏本机数据', 409, 'MERGE_ALIAS_INVALID');
  }
  return [...new Set(account.identityAliases)].filter(identity => identity !== account.identity);
}
function profile(account) { const mergedIdentities = profileAliases(account); return { openid: account.identity, nickname: account.nickname, username: account.username,
  ...(typeof account.phoneMasked === 'string' ? { phoneMasked: account.phoneMasked } : {}),
  ...(mergedIdentities !== undefined ? { mergedIdentities } : {}) }; }
function equalHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
const limit = require('./rate-limit').createLimiter({ db, hash, fail });
const catalogLimit = require('./catalog-rate-limit').createLimiter({ db, hash, fail });
async function newSession(account, options = {}) {
  const token = options.token || random(); const expiresAt = options.expiresAt || Date.now() + SESSION_MS;
  let sessionProfile;
  if (!/^[a-f0-9]{64}$/.test(token) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    fail('登录会话无效，请重新登录', 400);
  }
  await db.runTransaction(async tx => {
    const accountId = hash(account.username);
    const latest = (await tx.collection('client_accounts').doc(accountId).get()).data;
    if (!latest || latest.disabled || latest.deleting || latest.merging || latest.sessionVersion !== account.sessionVersion) fail('账号已改变，请重新登录', 401);
    sessionProfile = profile(latest);
    const sessionRef = tx.collection('client_sessions').doc(hash(token));
    const existing = (await sessionRef.get()).data;
    if (existing) {
      if (existing.accountId !== accountId || existing.sessionVersion !== latest.sessionVersion || existing.expiresAt !== expiresAt || existing.expiresAt <= Date.now()) {
        fail('登录会话已失效，请重新扫码', 401);
      }
      return;
    }
    if (options.allowExistingOnly === true) fail('登录会话已失效，请重新扫码', 401);
    await sessionRef.set({ data: {
      accountId, sessionVersion: latest.sessionVersion, expiresAt, createdAt: Date.now(),
    } });
  });
  return { ...sessionProfile, token, expiresAt };
}
async function verifiedSession(token, allowDeletion = false) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) fail('请先登录', 401, 'SESSION_EXPIRED');
  const session = (await db.collection('client_sessions').doc(hash(token)).get()).data;
  if (!session || session.expiresAt <= Date.now()) fail('登录已过期，请重新登录', 401, 'SESSION_EXPIRED');
  const account = (await db.collection('client_accounts').doc(session.accountId).get()).data;
  if (!account || account.disabled || account.merging || account.sessionVersion !== session.sessionVersion) fail('登录已失效，请重新登录', 401, 'SESSION_EXPIRED');
  if (account.deleting && !allowDeletion) fail('账号注销尚未完成，请前往账号管理继续注销', 403, 'ACCOUNT_DELETING');
  return account;
}
async function credentials(data) {
  const submitted = String(data.username || '').trim();
  const phone = submitted.replace(/[\s().-]/g, '');
  const isPhone = /^\+[1-9][0-9]{7,14}$/.test(phone)
    || (!phone.startsWith('+') && /^1[0-9]{10}$/.test(phone));
  const identifier = isPhone ? `phone:${hash(phone)}` : `account:${nameOf(submitted)}`;
  await limit(`login:${hash(identifier)}`, 15);
  let account;
  if (isPhone) {
    const key = process.env.PHONE_IDENTITY_HMAC_KEY || '';
    if (process.env.PHONE_BIND_ENABLED === 'true' && Buffer.byteLength(key) >= 32) {
      const e164 = phone.startsWith('+') ? phone : `+86${phone}`;
      const phoneHash = crypto.createHmac('sha256', key).update(e164).digest('hex');
      const link = (await db.collection('client_phone_identity_links').doc(phoneHash).get()).data;
      if (typeof link?.accountId === 'string' && /^[a-f0-9]{64}$/.test(link.accountId)) {
        account = (await db.collection('client_accounts').doc(link.accountId).get()).data;
        if (account && hash(account.username) !== link.accountId) account = null;
      }
    }
  } else {
    const username = nameOf(submitted);
    account = (await accountDoc(username).get()).data;
  }
  // Spend the same expensive hash computation for unknown names.
  const candidate = (await derive(String(data.password || '').slice(0, 128), account?.salt || 'unknown-account', 32)).toString('hex');
  if (account?.mergedIntoAccountId && account.disabled && equalHex(candidate, account.passwordHash)) {
    const canonical = (await db.collection('client_accounts').doc(account.mergedIntoAccountId).get()).data;
    if (canonical && !canonical.disabled && !canonical.deleting && !canonical.merging) return canonical;
  }
  if (!account || account.disabled || account.merging || !equalHex(candidate, account.passwordHash)) fail('账号或密码不正确', 401);
  return account;
}
async function register(data, remoteAddress) {
  const username = nameOf(data.username), password = passwordOf(data.password);
  if (username.startsWith('wx_')) fail('该账号前缀保留给微信登录');
  await limit(`register:name:${username}`, 3);
  // HTTP instances may share a proxy address; keep this a global burst guard.
  await limit(`register:${hash(remoteAddress)}`, 50);
  const salt = random(), recoveryCode = random();
  const passwordHash = (await derive(password, salt, 32)).toString('hex');
  const account = { username, identity: `account:${crypto.randomBytes(16).toString('hex')}`,
    nickname: String(data.nickname || '山友').trim().slice(0, 24) || '山友', salt, passwordHash,
    recoveryHash: hash(recoveryCode), sessionVersion: 0, createdAt: Date.now(), disabled: false };
  const identityRegistryVersion = await readIdentityRegistryVersion(db);
  await db.runTransaction(async tx => {
    await lockIdentityRegistry(tx, identityRegistryVersion);
    const ref = tx.collection('client_accounts').doc(hash(username));
    if ((await ref.get()).data) fail('该账号已存在');
    await ref.set({ data: account });
  });
  return { ...(await newSession(account)), recoveryCode };
}
async function recover(data) {
  const username = nameOf(data.username), password = passwordOf(data.password);
  await limit(`recover:${username}`, 10);
  const code = String(data.recoveryCode || '').trim();
  if (!/^[a-f0-9]{64}$/.test(code)) fail('账号或恢复码不正确', 401);
  const salt = random(), recoveryCode = random();
  const passwordHash = (await derive(password, salt, 32)).toString('hex');
  const account = await db.runTransaction(async tx => {
    const ref = tx.collection('client_accounts').doc(hash(username));
    const account = (await ref.get()).data;
    if (!account || account.disabled || account.deleting || !equalHex(hash(code), account.recoveryHash)) fail('账号或恢复码不正确', 401);
    const updates = { salt, passwordHash, recoveryHash: hash(recoveryCode), sessionVersion: account.sessionVersion + 1 };
    await ref.update({ data: updates });
    return { ...account, ...updates };
  });
  return { ...(await newSession(account)), recoveryCode };
}
async function changePassword(account, data) {
  const password = passwordOf(data.newPassword);
  if (account.authProvider === 'wechat') {
    const phoneKey = account.phoneIdentityHash || '';
    const phoneLink = /^[a-f0-9]{64}$/.test(phoneKey)
      ? (await db.collection('client_phone_identity_links').doc(phoneKey).get()).data : null;
    if (process.env.PHONE_BIND_ENABLED !== 'true' || !phoneLink || phoneLink.accountId !== hash(account.username)) {
      fail('微信账号请先在小程序安全关联手机号，再设置密码', 403);
    }
  } else {
    await credentials({ username: account.username, password: data.password });
  }
  const salt = random(), passwordHash = (await derive(password, salt, 32)).toString('hex');
  const updated = await db.runTransaction(async tx => {
    const ref = tx.collection('client_accounts').doc(hash(account.username));
    const latest = (await ref.get()).data;
    // A concurrent recovery invalidates the credentials check above.
    if (!latest || latest.disabled || latest.deleting || latest.merging || latest.sessionVersion !== account.sessionVersion
        || latest.passwordHash !== account.passwordHash) fail('账号状态已改变，请重新登录', 401);
    if (latest.authProvider === 'wechat' && latest.phoneIdentityHash !== account.phoneIdentityHash) {
      fail('手机号关联状态已改变，请重新登录后再试', 401);
    }
    const updates = { salt, passwordHash, sessionVersion: latest.sessionVersion + 1 };
    await ref.update({ data: updates }); return { ...latest, ...updates };
  });
  return newSession(updated);
}
async function stopSharing(identity) {
  await db.collection('team_members').where({ openid: identity }).update({ data: { latitude: null, longitude: null, updatedAt: 0 } });
}
async function businessOperation(account, token, operation, requiredConsent) {
  const operationId = random(), tokenHash = hash(token);
  await db.runTransaction(async tx => {
    const ref = tx.collection('client_accounts').doc(hash(account.username));
    const latest = (await ref.get()).data;
    const session = (await tx.collection('client_sessions').doc(tokenHash).get()).data;
    if (latest?.deleting) fail('账号注销尚未完成，请前往账号管理继续注销', 403, 'ACCOUNT_DELETING');
    if (latest?.merging || latest?.mergeJobId) fail('账号资料正在安全迁移，请稍后重试', 409, 'ACCOUNT_MERGING');
    if (!latest || latest.disabled || !session || session.expiresAt <= Date.now() || session.sessionVersion !== latest.sessionVersion) fail('账号状态已改变，请重新登录', 401, 'SESSION_EXPIRED');
    if (requiredConsent) {
      const consent = latest.cloudConsents?.[requiredConsent];
      if (consent?.enabled !== true || consent?.policyVersion !== CLOUD_CONSENT_VERSIONS[requiredConsent]) {
        const messages = { gearImageUpload: '装备照片云端分析授权已关闭', trackCloudSync: '云端轨迹备份授权已关闭', teamLocation: '组队位置共享授权已关闭' };
        fail(messages[requiredConsent] || '相关隐私授权已关闭', 403, 'PRIVACY_CONSENT_REQUIRED');
      }
    }
    const operations = (latest.operations || []).filter(item => item.until > Date.now());
    if (operations.length >= 20) fail('正在处理较多请求，请稍后重试', 429);
    operations.push({ id: operationId, until: Date.now() + 10 * 60 * 1000 });
    await ref.update({ data: { operations } });
  });
  try { return await operation(); }
  finally {
    await db.runTransaction(async tx => {
      const ref = tx.collection('client_accounts').doc(hash(account.username));
      const latest = (await ref.get()).data;
      if (latest && !latest.disabled) await ref.update({ data: { operations: (latest.operations || []).filter(item => item.id !== operationId && item.until > Date.now()) } });
    });
    // A request already in flight at logout must not leave a last location behind.
    const session = (await db.collection('client_sessions').doc(tokenHash).get()).data;
    const latest = (await accountDoc(account.username).get()).data;
    if (!session || !latest || latest.deleting || latest.disabled || session.sessionVersion !== latest.sessionVersion) await stopSharing(account.identity);
  }
}
function linkedMiniProgramOpenId(account) {
  const identities = Array.isArray(account.wechatIdentities) ? [...account.wechatIdentities] : [];
  if (account.wechatAppId === MINI_PROGRAM_APPID && typeof account.wechatOpenId === 'string') {
    identities.push({ appId: account.wechatAppId, openId: account.wechatOpenId });
  }
  const linked = identities.find(identity => identity?.appId === MINI_PROGRAM_APPID
    && typeof identity.openId === 'string' && identity.openId.length > 0 && identity.openId.length <= 128);
  return linked?.openId || '';
}
const qrLogin = require('./qr-login').service({ db, sessionTTL: SESSION_MS,
  accountById: async id => (await db.collection('client_accounts').doc(id).get()).data,
  issueSession: newSession,
  revokeSession: async token => db.collection('client_sessions').doc(hash(token)).remove(),
});
async function miniProgramLoginCode(scene) {
  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene, page: 'pages/account/qr-confirm', width: 430,
    });
    const raw = result?.buffer ?? result?.data ?? result;
    const image = Buffer.isBuffer(raw) ? raw
      : raw instanceof ArrayBuffer ? Buffer.from(raw)
        : raw instanceof Uint8Array ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : null;
    if (!image || image.length < 8 || image.length > 1024 * 1024
        || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
    return image.toString('base64');
  } catch {
    // Keep the expiring in-app scanner QR available if the official code cannot
    // be issued yet, such as before the Mini Program page is published.
    return null;
  }
}
const accountMerge = require('./account-merge').service({ db, newSession });
async function dispatch(action, data, token, remoteAddress) {
  if (action === 'auth.capabilities') {
    const hmacKey = process.env.PHONE_IDENTITY_HMAC_KEY || '';
    return { phoneBindingEnabled: process.env.PHONE_BIND_ENABLED === 'true' && Buffer.byteLength(hmacKey) >= 32 };
  }
  if (action === 'offline-map.worker.next' || action === 'offline-map.worker.complete') {
    const expected = process.env.OFFLINE_MAP_WORKER_TOKEN || '';
    const supplied = data.workerToken;
    if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied || '') || !equalHex(expected, supplied)) fail('离线地图构建服务未授权', 403);
    await limit(`offline-map-worker:${hash(remoteAddress)}`, 20);
    return require('./business/offline-map-request').worker(action, data);
  }
  if (action === 'route-audit.worker.begin' || action === 'route-audit.worker.chunk'
      || action === 'route-audit.worker.commit') {
    const expected = process.env.ROUTE_AUDIT_WORKER_TOKEN || '';
    const supplied = data.workerToken;
    if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied || '') || !equalHex(expected, supplied)) fail('路线审核发布服务未授权', 403);
    await limit(`route-audit-worker:${hash(remoteAddress)}`, 500);
    const audit = require('./business/route-access-audit');
    return audit.worker(action, data);
  }
  if (action === 'weather.forecast') return require('./weather').forecast(data, () => limit('weather:global', 1000));
  if (action === 'auth.qr.start') {
    await limit(`qr-start:${hash(remoteAddress)}`, 30);
    const challenge = await qrLogin.start(data);
    const miniProgramCode = await miniProgramLoginCode(challenge.challenge);
    return { ...challenge, ...(miniProgramCode ? { miniProgramCode } : {}) };
  }
  if (action === 'auth.qr.claim' || action === 'auth.qr.cancel') {
    await limit(`qr-poll:${hash(remoteAddress)}`, 500);
    return action === 'auth.qr.claim' ? qrLogin.claim(data) : qrLogin.cancel(data);
  }
  if (action === 'auth.merge.continue') {
    await limit(`account-merge:${hash(remoteAddress)}`, 900);
    return accountMerge.continueMerge(data.mergeToken);
  }
  if (action === 'auth.wechat.exchange') { await limit(`wechat-exchange:${hash(remoteAddress)}`, 100);
    return require('./wechat-exchange').exchange(db, data.ticket, newSession);
  }
  if (action === 'auth.register') return register(data, remoteAddress);
  if (action === 'auth.sign-in') return newSession(await credentials(data));
  if (action === 'auth.recover') return recover(data);
  if (publicHandlers.has(action)||(action==='route-manage'&&data.action==='list')) {
    let stage = 'public-rate-limit';
    try {
      if(action==='catalog-feed')await catalogLimit(`catalog:${hash(remoteAddress)}`,500);
      stage = 'public-session';
      const identity = token ? (await verifiedSession(token)).identity : '';
      stage = 'public-business';
      return await withIdentity(identity, () => require(`./business/${action}`).main(data));
    } catch (error) {
      if (!error?.status) {
        // No payload, header, identity, exception message or stack is logged.
        const code = String(error?.code || error?.errCode || 'UNKNOWN');
        console.warn(JSON.stringify({ event:'public-handler-failed', stage,
          handler: handlers.has(action) ? action : 'unknown',
          sdkCode: /^[A-Z0-9_.-]{1,64}$/i.test(code) ? code : 'UNCLASSIFIED' }));
      }
      throw require('./public-failure').classify(error, stage);
    }
  }
  const account = await verifiedSession(token, action === 'auth.delete');
  if (action === 'privacy.consent') {
    const policyVersion = Object.prototype.hasOwnProperty.call(CLOUD_CONSENT_VERSIONS, data.key)
      ? CLOUD_CONSENT_VERSIONS[data.key] : null;
    if (!policyVersion) fail('不支持此隐私授权项目', 400, 'CONSENT_KEY_UNSUPPORTED');
    if (data.enabled !== undefined && typeof data.enabled !== 'boolean') fail('授权状态无效');
    if (data.enabled === true && data.policyVersion !== policyVersion) {
      fail('隐私说明版本已更新，请重新阅读并确认', 409, 'CONSENT_VERSION_STALE');
    }
    const saved = account.cloudConsents?.[data.key];
    if (data.enabled === undefined) {
      return { key: data.key, enabled: saved?.enabled === true,
        policyVersion: saved?.policyVersion || null, updatedAt: saved?.updatedAt || null };
    }
    return businessOperation(account, token, () => db.runTransaction(async tx => {
      const ref = tx.collection('client_accounts').doc(hash(account.username));
      const latest = (await ref.get()).data;
      const session = (await tx.collection('client_sessions').doc(hash(token)).get()).data;
      if (!latest || latest.disabled || latest.deleting || latest.merging
          || latest.sessionVersion !== account.sessionVersion
          || !session || session.expiresAt <= Date.now() || session.sessionVersion !== latest.sessionVersion) {
        fail('账号状态已改变，请重新登录', 401, 'SESSION_EXPIRED');
      }
      const cloudConsents = latest.cloudConsents && typeof latest.cloudConsents === 'object'
        ? latest.cloudConsents : {};
      const updatedAt = Date.now();
      const consent = data.enabled === true
        ? { enabled: true, policyVersion, updatedAt }
        : { enabled: false, policyVersion, updatedAt };
      await ref.update({ data: { cloudConsents: { ...cloudConsents, [data.key]: consent } } });
      return { key: data.key, ...consent };
    }));
  }
  if (action === 'library.merge-archives.list') {
    await limit(`library-merge-archives:${account.identity}`, 60);
    return accountMerge.listLibraryArchives(account);
  }
  if (action === 'library.merge-archives.restore') {
    await limit(`library-merge-archive-restore:${account.identity}`, 20);
    return businessOperation(account, token, () => accountMerge.restoreLibraryArchive(account, data.archiveId));
  }
  if (action === 'offline-map-request') await limit(`offline-map-request:${account.identity}`, 4);
  if (action === 'auth.qr.inspect' || action === 'auth.qr.confirm') {
    await limit(`qr-confirm:${account.identity}`, 60);
    return action === 'auth.qr.inspect' ? qrLogin.inspect(data) : qrLogin.confirm(data, account);
  }
  if (action === 'auth.delete') {
    if (account.authProvider === 'wechat') {
      if (!account.deleting) {
        const reauthenticated = await require('./wechat-exchange').consume(db, data.wechatTicket, true);
        if (reauthenticated.username !== account.username) fail('请使用当前微信账号确认注销', 403);
      }
    } else {
      const candidate = (await derive(String(data.password || '').slice(0, 128), account.salt, 32)).toString('hex');
      if (!equalHex(candidate, account.passwordHash)) fail('当前密码不正确', 400);
    }
    return require('./delete-account').deleteAccount(db, account, hash(token));
  }
  if (action === 'login' || action === 'auth.profile') return profile(account);
  if (action === 'auth.sign-out') {
    await stopSharing(account.identity);
    await db.collection('client_sessions').doc(hash(token)).remove(); return { signedOut: true };
  }
  if (action === 'auth.sign-out-all') {
    return businessOperation(account, token, async () => {
      await stopSharing(account.identity);
      await accountDoc(account.username).update({ data: { sessionVersion: db.command.inc(1) } });
      return { signedOut: true };
    });
  }
  if (action === 'auth.password') return changePassword(account, data);
  if (action === 'auth.nickname') {
    const nickname = String(data.nickname || '').trim().slice(0, 24);
    if (!nickname) fail('请输入昵称');
    return businessOperation(account, token, async () => {
      await accountDoc(account.username).update({ data: { nickname } });
      await db.collection('team_members').where({ openid: account.identity }).update({ data: { nickname } });
      return profile({ ...account, nickname });
    });
  }
  if (action === 'gear-scan') {
    const consent = account.cloudConsents?.gearImageUpload;
    if (consent?.enabled !== true || consent?.policyVersion !== CLOUD_CONSENT_VERSIONS.gearImageUpload) {
      fail('请先在隐私设置中阅读并启用装备照片云端分析', 403, 'PRIVACY_CONSENT_REQUIRED');
    }
    const gearScanToken = process.env.GEAR_SCAN_INTERNAL_TOKEN || '';
    if (!/^[a-f0-9]{64}$/.test(gearScanToken)) fail('照片识别服务尚未完成安全配置', 503, 'GEAR_SCAN_NOT_CONFIGURED');
    await limit(`gear:${account.identity}`, 10);
    if (typeof data.image !== 'string' || data.image.length > 5.6 * 1024 * 1024) fail('图片过大或格式不正确');
    // Image decoding and model execution stay in the isolated inference function.
    const result = await businessOperation(account, token, () => cloud.callFunction({ name: 'gear-scan', data: {
      image: data.image, routeName: String(data.routeName || '').slice(0, 120), internalToken: gearScanToken,
    } }), 'gearImageUpload');
    return result.result;
  }
  if (!handlers.has(action)) fail('不支持此操作', 404);
  const requiredConsent = action === 'track-sync' ? 'trackCloudSync' : action === 'team-report' ? 'teamLocation' : undefined;
  return businessOperation(account, token, () => withIdentity(account.identity, () => require(`./business/${action}`).main(
    { ...data, nickname: account.nickname },
    ['social-manage', 'companion-create', 'companion-manage'].includes(action)
      ? { verifiedWechatOpenId: linkedMiniProgramOpenId(account) } : undefined,
  )), requiredConsent);
}
exports.main = async event => {
  // The public HTTP gateway owns CORS. Any upstream origin is concatenated
  // with its own, including identical values, and rejected by WebKit.
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const response = (statusCode, value) => ({ statusCode, headers, body: JSON.stringify(value) });
  if(event?.transport==='wechat-cloud') {
    const context=cloud.getWXContext();
    if(context.APPID!==MINI_PROGRAM_APPID||!context.OPENID)return response(401,{ok:false,errMsg:'微信调用身份无效'});
    // Context scopes request throttling only. Business identity still requires
    // the same verified opaque session used by the HTTPS gateway.
    event={httpMethod:'POST',body:JSON.stringify({action:event.action,data:event.data}),headers:{authorization:typeof event.token==='string'?`Bearer ${event.token}`:''},requestContext:{sourceIp:`wechat:${context.APPID}:${context.OPENID}`}};
  }
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  if (event.httpMethod !== 'POST') return response(405, { ok: false, errMsg: '只支持POST请求' });
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BODY) fail('请求体过大或格式不正确', 413);
    let request; try { request = JSON.parse(raw); } catch { fail('请求格式不正确'); }
    if (!request || typeof request.action !== 'string' || request.action.length > 64) fail('缺少操作名称');
    const incoming = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const token = String(incoming.authorization || '').replace(/^Bearer /i, '');
    const data = request.data && typeof request.data === 'object' && !Array.isArray(request.data) ? request.data : {};
    const remote = String(event.requestContext?.identity?.sourceIp || event.requestContext?.sourceIp || 'unknown');
    const result = await dispatch(request.action, data, token, remote);
    if (result?.errMsg || result?.ok === false) return response(400, { ok: false, errMsg: String(result.errMsg || '操作未完成'), code: result.code === 'TEAM_REQUEST_EXPIRED' ? result.code : undefined });
    return response(200, { ok: true, data: result });
  } catch (error) {
    // Never return headers, SDK exceptions or environment credentials.
    return response(error.status || 500, { ok: false, errMsg: error.status ? error.message : '服务暂时不可用，请稍后重试', code: error.code });
  }
};
