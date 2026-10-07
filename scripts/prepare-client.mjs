// Build the shared client once and bundle it as same-origin website assets.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(readFileSync(path.join(root, 'clients.source.json'), 'utf8'));
let clientRoot = process.env.HIKING_CLIENT_ROOT || path.resolve(root, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd, extra = {}) {
  if(command===npm && process.platform==='win32'){if(!process.env.npm_execpath)throw new Error('NPM CLI path unavailable');args=[process.env.npm_execpath,...args];command=process.execPath;}
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...extra } });
  if (result.status !== 0) throw new Error(`Client preparation failed: ${command}`);
}
if (!existsSync(path.join(clientRoot, 'app', 'package.json'))) {
  clientRoot = path.join(root, '.client-source'); mkdirSync(clientRoot, { recursive: true });
  if (!existsSync(path.join(clientRoot, '.git'))) run('git', ['init'], clientRoot);
  run('git', ['fetch', '--depth', '1', source.repository, source.ref], clientRoot);
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], clientRoot);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const catalogFiles = {
  osm: ['shared/data/catalog/osm.json', 'routes'],
  usfs: ['shared/data/catalog/usfs.json', 'routes'],
  hk: ['shared/data/catalog/hk-afcd.json', 'routes'],
  news: ['shared/data/content/official-news.json', 'items'],
};
function verifyPinnedCatalog(sourceName, sourceFolder, manifest) {
  const [catalogRelative, key] = catalogFiles[sourceName];
  const catalogBytes = readFileSync(path.join(clientRoot, catalogRelative));
  const catalog = JSON.parse(catalogBytes);
  const rows = catalog[key];
  const expectedPageCount = Math.max(1, Math.ceil(manifest.total / 400));
  if (catalog.schemaVersion !== 1 || !Array.isArray(rows) || rows.length !== manifest.total
    || manifest.key !== key || manifest.pageSize !== 400
    || manifest.pages.length !== expectedPageCount || sha256(catalogBytes) !== manifest.snapshot) {
    throw new Error(`Pinned ${sourceName} catalog and page manifest refer to different snapshots`);
  }
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
mkdirSync(path.join(root, 'data', 'catalog'), { recursive: true });
for (const name of ['osm.json','usfs.json','hk-afcd.json']) {
  const input=path.join(clientRoot,'shared','data','catalog',name);
  if(existsSync(input))cpSync(input,path.join(root,'data','catalog',name));
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
 for(const sourceName of ['osm','usfs','hk','news']){
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
   cpSync(from,path.join(catalogStage,sourceName,generation),{recursive:true});
  }
  cpSync(manifestPath,path.join(catalogStage,sourceName,'manifest.json'));
 }
 const hadCatalog=existsSync(catalogTarget);
 if(hadCatalog)renameSync(catalogTarget,catalogBackup);
 try{renameSync(catalogStage,catalogTarget);}
 catch(error){if(hadCatalog&&!existsSync(catalogTarget))renameSync(catalogBackup,catalogTarget);throw error;}
 if(hadCatalog)rmSync(catalogBackup,{recursive:true,force:true});
}finally{rmSync(catalogStage,{recursive:true,force:true});}
run(npm, ['ci'], path.join(clientRoot, 'app'));
run(npm, ['run', 'build:h5'], path.join(clientRoot, 'app'), { VITE_DESKTOP: 'false', VITE_PUBLIC_BASE: '/client-app/' });
const target = path.join(root, 'public', 'client-app');
rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true });
cpSync(path.join(clientRoot, 'app', 'dist', 'build', 'h5'), target, { recursive: true });
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

const mapVendor=path.join(root,'public','vendor','maplibre');mkdirSync(mapVendor,{recursive:true});
for(const asset of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs'])cpSync(path.join(root,'node_modules','maplibre-gl','dist',asset),path.join(mapVendor,asset));
cpSync(path.join(root,'node_modules','maplibre-gl','LICENSE.txt'),path.join(mapVendor,'LICENSE.txt'));
