import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'data/live-catalog.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

const sourceRegistry = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'data/catalog-sources.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(sourceRegistry);

function loadCatalog(osmRows) {
  const exports = {};
  const fakeFetch = async (_url, request) => {
    const { action, data: payload } = JSON.parse(request.body);
    const data = action === 'catalog-feed'
      ? { snapshot: 'a'.repeat(64), key: 'routes', total: payload.source === 'osm' ? osmRows.length : 0, page: 0, hasMore: false,
        items: payload.source === 'osm' ? osmRows : [], metadata: { generatedAt: new Date().toISOString(), sourceTotal: payload.source === 'osm' ? osmRows.length : 0 } }
      : { items: [], hasMore: false };
    return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const requireStub = name => name === './catalog-sources' ? sourceRegistry
    : name === './catalog-limits' ? { CATALOG_PAGE_SIZE: 20, CATALOG_SOURCE_LIMIT: 2000 }
    : name === './gateway-relay' ? { needsGatewayRelay: () => false, gatewayRelayRequest: async () => { throw new Error('unexpected gateway'); } }
      : name === './routes' ? { ROUTES: [], reviewedRouteStatus: (status, expiresAt) => expiresAt > Date.now() ? status : '待核验' }
        : name === './static-catalog' ? { loadStaticPages: async () => { throw new Error('no static fallback'); }, searchStatic: async () => [], staticManifest: async () => { throw new Error('no static fallback'); } }
          : name === './discovery-tags' ? { discoveryNameReview: () => [], discoveryTagHighlights: () => [], discoveryTagValue: () => '' }
            : name === './official-sources.json' ? { sources: [] }
              : name === './official-source-review' ? { hasCurrentOfficialFeedReview: () => false }
                : {};
  new Function('require', 'exports', 'fetch', 'AbortSignal', 'URL', 'Date', compiled)(requireStub, exports, fakeFetch, AbortSignal, URL, Date);
  return exports;
}

function routeRow(overrides = {}) {
  return { id: 'osm-relation-77', name: 'Route', region: 'Region', center: [1, 2], fetchedAt: new Date().toISOString(), ...overrides };
}

function cachedRoute() {
  return { id: 'osm-relation-42', name: 'Cached', region: 'Region', status: '开放中', openingExpiresAt: Date.now() + 86400000,
    center: [1, 2], path: [[1, 2], [2, 3]], trackMode: '已核验轨迹', archive: { checkedAt: 'prior check', riskNotice: '许可：CC BY', source: { label: 'OSM' } } };
}

for (const [name, rows] of [
  ['invalid rows', [routeRow(), routeRow({ id: '', name: 'Invalid' })]],
  ['duplicate source IDs', [routeRow(), routeRow()]],
]) {
  test(`invalid ${name} fail closed and retain cached routes for review`, async () => {
    const catalog = loadCatalog(rows);
    const result = await catalog.loadPublicRouteCatalog([cachedRoute()]);
    const retained = result.find(route => route.id === 'osm-relation-42');
    assert.equal(catalog.publicCatalogHasSourceFailures(), true);
    assert.equal(retained.status, '待核验');
    assert.equal(retained.openingExpiresAt, 0);
    assert.deepEqual(retained.path, []);
    assert.equal(retained.trackMode, '不展示轨迹');
    assert.match(retained.archive.riskNotice, /路线来源当前不可用/);
    assert.match(catalog.publicCatalogCoverageSummary(), /OSM：来源暂不可用，沿用1条本机档案并降为待核验/);
  });
}
