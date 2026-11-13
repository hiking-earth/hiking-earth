// One-time device login exchange. No bearer token is stored in QR contents.
const crypto = require('crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const randomChallenge = () => crypto.randomBytes(16).toString('hex');
const valid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validChallenge = value => typeof value === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(value);
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
const TTL = 3 * 60 * 1000;
const DEVICE_LABELS = new Set(['徒步地球网页版', '徒步地球桌面端']);
function service({ db, accountById, issueSession, revokeSession, sessionTTL = 7 * 24 * 60 * 60 * 1000, clock = Date.now }) {
  const collection = 'client_qr_logins';
  const deviceToken = (challenge, claimSecret) => digest(`hiking-earth-device-session:${challenge}:${claimSecret}`);
  async function revokeDeviceSession(token) {
    if (typeof revokeSession !== 'function') return false;
    try { await revokeSession(token); return true; } catch { /* challenge cancellation remains authoritative */ return false; }
  }
  async function revokeIfChallengeCancelled(challenge, token) {
    try {
      const current = (await db.collection(collection).doc(digest(challenge)).get()).data;
      if (!current || current.status === 'cancelled' || current.expiresAt <= clock()) {
        await revokeDeviceSession(token);
      }
    } catch { /* preserve the claim error; cancel() also attempts session cleanup */ }
  }
  async function start(data) {
    // Expired challenges can no longer be inspected, confirmed, or claimed.
    // Opportunistically remove a bounded batch so abandoned QR attempts do not
    // accumulate indefinitely in the free-tier database collection.
    try {
      const expired = await db.collection(collection).where({ expiresAt: db.command.lt(clock()) }).limit(50).get();
      for (const row of expired.data || []) await db.collection(collection).doc(row._id).remove();
    } catch {
      // Cleanup is best-effort; expiry is still enforced by transact().
    }
    // A 128-bit hex challenge fits WeChat's 32-character Mini Program QR scene.
    // The separate 256-bit claim secret remains private to the requesting device.
    const challenge = randomChallenge(), claimSecret = random(), expiresAt = clock() + TTL;
    const label = DEVICE_LABELS.has(data.deviceLabel) ? data.deviceLabel : '网页或桌面设备';
    await db.collection(collection).doc(digest(challenge)).set({ data: {
      secretHash: digest(claimSecret), status: 'pending', deviceLabel: label,
      createdAt: clock(), expiresAt,
    } });
    return { challenge, claimSecret, expiresAt };
  }
  async function transact(challenge, operation) {
    if (!validChallenge(challenge)) fail('登录二维码无效');
    return db.runTransaction(async tx => {
      const ref = tx.collection(collection).doc(digest(challenge));
      const value = (await ref.get()).data;
      if (!value || value.expiresAt <= clock()) fail('登录二维码已过期，请重新生成');
      return operation(value, ref);
    });
  }
  async function inspect(data) {
    return transact(data.challenge, value => ({ deviceLabel: value.deviceLabel,
      expiresAt: value.expiresAt, status: value.status }));
  }
  async function confirm(data, account) {
    if (data.confirmed !== true) fail('请明确确认登录此设备');
    return transact(data.challenge, async (value, ref) => {
      if (value.status !== 'pending') fail('二维码已处理，请重新生成');
      await ref.update({ data: { status: 'approved', accountId: digest(account.username), sessionVersion: account.sessionVersion,
        sessionExpiresAt: clock() + sessionTTL } });
      return { confirmed: true };
    });
  }
  async function claim(data) {
    if (!valid(data.claimSecret)) fail('登录领取凭据无效');
    const claimHash = digest(data.claimSecret);
    const result = await transact(data.challenge, async (value, ref) => {
      if (!['pending', 'approved', 'claiming', 'consumed'].includes(value.status)) fail('二维码已领取或取消，请重新生成');
      if (!valid(value.secretHash)
          || !crypto.timingSafeEqual(Buffer.from(value.secretHash, 'hex'), Buffer.from(claimHash, 'hex'))) fail('登录领取凭据无效');
      if (value.status === 'pending') return { status: 'pending', expiresAt: value.expiresAt };
      if (!['approved', 'claiming', 'consumed'].includes(value.status)
          || !valid(value.accountId) || !Number.isSafeInteger(value.sessionVersion)
          || !Number.isSafeInteger(value.sessionExpiresAt) || value.sessionExpiresAt <= clock()) {
        fail('登录二维码已过期，请重新生成');
      }
      if (value.status === 'approved') await ref.update({ data: { status: 'claiming' } });
      return { status: value.status, accountId: value.accountId, sessionVersion: value.sessionVersion,
        sessionExpiresAt: value.sessionExpiresAt };
    });
    if (result.status === 'pending') return result;
    const account = await accountById(result.accountId);
    if (!account || account.disabled || account.deleting || account.sessionVersion !== result.sessionVersion) fail('账号已停用，无法登录');
    // The device derives one stable bearer token from its private claim secret.
    // Retrying a lost HTTP response can recover the same session, never mint a
    // replacement token after logout or expiry. Once a prior claim has reached
    // claiming, the session may already have been created before its response
    // was lost; only recover that existing session, never recreate one after
    // the user signed out.
    const token = deviceToken(data.challenge, data.claimSecret);
    const session = await issueSession(account, { token, expiresAt: result.sessionExpiresAt,
      allowExistingOnly: result.status === 'claiming' || result.status === 'consumed' });
    try {
      await transact(data.challenge, async (value, ref) => {
        if (value.secretHash !== claimHash || !['claiming', 'consumed'].includes(value.status)
            || value.accountId !== result.accountId || value.sessionVersion !== result.sessionVersion
            || value.sessionExpiresAt !== result.sessionExpiresAt) fail('登录确认状态已改变，请重新扫码');
        if (value.status === 'claiming') await ref.update({ data: { status: 'consumed' } });
      });
    } catch (error) {
      // A page can cancel while the session write is in flight. If cancellation
      // won the challenge transaction, remove the exact deterministic session
      // so a hidden device does not leave a valid but unclaimed login behind.
      await revokeIfChallengeCancelled(data.challenge, token);
      throw error;
    }
    return { status: 'signed-in', session };
  }
  async function cancel(data) {
    if (!validChallenge(data.challenge)) fail('登录二维码无效');
    if (!valid(data.claimSecret)) fail('登录领取凭据无效');
    const result = await db.runTransaction(async tx => {
      const ref = tx.collection(collection).doc(digest(data.challenge));
      const value = (await ref.get()).data;
      // A vanished/expired challenge is no longer usable. Still attempt to
      // revoke its deterministic device session in case cleanup raced a claim.
      if (!value) return { cancelled: true, previousStatus: 'missing' };
      if (!valid(value.secretHash) || !crypto.timingSafeEqual(Buffer.from(value.secretHash, 'hex'), Buffer.from(digest(data.claimSecret), 'hex'))) fail('登录领取凭据无效');
      if (!['pending', 'approved', 'claiming', 'consumed', 'cancelled'].includes(value.status)) fail('二维码无效');
      const previousStatus = value.status;
      if (previousStatus !== 'cancelled') {
        // Keep only the hash of the creator-held claim secret so a failed
        // cleanup can be retried idempotently until the short challenge TTL.
        await ref.update({ data: { status: 'cancelled', accountId: '', sessionVersion: 0, sessionExpiresAt: 0 } });
      }
      return { cancelled: true, previousStatus, expired: value.expiresAt <= clock() };
    });
    const mayHaveSession = ['claiming', 'consumed', 'cancelled', 'missing'].includes(result.previousStatus)
      || result.expired === true;
    const sessionRevoked = mayHaveSession
      ? await revokeDeviceSession(deviceToken(data.challenge, data.claimSecret)) : true;
    return { cancelled: true, sessionRevoked };
  }
  return { start, inspect, confirm, claim, cancel };
}
module.exports = { service, TTL };
