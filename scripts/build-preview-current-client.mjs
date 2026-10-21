import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if(process.env.CI==='true'||process.env.GITHUB_ACTIONS==='true'){
  process.stderr.write('Current-client preview builds are disabled in CI and GitHub Actions.\n');
  process.exit(1);
}

const root=fileURLToPath(new URL('../',import.meta.url));
const clientRoot=process.env.HIKING_CLIENT_PREVIEW_ROOT||path.resolve(root,'..');
const run=(script,args,env={})=>{
  const result=spawnSync(process.execPath,[script,...args],{
    cwd:root,
    stdio:'inherit',
    env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/wrangler.log',HIKING_CLIENT_PREVIEW:'1',HIKING_CLIENT_PREVIEW_ROOT:clientRoot,...env},
  });
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
};
const prepareScript=path.join(root,'scripts/prepare-client.mjs');
const buildScript=path.join(root,'node_modules/vinext/dist/cli.js');
const stampScript=path.join(root,'scripts/stamp-service-worker.mjs');
for(const script of [prepareScript,buildScript,stampScript])if(!existsSync(script))throw new Error(`Current-client preview prerequisite is missing: ${path.relative(root,script)}`);
run(prepareScript,[]);
run(buildScript,['build']);
run(stampScript,[]);
