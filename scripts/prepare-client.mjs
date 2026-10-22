// Build the shared client once and bundle it as same-origin website assets.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {resolveLocalClientPreviewSource,resolvePinnedClientSource} from './pinned-client-source.mjs';
import {exportEarthTexture} from './export-earth-texture.mjs';
import {loadReleaseManifest} from './release-manifest.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(readFileSync(path.join(root, 'clients.source.json'), 'utf8'));
const localPreview=process.env.HIKING_CLIENT_PREVIEW==='1';
const clientRoot=localPreview
 ? resolveLocalClientPreviewSource(root,source)
 : resolvePinnedClientSource(root,source);
if(localPreview)process.stdout.write('Preparing a local-only website preview from the current client checkout; this source is not eligible for CI or release packaging.\n');
// Generate website theme files from the same immutable client source used by
// this build. Keep the independent website checkout self-contained in CI.
const palette = JSON.parse(readFileSync(path.join(clientRoot, 'shared/design/palette.json'), 'utf8'));
const paletteKeys = ['background', 'panel', 'surface', 'text', 'muted', 'accent', 'border', 'onAccent', 'warning', 'caution', 'danger', 'info', 'routeMarker', 'routeMarkerSelected', 'onWarning', 'onCaution', 'warningText', 'mapOcean', 'mapWood', 'mapGrass', 'mapIce', 'mapSand', 'mapLand', 'mapWater', 'mapBuilding', 'mapRoadTrunk', 'mapRoadPrimary', 'mapRoad', 'mapBoundary', 'mapLabel', 'mapRoadLabel'];
for (const key of paletteKeys) {
  if (typeof palette[key] !== 'string' || !/^#[\da-f]{6}$/i.test(palette[key])) throw new Error(`Invalid pinned shared palette value: ${key}`);
}
for (const key of ['overlay', 'overlayBorder']) {
  if (typeof palette[key] !== 'string' || !/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0|1|0?\.\d+)\s*\)$/i.test(palette[key])) throw new Error(`Invalid pinned shared overlay value: ${key}`);
}
const paletteRgb = Object.fromEntries(['accent', 'warning', 'caution', 'danger', 'info'].map(key => {
  const match = palette[key].match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!match) throw new Error(`Invalid pinned shared ${key} color`);
  return [key, match.slice(1).map(value => parseInt(value, 16)).join(', ')];
}));
const layoutKeys = ['homeTopbarHeight', 'homeTopbarRadius', 'homeBrandMarkSize', 'homePanelWidth', 'homePanelRadius', 'homeMobileTopbarHeight', 'homeMobileTopbarRadius', 'homeMobileBrandMarkSize', 'controlRadiusSm', 'controlRadius', 'inputRadius', 'cardRadius'];
for (const key of layoutKeys) {
  if (typeof palette[key] !== 'string' || !/^\d+(?:\.\d+)?px$/.test(palette[key])) throw new Error(`Invalid pinned shared layout value: ${key}`);
}
const cssKey = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const paletteCss = `/* Generated from the pinned client's shared/design/palette.json. */\n:root {\n${[
  ...paletteKeys.map(key => `  --he-color-${cssKey(key)}: ${palette[key]};`),
  ...Object.entries(paletteRgb).map(([key, value]) => `  --he-color-${cssKey(key)}-rgb: ${value};`),
  ...['overlay', 'overlayBorder'].map(key => `  --he-${cssKey(key)}: ${palette[key]};`),
  ...layoutKeys.map(key => `  --he-${cssKey(key)}: ${palette[key]};`),
].join('\n')}\n}\n`;
const paletteTs = `/* Generated from the pinned client's shared/design/palette.json. */\nexport const HE_PALETTE = Object.freeze(${JSON.stringify(Object.fromEntries(paletteKeys.map(key => [key, palette[key]])), null, 2)} as const);\n`;
writeFileSync(path.join(root, 'app/palette.css'), paletteCss);
writeFileSync(path.join(root, 'app/palette.ts'), paletteTs);
writeFileSync(path.join(root, 'app/theme-color.ts'), `/* Generated from the pinned client's shared/design/palette.json. */\nexport const WEB_THEME_COLOR = '${palette.background}';\n`);
const manifestPath = path.join(root, 'public/manifest.webmanifest');
const webManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
webManifest.background_color = palette.background;
webManifest.theme_color = palette.background;
writeFileSync(manifestPath, `${JSON.stringify(webManifest, null, 2)}\n`);
const noticeRegistryPath=path.join(clientRoot,'shared/data/content/official-sources.json');
const noticeRegistry=JSON.parse(readFileSync(noticeRegistryPath,'utf8'));
const maxItemsPerFeed=noticeRegistry.maxItemsPerFeed??500;
const reviewedFields=['label','region','center','url','articleHosts','format','reuse','evidenceUrl','licenseEvidenceUrl','titleKeywords','includeCategoriesInTitle'];
function hasCurrentReview(item){
  if(item.feedAcceptance!=='accepted'||typeof item.feedVerifiedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(item.feedVerifiedAt))return false;
  const verified=new Date(`${item.feedVerifiedAt}T00:00:00.000Z`);
  if(!Number.isFinite(verified.getTime())||verified.toISOString().slice(0,10)!==item.feedVerifiedAt)return false;
  const now=new Date();const todayUtc=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());const age=(todayUtc-verified.getTime())/86400000;
  if(age<0||age>90)return false;
  const expected=Object.fromEntries(reviewedFields.filter(key=>Object.prototype.hasOwnProperty.call(item,key)).map(key=>[key,item[key]]));
  const actual=item.feedReview;
  if(!actual||typeof actual!=='object'||Array.isArray(actual))return false;
  const expectedKeys=Object.keys(expected).sort(),actualKeys=Object.keys(actual).sort();
  return expectedKeys.length===actualKeys.length&&expectedKeys.every((key,index)=>key===actualKeys[index]&&JSON.stringify(expected[key])===JSON.stringify(actual[key]));
}
function validNoticeSource(item){
  if(!item||typeof item.id!=='string'||!item.id||typeof item.url!=='string'||typeof item.label!=='string'||!item.label||typeof item.region!=='string'||!item.region||item.reuse!=='metadata-links-only'||!Array.isArray(item.articleHosts)||!item.articleHosts.length||item.articleHosts.some(host=>typeof host!=='string'||!host||host.includes('/')||host.includes(':'))
    ||item.maxItems!==undefined&&(!Number.isInteger(item.maxItems)||item.maxItems<1||item.maxItems>maxItemsPerFeed)
    ||item.includeCategoriesInTitle!==undefined&&typeof item.includeCategoriesInTitle!=='boolean'
    ||item.feedAcceptance==='accepted'&&!hasCurrentReview(item))return false;
  try{const url=new URL(item.url);return url.protocol==='https:'&&item.articleHosts.includes(url.hostname)&&!url.username&&!url.password&&!url.port;}catch{return false;}
}
if(noticeRegistry.schemaVersion!==1||!Number.isInteger(maxItemsPerFeed)||maxItemsPerFeed<1||maxItemsPerFeed>500||noticeRegistry.maxItemsPerFeed!==undefined&&maxItemsPerFeed>100||!Array.isArray(noticeRegistry.sources)||noticeRegistry.sources.length<1||noticeRegistry.sources.length>50||!noticeRegistry.sources.every(validNoticeSource)||new Set(noticeRegistry.sources.map(item=>item.id)).size!==noticeRegistry.sources.length)throw new Error('Pinned official notice source registry is invalid');
writeFileSync(path.join(root,'data/official-sources.json'),JSON.stringify(noticeRegistry,null,2)+'\n');
writeFileSync(path.join(root,'data/official-source-review.ts'),readFileSync(path.join(clientRoot,'shared/content/feed-review.ts'),'utf8'));
const globeTexture = exportEarthTexture(
  path.join(clientRoot, 'app/src/components/earth-texture.json'),
  path.join(root, 'public/static/earth/blue-marble-mercator-4096.webp'),
);
process.stdout.write(`Prepared the pinned NASA globe texture (${globeTexture.width}×${globeTexture.height}, ${globeTexture.bytes} bytes).\n`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd, extra = {}) {
  if(command===npm && process.platform==='win32'){if(!process.env.npm_execpath)throw new Error('NPM CLI path unavailable');args=[process.env.npm_execpath,...args];command=process.execPath;}
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...extra } });
  if (result.status !== 0) throw new Error(`Client preparation failed: ${command}`);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const catalogFiles = {
  osm: ['shared/data/catalog/osm.json', 'routes'],
  usfs: ['shared/data/catalog/usfs.json', 'routes'],
  hk: ['shared/data/catalog/hk-afcd.json', 'routes'],
  nzdoc: ['shared/data/catalog/nzdoc.json', 'routes'],
  parkscanada: ['shared/data/catalog/canada-parks.json', 'routes'],
  'scotland-argyll': ['shared/data/catalog/scotland-argyll-corepaths.json', 'routes'],
  'nsw-npws': ['shared/data/catalog/nsw-npws.json', 'routes'],
  england: ['shared/data/catalog/england-trails.json', 'routes'],
  wales: ['shared/data/catalog/wales-trails.json', 'routes'],
  'japan-tokai': ['shared/data/catalog/japan-tokai-trails.json', 'routes'],
  'ni-midulster': ['shared/data/catalog/ni-midulster-prow.json', 'routes'],
  'norfolk-prow': ['shared/data/catalog/norfolk-prow.json', 'routes'],
  'cambridgeshire-prow': ['shared/data/catalog/cambridgeshire-prow.json', 'routes'],
  'nps-public-trails': ['shared/data/catalog/nps-public-trails.json', 'routes'],
  'swisstopo-wanderwege': ['shared/data/catalog/swisstopo-wanderwege.json', 'routes'],
  'victoria-recreation-tracks': ['shared/data/catalog/victoria-recreation-tracks.json', 'routes'],
  'queensland-qpws-trails': ['shared/data/catalog/queensland-qpws-trails.json', 'routes'],
  news: ['shared/data/content/official-news.json', 'items'],
};
function verifyPinnedCatalog(sourceName, sourceFolder, manifest) {
  const source = catalogFiles[sourceName];
  if (!source) throw new Error(`Pinned ${sourceName} catalog source mapping missing`);
  const [catalogRelative, key] = source;
  const catalogBytes = readFileSync(path.join(clientRoot, catalogRelative));
  const catalog = JSON.parse(catalogBytes);
  const rows = catalog[key];
  const expectedPageCount = Math.max(1, Math.ceil(manifest.total / 400));
  if (catalog.schemaVersion !== 1 || !Array.isArray(rows) || rows.length !== manifest.total
    || manifest.key !== key || manifest.pageSize !== 400
    || manifest.pages.length !== expectedPageCount || sha256(catalogBytes) !== manifest.snapshot) {
    throw new Error(`Pinned ${sourceName} catalog and page manifest refer to different snapshots`);
  }
  if (sourceName === 'news') verifyOfficialNoticeSnapshot(catalog);
  for (let page = 0; page < expectedPageCount; page++) {
    const filename = `page-${String(page).padStart(5, '0')}.json.gz`;
    const packed = readFileSync(path.join(sourceFolder, manifest.snapshot, filename));
    if (packed.length > 2 * 1024 * 1024) throw new Error(`Pinned ${sourceName} page ${page} exceeds its download budget`);
    const payload = gunzipSync(packed, { maxOutputLength: 4 * 1024 * 1024 });
    const pageRows = JSON.parse(payload);
    const expectedRows = rows.slice(page * 400, (page + 1) * 400);
    if (sha256(payload) !== manifest.pages[page] || JSON.stringify(pageRows) !== JSON.stringify(expectedRows)) {
      throw new Error(`Pinned ${sourceName} page ${page} does not match its source snapshot`);
    }
  }
  const packedIndex = readFileSync(path.join(sourceFolder, manifest.snapshot, 'index.json.gz'));
  if (packedIndex.length > 8 * 1024 * 1024) throw new Error(`Pinned ${sourceName} search index exceeds its download budget`);
  const indexBytes = gunzipSync(packedIndex, { maxOutputLength: 32 * 1024 * 1024 });
  const index = JSON.parse(indexBytes);
  if (sha256(indexBytes) !== manifest.indexHash || !Array.isArray(index) || index.length !== manifest.total) {
    throw new Error(`Pinned ${sourceName} search index is incomplete or has a mismatched hash`);
  }
  if (sourceName !== 'news' && !index.every((entry, position) => Array.isArray(entry) && entry.length === 4
    && entry[0] === String(rows[position]?.name ?? '') && entry[1] === String(rows[position]?.region ?? '')
    && entry[2] === Math.floor(position / 400) && entry[3] === position % 400)) {
    throw new Error(`Pinned ${sourceName} search index does not match its source snapshot`);
  }
}
function verifyOfficialNoticeSnapshot(catalog) {
  const sources = noticeRegistry.sources;
  const byId = new Map(sources.map(source => [source.id, source]));
  const states = catalog.sources === undefined ? [] : catalog.sources;
  if (catalog.publicationPolicy?.scope !== 'metadata-links-only'
    || catalog.publicationPolicy?.maxPublicationAgeDays !== 90
    || typeof catalog.generatedAt !== 'string' || !Number.isFinite(Date.parse(catalog.generatedAt))
    || !Array.isArray(catalog.items) || catalog.items.length > 500
    || !Array.isArray(states) || states.length > 50
    || new Set(sources.map(source => source.id)).size !== sources.length
    || new Set(states.map(source => source?.id)).size !== states.length) {
    throw new Error('Pinned official notice policy or source list is invalid');
  }
  const safeHttps = (value, hosts) => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && hosts.includes(url.hostname)
        && !url.username && !url.password && !url.port;
    } catch { return false; }
  };
  for (const state of states) {
    const source = byId.get(state?.id);
    if (!source || state.url !== source.url || state.label !== source.label || state.region !== source.region
      || state.lastCollectedCount !== undefined && (!Number.isInteger(state.lastCollectedCount)
        || state.lastCollectedCount < 0 || state.lastCollectedCount > 500)) {
      throw new Error('Pinned official notice source state does not match its registry');
    }
  }
  const ids = new Set();
  for (const item of catalog.items) {
    const source = byId.get(item?.sourceId);
    if (!source || ids.has(item.id) || typeof item.id !== 'string' || item.id.length > 160
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300
      || item.sourceUrl !== source.url || item.sourceLabel !== source.label || item.region !== source.region
      || !safeHttps(item.url, source.articleHosts) || !safeHttps(item.sourceUrl, source.articleHosts)
      || typeof item.fetchedAt !== 'string' || !Number.isFinite(Date.parse(item.fetchedAt))
      || item.publishedAt !== null && (typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt)))
      || typeof item.publishedAt !== 'string' || Date.parse(item.publishedAt) > Date.now() + 300000
      || Date.now() - Date.parse(item.publishedAt) > 90 * 24 * 60 * 60 * 1000
      || item.center !== undefined && (!Array.isArray(item.center) || item.center.length !== 2
        || !item.center.every(Number.isFinite) || Math.abs(item.center[0]) > 180 || Math.abs(item.center[1]) > 90)
      || item.verified !== true || ['body', 'articleBody', 'image', 'imageUrl'].some(key => key in item)) {
      throw new Error('Pinned official notice contains an invalid or unapproved item');
    }
    ids.add(item.id);
  }
}
const catalogSource=path.join(clientRoot,'shared','public-catalog');
const catalogTarget=path.join(root,'public','route-catalog');
const catalogStage=`${catalogTarget}.stage-${process.pid}`;
const catalogBackup=`${catalogTarget}.backup-${process.pid}`;
const digest=/^[a-f0-9]{64}$/;
rmSync(catalogStage,{recursive:true,force:true});
if(existsSync(catalogBackup))throw new Error('A previous route catalog promotion needs recovery before packaging');
mkdirSync(catalogStage,{recursive:true});
try{
 for(const sourceName of Object.keys(catalogFiles)){
  const sourceFolder=path.join(catalogSource,sourceName),manifestPath=path.join(sourceFolder,'manifest.json');
  if(!existsSync(manifestPath))throw new Error(`Public ${sourceName} catalog manifest missing; update the pinned client source before website packaging`);
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(manifest.schemaVersion!==1||!digest.test(manifest.snapshot)||!Array.isArray(manifest.pages)||!digest.test(manifest.indexHash))throw new Error(`Public ${sourceName} catalog manifest is invalid`);
  verifyPinnedCatalog(sourceName,sourceFolder,manifest);
  mkdirSync(path.join(catalogStage,sourceName),{recursive:true});
  for(const generation of [manifest.snapshot,manifest.previousSnapshot]){
   if(!generation)continue;
   if(!digest.test(generation))throw new Error(`Public ${sourceName} prior snapshot is invalid`);
   const from=path.join(sourceFolder,generation);
   if(!existsSync(from)){if(generation===manifest.snapshot)throw new Error(`Public ${sourceName} current snapshot pages are missing`);continue;}
   const targetGeneration=path.join(catalogStage,sourceName,generation);
   cpSync(from,targetGeneration,{recursive:true});
   // Vinext treats a terminal .gz suffix only as an HTTP content-encoding variant.
   // Publish the same gzip bytes with an opaque suffix so its static cache serves them directly.
   for(const filename of readdirSync(targetGeneration))if(/^(?:page-\d{5}|index)\.json\.gz$/.test(filename))renameSync(path.join(targetGeneration,filename),path.join(targetGeneration,filename.replace(/\.json\.gz$/,'.bin')));
  }
  cpSync(manifestPath,path.join(catalogStage,sourceName,'manifest.json'));
 }
 const hadCatalog=existsSync(catalogTarget);
 if(hadCatalog)renameSync(catalogTarget,catalogBackup);
 try{renameSync(catalogStage,catalogTarget);}
 catch(error){if(hadCatalog&&!existsSync(catalogTarget))renameSync(catalogBackup,catalogTarget);throw error;}
 if(hadCatalog)rmSync(catalogBackup,{recursive:true,force:true});
}finally{rmSync(catalogStage,{recursive:true,force:true});}
const clientAppRoot = path.join(clientRoot, 'app');
if (localPreview) {
  // The local-only preview uses the already-installed, lockfile-pinned client
  // dependencies. Avoid nested npm startup here: the host's Node 26/npm 11
  // combination can fail before npm reaches the package scripts. This branch
  // is never used by CI or release builds, and it refuses to proceed if the
  // local uni CLI is missing instead of implying a clean dependency install.
  const uniCli = path.join(clientAppRoot, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js');
  if (!existsSync(uniCli)) throw new Error('Current-client preview requires the installed local uni CLI; run the supported dependency setup first');
  const result = spawnSync(process.execPath, [uniCli, 'build'], {
    cwd: clientAppRoot,
    stdio: 'inherit',
    env: { ...process.env, VITE_DESKTOP: 'false', VITE_PUBLIC_BASE: '/client-app/' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Current-client preview H5 build failed');
} else {
  run(npm, ['ci'], clientAppRoot);
  run(npm, ['run', 'build:h5'], clientAppRoot, { VITE_DESKTOP: 'false', VITE_PUBLIC_BASE: '/client-app/' });
}
const target = path.join(root, 'public', 'client-app');
rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true });
cpSync(path.join(clientRoot, 'app', 'dist', 'build', 'h5'), target, { recursive: true });
const releaseManifestPath = path.join(clientRoot, 'shared', 'releases', 'stable.json');
const {manifest: releaseManifest, available: releaseManifestAvailable} = loadReleaseManifest(releaseManifestPath);
const downloadAssets = path.join(root, 'public', 'downloads');
mkdirSync(downloadAssets, { recursive: true });
writeFileSync(path.join(downloadAssets, 'stable.json'), JSON.stringify(releaseManifest, null, 2) + '\n');
if(!releaseManifestAvailable)process.stdout.write('Pinned client source has no stable release manifest; generated an explicit ready=false website download state.\n');
const gearModel = path.join(clientRoot, 'shared', 'models', 'gear');
const modelManifest = JSON.parse(readFileSync(path.join(gearModel, 'source.json'), 'utf8'));
if (!Array.isArray(modelManifest.files) || modelManifest.files.length > 20) throw new Error('Invalid gear model manifest');
for (const asset of modelManifest.files) {
 if (!/^[a-zA-Z0-9_.-]+$/.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid gear model asset');
 const bytes = readFileSync(path.join(gearModel, asset.name));
 if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error('Gear model hash mismatch');
}
cpSync(gearModel, path.join(target, 'models', 'gear'), { recursive: true });


cpSync(path.join(clientRoot,'shared','network','gateway-relay.ts'),path.join(root,'data','gateway-relay.ts'));
cpSync(path.join(clientRoot,'shared','data','discovery-tags.ts'),path.join(root,'data','discovery-tags.ts'));
cpSync(path.join(clientRoot,'shared','weather-gear-advice.ts'),path.join(root,'data','weather-gear-advice.ts'));
const gearAdviceSource=readFileSync(path.join(clientRoot,'shared','gear-advice.ts'),'utf8')
 .replace("from './types/route'", "from './routes'");
writeFileSync(path.join(root,'data','gear-advice.ts'),gearAdviceSource);

const mapVendor=path.join(root,'public','vendor','maplibre');mkdirSync(mapVendor,{recursive:true});
for(const asset of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs'])cpSync(path.join(root,'node_modules','maplibre-gl','dist',asset),path.join(mapVendor,asset));
cpSync(path.join(root,'node_modules','maplibre-gl','LICENSE.txt'),path.join(mapVendor,'LICENSE.txt'));
