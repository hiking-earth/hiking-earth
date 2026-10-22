import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const relay = read('data/gateway-relay.ts');
const sharedRelay = readFileSync(path.resolve(root, '..', 'shared/network/gateway-relay.ts'), 'utf8');
const catalog = read('data/live-catalog.ts');
const proxy = read('app/api/client-api/route.ts');

for (const [name, source] of [['shared source', sharedRelay], ['generated web relay', relay]]) {
  assert.match(source, /window\.location\.origin===SITE/, `${name} must route the deployed public site through its same-origin proxy`);
  assert.match(source, /LOCAL_PREVIEW_HOSTS\.has\(window\.location\.hostname\)/, `${name} must route supported local preview hosts through their same-origin proxy`);
  assert.match(source, /fetch\('\/api\/client-api'/, `${name} requests must stay same-origin`);
}
for (const host of ['localhost', '127.0.0.1', '::1']) {
  assert.ok(sharedRelay.includes(`'${host}'`), `the shared relay must support ${host}`);
  assert.ok(relay.includes(`'${host}'`), `the generated web relay must support ${host}`);
}
assert.equal(relay, sharedRelay, 'the checked-in generated web relay must match the shared source of truth');
assert.match(catalog, /if\(needsGatewayRelay\(\)\)/, 'web route catalog requests must use the browser relay when supported');
assert.match(proxy, /process\.env\.HIKING_CLIENT_API_URL\|\|/, 'the proxy must honor the configured client API endpoint');
assert.match(proxy, /redirect:'manual'/, 'the proxy must not forward credentials through redirects');
