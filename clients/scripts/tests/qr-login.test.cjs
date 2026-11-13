const { test } = require('node:test');
const assert = require('node:assert/strict');
const { service, TTL } = require('../../app/cloudfunctions/client-api/qr-login');
function fixture() {
 const store = new Map(); let time = 1000, tail = Promise.resolve(), issued = 0;
 const collection = () => ({ doc: id => ({
  get: async () => ({ data: store.get(id) }),
  set: async ({ data }) => store.set(id, structuredClone(data)),
  update: async ({ data }) => store.set(id, { ...store.get(id), ...data }),
 }) });
 const db = { collection, runTransaction: fn => {
  const pending = tail.then(() => fn({ collection })); tail = pending.catch(() => {}); return pending;
 } };
 const account = { username: 'fixture', sessionVersion: 0, disabled: false };
 return { account, store, advance: () => time += TTL, issued: () => issued,
  qr: service({ db, clock: () => time, accountById: async () => account,
   issueSession: async () => { issued++; return { token: 'test-only', openid: 'fixture' }; } }) };
}
test('challenge is not a token and requires device confirmation', async () => {
 const f = fixture(), start = await f.qr.start({ deviceLabel: 'Mac' });
 assert.notEqual(start.challenge, start.claimSecret);
 assert.equal((await f.qr.claim(start)).status, 'pending');
 assert.equal((await f.qr.inspect(start)).deviceLabel, 'Mac');
 await assert.rejects(f.qr.confirm(start, f.account));
 await f.qr.confirm({ ...start, confirmed: true }, f.account);
 assert.equal((await f.qr.claim(start)).status, 'signed-in');
 await assert.rejects(f.qr.claim(start)); assert.equal(f.issued(), 1);
});
test('wrong secret cannot claim; concurrent claims issue one session', async () => {
 const f = fixture(), start = await f.qr.start({});
 await f.qr.confirm({ ...start, confirmed: true }, f.account);
 await assert.rejects(f.qr.claim({ ...start, claimSecret: '0'.repeat(64) }));
 const results = await Promise.allSettled([f.qr.claim(start), f.qr.claim(start)]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 assert.equal(f.issued(), 1);
});
test('cancel and expiry do not create sessions', async () => {
 const f = fixture(), start = await f.qr.start({});
 await f.qr.cancel(start); await assert.rejects(f.qr.claim(start));
 const expired = await f.qr.start({}); f.advance();
 await assert.rejects(f.qr.confirm({ ...expired, confirmed: true }, f.account));
 assert.equal(f.issued(), 0);
});
test('account revocation after approval prevents login', async () => {
 const f = fixture(), start = await f.qr.start({});
 await f.qr.confirm({ ...start, confirmed: true }, f.account);
 f.account.sessionVersion++;
 await assert.rejects(f.qr.claim(start)); assert.equal(f.issued(), 0);
});
