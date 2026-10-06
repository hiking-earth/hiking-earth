// Build the shared client once and bundle it as same-origin website assets.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs';
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
mkdirSync(path.join(root, 'data', 'catalog'), { recursive: true });
for (const name of ['osm.json','usfs.json','hk-afcd.json']) {
  const input=path.join(clientRoot,'shared','data','catalog',name);
  if(existsSync(input))cpSync(input,path.join(root,'data','catalog',name));
}
run(npm, ['ci'], path.join(clientRoot, 'app'));
run(npm, ['run', 'build:h5'], path.join(clientRoot, 'app'), { VITE_DESKTOP: 'false', VITE_PUBLIC_BASE: '/client-app/' });
const target = path.join(root, 'public', 'client-app');
rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true });
cpSync(path.join(clientRoot, 'app', 'dist', 'build', 'h5'), target, { recursive: true });
