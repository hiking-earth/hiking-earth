#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const palette = JSON.parse(readFileSync(path.join(root, 'shared/design/palette.json'), 'utf8'));
const keys = ['background', 'panel', 'surface', 'text', 'muted', 'accent', 'border', 'onAccent', 'warning', 'caution', 'danger', 'info', 'routeMarker', 'routeMarkerSelected', 'onWarning', 'onCaution', 'warningText', 'mapOcean', 'mapWood', 'mapGrass', 'mapIce', 'mapSand', 'mapLand', 'mapWater', 'mapBuilding', 'mapRoadTrunk', 'mapRoadPrimary', 'mapRoad', 'mapBoundary', 'mapLabel', 'mapRoadLabel'];
for (const key of keys) {
  if (typeof palette[key] !== 'string' || !/^#[\da-f]{6}$/i.test(palette[key])) {
    throw new Error(`Invalid shared palette value: ${key}`);
  }
}
const overlayKeys = ['overlay', 'overlayBorder'];
for (const key of overlayKeys) {
  if (typeof palette[key] !== 'string' || !/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0|1|0?\.\d+)\s*\)$/i.test(palette[key])) {
    throw new Error(`Invalid shared overlay value: ${key}`);
  }
}
const rgbKeys = ['accent', 'warning', 'caution', 'danger', 'info'];
const rgbVars = Object.fromEntries(rgbKeys.map(key => {
  const match = palette[key].match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!match) throw new Error(`Invalid shared ${key} color`);
  return [key, match.slice(1).map(value => parseInt(value, 16)).join(', ')];
}));
const layoutKeys = ['homeTopbarHeight', 'homeTopbarRadius', 'homeBrandMarkSize', 'homePanelWidth', 'homePanelRadius',
  'homeMobileTopbarHeight', 'homeMobileTopbarRadius', 'homeMobileBrandMarkSize',
  'controlRadiusSm', 'controlRadius', 'inputRadius', 'cardRadius'];
for (const key of layoutKeys) {
  if (typeof palette[key] !== 'string' || !/^\d+(?:\.\d+)?px$/.test(palette[key])) {
    throw new Error(`Invalid shared layout value: ${key}`);
  }
}
const css = `/* Generated from shared/design/palette.json by scripts/sync-design-palette.mjs. */
:root, page {
${[
  ...keys.map(key => `  --he-color-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${palette[key]};`),
  ...Object.entries(rgbVars).map(([key, value]) => `  --he-color-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}-rgb: ${value};`),
  ...overlayKeys.map(key => `  --he-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${palette[key]};`),
  ...layoutKeys.map(key => `  --he-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${palette[key]};`),
].join('\n')}
}
`;
const scss = `// Generated from shared/design/palette.json by scripts/sync-design-palette.mjs.
${keys.map(key => `$he-color-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${palette[key]};`).join('\n')}
${layoutKeys.map(key => `$he-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${palette[key]};`).join('\n')}
`;
const typescript = `/* Generated from shared/design/palette.json by scripts/sync-design-palette.mjs. */
export const HE_PALETTE = Object.freeze(${JSON.stringify(Object.fromEntries(keys.map(key => [key, palette[key]])), null, 2)} as const);
`;
writeFileSync(path.join(root, 'shared/design/palette.css'), css);
writeFileSync(path.join(root, 'shared/design/palette.scss'), scss);
writeFileSync(path.join(root, 'shared/design/palette.ts'), typescript);
for (const pagesPath of [
  path.join(root, 'app/src/pages.json'),
]) {
  if (!existsSync(pagesPath)) continue;
  const pages = JSON.parse(readFileSync(pagesPath, 'utf8'));
  pages.globalStyle = { ...pages.globalStyle, navigationBarBackgroundColor: palette.background, backgroundColor: palette.background };
  pages.tabBar = { ...pages.tabBar, color: palette.muted, selectedColor: palette.accent, backgroundColor: palette.panel };
  writeFileSync(pagesPath, `${JSON.stringify(pages, null, 2)}\n`);
}
process.stdout.write('Generated client palette assets; website preparation uses its own pinned client source.\n');
