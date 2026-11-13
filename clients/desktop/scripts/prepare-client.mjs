import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const npmCli=process.env.npm_execpath;
if(process.platform==='win32' && (!npmCli||!existsSync(npmCli)))throw new Error('NPM CLI path unavailable; run through npm run tauri');
const command=npmCli?process.execPath:'npm';
const args=npmCli?[npmCli,'run','build:h5']:['run','build:h5'];
const result = spawnSync(command, args, {
  cwd: path.join(root, 'app'), stdio: 'inherit', env: { ...process.env, VITE_DESKTOP: 'true' },
});
if(result.error)console.error('Client build process failed:',result.error.message);
if (result.status !== 0) process.exit(result.status || 1);
const target = path.join(root, 'desktop', 'client-dist');
rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true });
cpSync(path.join(root, 'app', 'dist', 'build', 'h5'), target, { recursive: true });
