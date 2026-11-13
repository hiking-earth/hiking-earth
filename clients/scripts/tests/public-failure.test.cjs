const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../../app/cloudfunctions/client-api/public-failure');
test('public failure categories reveal only a bounded stage', () => {
  for (const [stage, code] of [['public-rate-limit','PUBLIC_RATE_LIMIT_FAILED'],['public-session','PUBLIC_SESSION_CHECK_FAILED'],['public-business','PUBLIC_BUSINESS_FAILED']]) {
    const raw = Object.assign(new Error('private SDK detail'), {code:'PRIVATE_SDK_CODE',token:'secret'});
    const safe = classify(raw,stage);
    assert.equal(safe.code,code);
    assert.equal(safe.message,'服务暂时不可用，请稍后重试');
    assert.equal(safe.token,undefined);
    assert.equal(safe.status,undefined);
    assert.notEqual(safe,raw);
  }
});
test('expected authentication and limit errors retain their existing status', () => {
  for (const status of [401,403,429]) {
    const error = Object.assign(new Error('expected'),{status,code:'EXPECTED'});
    assert.equal(classify(error,'public-session'),error);
  }
});
test('unrecognized stage yields a generic public category', () => {
  assert.equal(classify(new Error('private'),'arbitrary-private-value').code,'PUBLIC_REQUEST_FAILED');
});
