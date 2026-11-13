const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APPID_PATTERN = /^wx[0-9a-fA-F]{16}$/;

function readExpectedAppId() {
  const manifestPath = path.join(ROOT, 'app/src/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const appid = manifest?.['mp-weixin']?.appid;
  if (typeof appid !== 'string' || !APPID_PATTERN.test(appid)) {
    throw new Error('Source manifest must contain a valid WeChat Mini Program AppID.');
  }
  return appid;
}

function verifyProjectAppId(expectedAppId, projectConfig) {
  if (typeof expectedAppId !== 'string' || !APPID_PATTERN.test(expectedAppId)) {
    throw new Error('Expected AppID is invalid.');
  }
  if (!projectConfig || typeof projectConfig !== 'object'
      || projectConfig.appid !== expectedAppId) {
    throw new Error('Generated Mini Program project.config.json AppID does not match the source manifest.');
  }
  return true;
}

function main() {
  const buildRoot = path.resolve(process.argv[2] || 'app/dist/build/mp-weixin');
  const configPath = path.join(buildRoot, 'project.config.json');
  if (!fs.existsSync(configPath)) throw new Error(`Mini Program project config is missing: ${configPath}`);
  const projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  verifyProjectAppId(readExpectedAppId(), projectConfig);
  process.stdout.write('Generated WeChat Mini Program AppID matches the source manifest.\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { APPID_PATTERN, readExpectedAppId, verifyProjectAppId };
