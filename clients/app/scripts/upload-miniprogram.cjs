#!/usr/bin/env node
// Upload a built mini-program version to the WeChat developer console.
// The owner-provided upload key must stay outside this repository.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {inspectBudget} = require('./miniprogram-budget.cjs');

const appRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(appRoot, '..');
const buildRoot = path.join(appRoot, 'dist/build/mp-weixin');
const appid = 'wx73248e013d48b534';
const version = process.env.MINIPROGRAM_VERSION;
const keyPath = process.env.MINIPROGRAM_UPLOAD_KEY;
const description = process.env.MINIPROGRAM_DESCRIPTION || '徒步地球功能更新';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  fail('Set MINIPROGRAM_VERSION to a semantic version, e.g. 0.2.0.');
} else if (!keyPath || !path.isAbsolute(keyPath) || !fs.existsSync(keyPath)) {
  fail('Set MINIPROGRAM_UPLOAD_KEY to the absolute path of the owner-downloaded private key outside the repository.');
} else if (fs.lstatSync(keyPath).isSymbolicLink() || fs.realpathSync(keyPath).startsWith(`${repositoryRoot}${path.sep}`)) {
  fail('Keep the mini-program upload key as a regular file outside this repository.');
} else if ((fs.statSync(keyPath).mode & 0o077) !== 0) {
  fail('Restrict the mini-program upload key to owner-only access (chmod 600).');
} else if (!/^[\p{L}\p{N} .,，。·:：()（）+-]{1,100}$/u.test(description)) {
  fail('MINIPROGRAM_DESCRIPTION may contain up to 100 plain text characters.');
} else if (!fs.existsSync(path.join(buildRoot, 'project.config.json')) || !fs.existsSync(path.join(buildRoot, 'app.json'))) {
  fail('Mini-program build is missing. Build app/dist/build/mp-weixin before upload.');
} else {
  const config = JSON.parse(fs.readFileSync(path.join(buildRoot, 'project.config.json'), 'utf8'));
  if (config.appid !== appid) {
    fail(`Build AppID mismatch; expected ${appid}.`);
  } else if (!inspectBudget(buildRoot).passed) {
    fail('Mini-program package exceeds the conservative 2MB limit; optimize or split it before upload.');
  } else {
    // Pinned official CLI is downloaded by npx when this owner-only step runs.
    // This avoids shipping another large dependency in the application bundle.
    const args = [
      '--yes', 'miniprogram-ci@2.1.31', 'upload',
      '--pp', buildRoot,
      '--pkp', keyPath,
      '--appid', appid,
      '--uv', version,
      '--desc', description.slice(0, 100),
      '-r', '1',
      '--use-project-config', 'true',
    ];
    const result = spawnSync('npx', args, { cwd: appRoot, stdio: 'inherit' });
    if (result.error) fail(`Could not start npx: ${result.error.message}`);
    else if (result.status !== 0) fail(`Mini-program upload failed with exit code ${result.status ?? 'unknown'}.`);
    else console.log(`Uploaded WeChat mini-program candidate ${version}. Review and submit it in the WeChat console.`);
  }
}
