import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

const page = read('app/offline-map/page.tsx');
const catalog = read('components/OfflineMapCatalog.tsx');
const home = read('app/page.tsx');
const stylesheet = read('app/globals.css');

assert.match(page, /<OfflineMapCatalog\s*\/>/, 'offline map page must show the packaged map catalog');
assert.match(catalog, /\/client-app\/static\/offline-maps\/catalog\.json/, 'catalog must come from the same-origin packaged client');
assert.match(catalog, /\/client-app\/#\/pages\/offline\/offline/, 'map manager link must open the shared client offline-map page');
assert.match(catalog, /row\.url === `static\/offline-maps\/\$\{row\.name\}`/, 'catalog paths must be constrained to packaged offline map assets');
assert.match(catalog, /row\.license === "ODbL-1\.0 Produced Work"/, 'catalog must enforce the published map license label');
assert.match(catalog, /totalBytes > 500_000_000/, 'catalog must enforce the 500 MB manifest budget');
assert.match(catalog, /192 MiB/, 'page must disclose the shared client offline storage cap');
assert.match(catalog, /地图收录不等于路线当前开放状态|路线开放状态/, 'page must distinguish map coverage from route access status');
assert.match(home, /href="\/offline-map"[^>]*aria-label="离线地图"/, 'home top bar must link to the offline map page');
assert.match(home, /<a href="\/offline-map" aria-label="离线地图"/, 'mobile navigation must keep the offline map entry reachable with native navigation');
assert.match(stylesheet, /\.release-links, \.offline-map-topbar-link \{ display: none; \}/, 'small screens must avoid adding another top-bar control');
assert.match(stylesheet, /\.offline-map-open-button[^{]*\{[^}]*var\(--he-color-accent\)/, 'offline map CTA must use the shared green palette');
