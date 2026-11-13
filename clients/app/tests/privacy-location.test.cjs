const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function setup(extra = {}) {
  const storage = new Map(), intervals = new Map(), events = new Set(), compass = new Set();
  const requests = [];
  let starts = 0, stops = 0;
  const uni = {
    getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, v),
    removeStorageSync: k => storage.delete(k),
    request: opts => opts.fail({errMsg: 'simulated network unavailable'}),
    startLocationUpdate: opts => { starts++; requests.push(opts); },
    stopLocationUpdate: () => { stops++; },
    onLocationChange: fn => events.add(fn), offLocationChange: fn => events.delete(fn),
    onCompassChange: fn => compass.add(fn), offCompassChange: fn => compass.delete(fn),
    getLocation: opts => opts.success({ latitude: 1, longitude: 2, altitude: 0 }),
  };
  let timer = 0;
  const context = vm.createContext({ uni, console, ...extra,
    setInterval: fn => { intervals.set(++timer, fn); return timer; },
    clearInterval: id => intervals.delete(id),
  });
  const cache = new Map();
  function load(file) {
    file = path.resolve(__dirname, '..', file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const flags = new Set(extra.wx ? ['MP-WEIXIN'] : ['H5']);
    const stack = [true];
    const platformSource = fs.readFileSync(file, 'utf8').split('\n').filter(line => {
      const start = line.match(/^\s*\/\/\s*#(ifdef|ifndef)\s+(.+)$/);
      if (start) {const matches=start[2].trim().split(/\s*\|\|\s*/).some(flag=>flags.has(flag));stack.push(stack[stack.length-1] && (start[1]==='ifdef'?matches:!matches));return false;}
      if (/^\s*\/\/\s*#endif/.test(line)) {stack.pop();return false;}
      return stack[stack.length-1];
    }).join('\n').replace(/import\.meta\.env/g, '({})');
    const code = ts.transpileModule(platformSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const requireLocal = name => {
      if (!name.startsWith('@/') && !name.startsWith('@shared/') && !name.startsWith('.')) return require(name);
      const target = name.startsWith('@/') ? path.resolve(__dirname, '..', 'src/' + name.slice(2))
        : name.startsWith('@shared/') ? path.resolve(__dirname, '..', '../shared/' + name.slice(8))
          : path.resolve(path.dirname(file), name);
      const resolved = [target, target + '.ts', target + '.js', path.join(target, 'index.ts')]
        .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!resolved) throw new Error(`Cannot resolve local test module: ${name} from ${file}`);
      return load(resolved);
    };
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(requireLocal, mod, mod.exports);
    return mod.exports;
  }
  const privacy = load('src/services/privacy.ts'), location = load('src/services/location.ts');
  return { uni, privacy, location, load, intervals, requests, events, compass, get starts() { return starts; }, get stops() { return stops; } };
}
test('default denial does not start native location', async () => {
  const h = setup(); assert.equal(await h.location.startLocationUpdates(() => {}), false); assert.equal(h.starts, 0);
});
test('revocation stops active stream and removes exact listeners', async () => {
  const h = setup(); h.privacy.setPrivacyConsent('location', true);
  const p = h.location.startLocationUpdates(() => {}); h.requests[0].success(); assert.equal(await p, true);
  h.location.startCompass(() => {});
  h.privacy.setPrivacyConsent('location', false);
  assert.equal(h.events.size, 0); assert.equal(h.compass.size, 0); assert.ok(h.stops > 0);
});
test('permission failure is not reported as a successful start', async () => {
  const h = setup(); h.privacy.setPrivacyConsent('location', true);
  const p = h.location.startLocationUpdates(() => {}); h.requests[0].fail({ errMsg: 'auth deny' });
  assert.equal(await p, false); assert.equal(h.intervals.size, 0);
});
test('unsupported API fallback timer is stopped and late results ignored', async () => {
  const h = setup(); let count = 0; h.privacy.setPrivacyConsent('location', true);
  const cb = () => count++;
  const p = h.location.startLocationUpdates(cb); h.requests[0].fail({ errMsg: 'not support' });
  assert.equal(await p, true); assert.equal(count, 1); assert.equal(h.intervals.size, 1);
  let late; h.uni.getLocation = opts => { late = opts.success; };
  [...h.intervals.values()][0](); h.location.stopLocationUpdates(cb); late({ latitude: 1, longitude: 2 });
  assert.equal(h.intervals.size, 0); assert.equal(count, 1);
});
test('cancel pending start cannot revive location after native success', async () => {
  const h = setup(); h.privacy.setPrivacyConsent('location', true);
  const cb = () => {}; const p = h.location.startLocationUpdates(cb);
  h.location.stopLocationUpdates(cb); assert.equal(await p, false);
  h.requests[0].success(); assert.equal(h.events.size, 0);
});
test('multiple consumers share one start; revoking team preserves navigation', async () => {
  const h = setup(); h.privacy.setPrivacyConsent('location', true); h.privacy.setPrivacyConsent('teamLocation', true);
  let nav = 0, team = 0;
  const a = h.location.startLocationUpdates(() => nav++), b = h.location.startLocationUpdates(() => team++, 'team');
  assert.equal(h.starts, 1); h.requests[0].success(); assert.equal(await a, true); assert.equal(await b, true);
  h.privacy.setPrivacyConsent('teamLocation', false);
  [...h.events][0]({ latitude: 1, longitude: 2 }); assert.equal(nav, 1); assert.equal(team, 0);
});
test('App/H5 must not fabricate successful login, sync or SOS', async () => {
  const h = setup(); h.privacy.setPrivacyConsent('trackCloudSync', true);
  const cloud = h.load('src/services/cloud.ts');
  for (const name of ['login', 'track-sync', 'sos-trigger', 'team-create']) assert.equal((await cloud.callCloud(name)).ok, false);
});
test('cloud rejects business errors and revoked uploads before transport', async () => {
  let calls = 0;
  const h = setup({ wx: { cloud: { init() {}, async callFunction() { calls++; return { result: { errMsg: 'invalid catalog' } }; } } } });
  const cloud = h.load('src/services/cloud.ts');
  assert.equal((await cloud.callCloud('track-sync')).ok, false); assert.equal(calls, 0);
  h.privacy.setPrivacyConsent('trackCloudSync', true);
  const protectedUpload = await cloud.callCloud('track-sync');
  assert.equal(protectedUpload.ok, false);
  assert.match(protectedUpload.errMsg, /请先登录徒步地球账号/);
  assert.equal(calls, 0, 'personal track uploads stay behind the unified-account gate');
  const result = await cloud.callCloud('catalog-feed');
  assert.equal(result.ok, false); assert.equal(result.errMsg, 'invalid catalog');
  assert.equal(calls, 1, 'business errors from an allowed public cloud call are still rejected');
});

test('location subscriber failure does not block another view', async () => {
  const h=setup(); h.privacy.setPrivacyConsent('location',true); let received=0;
  const a=h.location.startLocationUpdates(()=>{throw new Error('view disposed');});
  const b=h.location.startLocationUpdates(()=>received++); h.requests[0].success();
  assert.equal(await a,true); assert.equal(await b,true);
  assert.doesNotThrow(()=>[...h.events][0]({latitude:1,longitude:2})); assert.equal(received,1);
});
test('compass subscriber failure does not block another view', () => {
  const h=setup(); h.privacy.setPrivacyConsent('location',true); let received=0;
  h.location.startCompass(()=>{throw new Error('view disposed');}); h.location.startCompass(()=>received++);
  assert.doesNotThrow(()=>[...h.compass][0]({direction:42})); assert.equal(received,1);
});
test('throwing platform cleanup still settles pending start and revokes delivery', async () => {
  const h=setup(); h.privacy.setPrivacyConsent('location',true); let received=0;
  const pending=h.location.startLocationUpdates(()=>received++);
  h.uni.offLocationChange=()=>{throw new Error('platform unavailable');};
  h.uni.stopLocationUpdate=()=>{throw new Error('platform unavailable');};
  assert.doesNotThrow(()=>h.location.stopLocationUpdates()); assert.equal(await pending,false);
  h.requests[0].success(); assert.equal(received,0);
});

test('synchronous start failure resolves false and permits retry', async () => {
 const h=setup(); h.privacy.setPrivacyConsent('location',true);
 const original=h.uni.startLocationUpdate;
 h.uni.startLocationUpdate=()=>{throw new Error('API unavailable');};
 assert.equal(await h.location.startLocationUpdates(()=>{}),false);
 h.uni.startLocationUpdate=original;
 const retried=h.location.startLocationUpdates(()=>{}); h.requests[0].success(); assert.equal(await retried,true);
});
test('listener registration failure cannot report successful start', async () => {
 const h=setup(); h.privacy.setPrivacyConsent('location',true);
 h.uni.onLocationChange=()=>{throw new Error('API unavailable');};
 const p=h.location.startLocationUpdates(()=>{}); assert.doesNotThrow(()=>h.requests[0].success());
 assert.equal(await p,false); assert.ok(h.stops>0);
});
test('polling platform throw revokes stream without escaping timer', async () => {
 const h=setup(); h.privacy.setPrivacyConsent('location',true);
 const p=h.location.startLocationUpdates(()=>{}); h.requests[0].fail({errMsg:'not support'}); assert.equal(await p,true);
 h.uni.getLocation=()=>{throw new Error('API unavailable');};
 assert.doesNotThrow(()=>[...h.intervals.values()][0]()); assert.equal(h.intervals.size,0);
});
