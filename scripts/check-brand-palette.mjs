import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocalClientPreviewSource, resolvePinnedClientSource } from './pinned-client-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const clientRelease = JSON.parse(read('clients.source.json'));
const clientRoot = process.env.HIKING_CLIENT_PREVIEW === '1'
  ? resolveLocalClientPreviewSource(root, clientRelease)
  : resolvePinnedClientSource(root, clientRelease);
const readClient = (relativePath) => readFileSync(path.join(clientRoot, relativePath), 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const paletteSource = read('app/palette.ts');
const paletteMatch = paletteSource.match(/Object\.freeze\(([\s\S]*?) as const\)/);
assert.ok(paletteMatch, 'generated web palette must export a frozen palette object');
const palette = JSON.parse(paletteMatch[1]);
const css = read('app/palette.css');

for (const [key, value] of Object.entries(palette)) {
  const cssKey = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  assert.ok(css.includes(`--he-color-${cssKey}: ${value};`), `web CSS palette is out of sync for ${key}`);
}

// The site's glow, borders, and translucent controls use RGB channels. Keep
// those generated values byte-for-byte aligned with the hex palette too.
for (const key of ['accent', 'warning', 'caution', 'danger', 'info']) {
  const match = palette[key].match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  assert.ok(match, `web palette ${key} must be a six-digit color`);
  const expected = match.slice(1).map(channel => Number.parseInt(channel, 16)).join(', ');
  assert.ok(css.includes(`--he-color-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}-rgb: ${expected};`),
    `web RGB palette is out of sync for ${key}`);
}

assert.equal(palette.accent, '#b8f36b', 'website and shared client must keep the approved lime-green accent');
assert.equal(
  read('app/theme-color.ts').match(/WEB_THEME_COLOR = '([^']+)'/)?.[1],
  palette.background,
  'PWA browser chrome color must match the shared page background',
);

const manifest = JSON.parse(read('public/manifest.webmanifest'));
assert.equal(manifest.background_color, palette.background, 'PWA background color must match the shared palette');
assert.equal(manifest.theme_color, palette.background, 'PWA theme color must match the shared palette');

const globals = read('app/globals.css');
assert.ok(globals.includes('@import "./palette.css";'), 'website styles must load the generated shared palette');
assert.match(globals, /--lime:\s*var\(--he-color-accent\)/, 'website accent alias must resolve to the shared green');
assert.match(globals, /\.primary-button\s*\{[^}]*background:\s*var\(--lime\)[^}]*color:\s*var\(--he-color-on-accent\)/s,
  'primary CTA must use the shared green and its readable foreground');
assert.match(globals, /\.brand-mark\s*\{[^}]*background:\s*var\(--lime\)/s,
  'website home brand mark must use the same generated green');
assert.match(globals, /\.layer-switch button\.active\s*\{[^}]*background:\s*var\(--lime\)/s,
  'website selected navigation tab must use the same generated green');
assert.match(globals, /\.icon-button\.active\s*\{[^}]*background:\s*var\(--lime\)/s,
  'website selected utility controls must use the same generated green');
assert.match(globals, /\.filter-button\.active\s*\{[^}]*color:\s*var\(--lime\)/s,
  'website active filter control must use the same generated green');
assert.match(globals, /\.filters button\.active\s*\{(?=[^}]*background:\s*var\(--lime\))(?=[^}]*border-color:\s*var\(--lime\))[^}]*\}/s,
  'website selected filter options must use the same generated green');
assert.match(globals, /\.terrain-toggle button\.active\s*\{[^}]*background:\s*var\(--lime\)/s,
  'website selected map layer must use the same generated green');
assert.match(globals, /\.hub-tabs button\.active\s*\{[^}]*background:\s*var\(--lime\)/s,
  'website selected project tab must use the same generated green');
assert.match(globals, /\.route-card\.active\s*\{[^}]*border-color:\s*rgba\(var\(--he-color-accent-rgb\)/s,
  'selected route card must use the shared accent color');
assert.match(globals, /\.route-marker\.selected\s*\{[^}]*drop-shadow\(0 0 5px var\(--he-color-accent\)\)/s,
  'selected globe marker must glow with the shared accent color');

const clientHome = readClient('app/src/pages/index/index.vue');
const clientHomeStyle = clientHome.match(/\.page\s*\{([^\n]+)\}/)?.[1];
assert.ok(clientHomeStyle, 'embedded client home styles must be available to the website repository');
function alphaFor(source, rgb, occurrence = 0) {
  const escaped = rgb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values = [...source.matchAll(new RegExp(`rgba\\(${escaped},\\s*([0-9.]+)\\)`, 'g'))]
    .map((match) => match[1]);
  const value = values[occurrence];
  assert.ok(value, `missing rgba(${rgb}, alpha)`);
  return Number(value);
}
function selectorOpacity(selector) {
  const body = globals.match(new RegExp(`(?:^|\\n)\\s*${selector}\\s*\\{([^}]+)\\}`))?.[1];
  const value = body?.match(/opacity:\s*([0-9.]+)/)?.[1];
  assert.ok(value, `missing ${selector} opacity`);
  return Number(value);
}
const starLayers = [
  ['.space-backdrop::before', [['255,255,255', 0.92], ['170,204,255', 0.75], ['255,240,201', 0.55]]],
  ['.space-backdrop::after', [['255,255,255', 0.8, 1], ['128,171,255', 0.7]]],
];
for (const [selector, stars] of starLayers) {
  const opacity = selectorOpacity(selector.replaceAll('.', '\\.').replaceAll(':', '\\:'));
  for (const [rgb, sourceOpacity, occurrence = 0] of stars) {
    assert.ok(Math.abs(alphaFor(clientHomeStyle, rgb, occurrence) - opacity * sourceOpacity) < 0.001,
      `embedded client star opacity for ${rgb} must match ${selector}`);
  }
}

// Both globes retain the same pinned NASA source. The website uses the reviewed
// full-color Mercator asset, while smaller clients keep a bounded indexed texture.
// Verify its provenance and digest so a stale image cannot silently replace it.
const clientEarthSourcePath = 'app/src/components/earth-texture.json';
const clientEarthProvenance = JSON.parse(readClient('app/src/components/earth-texture.provenance.json'));
const clientEarthBytes = readFileSync(path.join(clientRoot, clientEarthSourcePath));
const webEarthAssetPath = 'public/static/earth/blue-marble-mercator-4096.webp';
const webEarthBytes = readFileSync(path.join(root, webEarthAssetPath));
const webEarthProvenance = JSON.parse(read('public/static/earth/blue-marble-mercator-4096.webp.provenance.json'));
const prepareClient = read('scripts/prepare-client.mjs');
assert.ok(prepareClient.includes("path.join(clientRoot, 'app/src/components/earth-texture.json')"),
  'website globe must use the reviewed NASA asset from the pinned client source');
assert.equal(sha256(clientEarthBytes), clientEarthProvenance.sha256,
  'shared-client globe texture must match its source provenance digest');
assert.equal(webEarthProvenance.generatedAsset, path.basename(webEarthAssetPath),
  'website globe provenance must name the generated Earth asset');
assert.equal(sha256(webEarthBytes), webEarthProvenance.generatedAssetSha256,
  'website globe image must match its generated-asset provenance digest');
assert.equal(webEarthBytes.length, webEarthProvenance.generatedAssetBytes,
  'website globe image byte count must match its generated-asset provenance');
for (const key of ['source', 'sourcePage', 'credit', 'description']) {
  assert.equal(webEarthProvenance[key], clientEarthProvenance[key],
    `website and shared-client globe must retain the same NASA ${key}`);
}

process.stdout.write('Website palette, primary controls, route selection, PWA theme, embedded-client star layers, and cross-platform NASA globe provenance are aligned.\n');
