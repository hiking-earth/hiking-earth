// Only trusted WeChat cloud login creates these short-lived tickets.
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
exports.consume = async (db, ticket, allowDeletion = false) => {
  if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) throw new Error('微信登录凭据无效');
  const accountId = await db.runTransaction(async tx => {
    const ref = tx.collection('client_wechat_tickets').doc(hash(ticket));
    const value = (await ref.get()).data;
    if (!value || value.used || value.expiresAt <= Date.now()) throw new Error('微信登录凭据已过期，请重新登录');
    await ref.update({ data: { used: true, accountId: '' } });
    return value.accountId;
  });
  const account = (await db.collection('client_accounts').doc(accountId).get()).data;
  if (!account || account.disabled || (account.deleting && !allowDeletion)) throw new Error('账号已停用');
  return account;
};

exports.exchange = async (db, ticket, issueSession) => issueSession(await exports.consume(db, ticket));
