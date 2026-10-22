import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

const liveCatalog = read('data/live-catalog.ts');
const home = read('app/page.tsx');
const searchApi = read('app/api/catalog/search/route.ts');
assert.match(liveCatalog, /function discover\(raw:unknown/, 'remote route rows must be treated as unknown before mapping');
assert.match(liveCatalog, /function validReferencePaths\(value:unknown\)/, 'reference geometry must pass explicit bounds validation');
assert.match(liveCatalog, /pointCount>15000/, 'a single route must have a bounded total geometry size');
for (const source of ['Swisstopo', 'Usgs', 'Nps']) {
  assert.match(liveCatalog, new RegExp(`function valid${source}SearchPage\\(metadataValue:unknown,rowsValue:unknown\\)`), `${source} pages must be validated from unknown input`);
}
assert.match(liveCatalog, /function sumIntegerRecord\(value:unknown\)/, 'source counters must be validated before arithmetic');
assert.match(liveCatalog, /Number\.isSafeInteger\(value\)/, 'source counters must stay within JavaScript safe integer precision');
assert.match(liveCatalog, /Object\.keys\(value\)\.length>64/, 'source reason records must have a bounded number of keys');
assert.match(liveCatalog, /total>500000/, 'source reason totals must not exceed the largest source catalog limit');
assert.match(liveCatalog, /validReferencePaths\(paths\)/, 'specialized source geometries must share the bounded coordinate validator');
assert.match(liveCatalog, /function parseOfficialNotice\(value:unknown\)/, 'official notice rows must be validated from unknown data');
assert.match(liveCatalog, /hasCurrentOfficialFeedReview\(source\)/, 'official notices must match a current reviewed source definition');
assert.match(liveCatalog, /source\.articleHosts\.includes\(article\.hostname\)/, 'official notice article links must stay on the configured host allowlist');
assert.match(home, /当前仅显示内置待核验基础档案/, 'a first-visit catalog failure must not describe seed records as a saved catalog');
assert.match(home, /hasRestoredCatalog=true/, 'the route refresh fallback label must track whether a local catalog was restored');
const registry = read('data/catalog-sources.ts');
assert.match(liveCatalog, /const sources=PUBLIC_ROUTE_SOURCES/, 'catalog search must use the shared source registry');
const sourceList = registry.match(/PUBLIC_ROUTE_SOURCES\s*=\s*\[([^\]]+)\] as const/);
assert.ok(sourceList, 'website route search must keep an explicit source list');
const liveSources = new Set([...sourceList[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, id]) => id));
const pageSourceType = home.match(/const \[searchSource,setSearchSource\]=useState<([^>]+)>/);
assert.ok(pageSourceType, 'the website source selector must keep a typed source list');
const pageSources = new Set([...pageSourceType[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, id]) => id));
assert.match(searchApi, /import \{isPublicRouteSource\} from ['"][^'"]*catalog-sources['"]/, 'search API must import the shared source validator');
assert.match(searchApi, /if\(!isPublicRouteSource\(source\)/, 'search API must validate against the shared source registry');
assert.match(registry, /PUBLIC_ROUTE_SOURCES as readonly string\[\]\)\.includes\(value\)/, 'shared validator must enforce registry membership');
const apiSources = liveSources;
assert.deepEqual([...pageSources].sort(), [...liveSources].sort(), 'the website source selector must match its catalog registry');
assert.deepEqual([...apiSources].sort(), [...liveSources].sort(), 'the website API allowlist must match its catalog registry');
assert.ok(liveSources.has('japan-tokai'), 'website route search must include the licensed Japan Tokai catalog');
assert.match(home, /value="japan-tokai"/, 'the website source selector must expose Japan Tokai search');
assert.ok(liveSources.has('taiwan-trails'), 'website route search must include the Taiwan Tourism Administration dataset');
const sourceNamesMap = liveCatalog.match(/const sourceNames:Record<PublicRouteSource,string>=\{([^}]+)\};/);
assert.ok(sourceNamesMap, 'website catalog must keep source display names in one map');
assert.equal((sourceNamesMap[1].match(/'taiwan-trails':/g) || []).length, 1, 'Taiwan must have exactly one display name');
const sourceAttributionLine = liveCatalog.split('\n').find(line => line.includes('const defaultAttribution:'));
assert.ok(sourceAttributionLine, 'website catalog must keep source attributions in one map');
assert.equal((sourceAttributionLine.match(/'taiwan-trails':/g) || []).length, 1, 'Taiwan must have exactly one default attribution');
assert.match(home, /value="taiwan-trails"/, 'the website source selector must expose Taiwan official trail discovery');
assert.ok(liveSources.has('korea-durunubi-trails'), 'website search must expose Korea Tourism Organization DuruNubi routes');
assert.match(home, /value="korea-durunubi-trails"/, 'the website source selector must expose DuruNubi search');
assert.equal((sourceNamesMap[1].match(/'korea-durunubi-trails':/g) || []).length, 1, 'DuruNubi must have exactly one display name');
assert.equal((sourceAttributionLine.match(/'korea-durunubi-trails':/g) || []).length, 1, 'DuruNubi must have exactly one default attribution');
assert.ok(apiSources.has('japan-tokai'), 'shared API registry must allow Japan Tokai');
assert.match(liveCatalog, /日本环境省说明GPS线仍可能有位置误差/, 'Japan route results must disclose source accuracy and non-navigation limits');

const staticCatalog = read('data/static-catalog.ts');
assert.match(staticCatalog, /page-.*\.bin/, 'website route pages must request directly-served gzip payloads');
assert.match(staticCatalog, /index\.bin/, 'website route search index must request directly-served gzip payloads');
const prepareClient = read('scripts/prepare-client.mjs');
assert.ok(prepareClient.includes('filename.replace') && prepareClient.includes("'.bin'"), 'website preparation must retain gzip bytes while publishing opaque file extensions');
const catalogFiles = prepareClient.match(/const catalogFiles = \{([\s\S]*?)\n\};/);
assert.ok(catalogFiles, 'website packaging must keep an explicit pinned catalog map');
const packagedSources = new Set([...catalogFiles[1].matchAll(/^\s*(?:'([^']+)'|([a-z][a-z0-9-]*))\s*:/gm)]
  .map(([, quoted, bare]) => quoted || bare));

for (const source of liveSources) {
  if (source === 'usgs-trails' || source === 'taiwan-trails' || source === 'korea-durunubi-trails') continue;
  assert.ok(packagedSources.has(source), `website packaging must include the ${source} static snapshot`);
}
for (const source of packagedSources) {
  if (source === 'news') continue;
  assert.ok(liveSources.has(source), `website package must not carry an unsearchable ${source} route catalog`);
}
assert.ok(packagedSources.has('news'), 'website package must retain the official-notice snapshot');
assert.ok(!packagedSources.has('usgs-trails'), 'online-only USGS search must not require a full-catalog snapshot');
assert.ok(!packagedSources.has('taiwan-trails'), 'online Taiwan search may use the official cloud snapshot without a pinned-client offline copy');
assert.ok(!packagedSources.has('korea-durunubi-trails'), 'online DuruNubi search may use the official cloud snapshot without a pinned-client offline copy');
