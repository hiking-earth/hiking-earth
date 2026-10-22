import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadReleaseManifest, UNPUBLISHED_RELEASE_MANIFEST } from '../scripts/release-manifest.mjs';

function withTempDirectory(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'hiking-release-manifest-'));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('missing stable manifest yields only an explicitly unpublished website state', () => {
  withTempDirectory((directory) => {
    const result = loadReleaseManifest(path.join(directory, 'missing.json'));
    assert.equal(result.available, false);
    assert.deepEqual(result.manifest, UNPUBLISHED_RELEASE_MANIFEST);
    assert.equal(result.manifest.ready, false);
    assert.equal(result.manifest.android, null);
    assert.equal(result.manifest.desktop, null);
  });
});

test('valid stable manifest is copied without rewriting its release gate', () => {
  withTempDirectory((directory) => {
    const manifest = { ...UNPUBLISHED_RELEASE_MANIFEST, version: '0.2.1', versionCode: 21 };
    const file = path.join(directory, 'stable.json');
    writeFileSync(file, JSON.stringify(manifest));
    const result = loadReleaseManifest(file);
    assert.equal(result.available, true);
    assert.deepEqual(result.manifest, manifest);
    assert.equal(result.manifest.ready, false);
  });
});

test('malformed stable manifest fails closed', () => {
  withTempDirectory((directory) => {
    const file = path.join(directory, 'stable.json');
    writeFileSync(file, JSON.stringify({ ...UNPUBLISHED_RELEASE_MANIFEST, ready: 'true' }));
    assert.throws(() => loadReleaseManifest(file), /refusing to publish download metadata/);
  });
});

test('website download center lists the mobile and desktop clients without advertising unsigned iOS packages', () => {
  const center = readFileSync(new URL('../components/DownloadCenter.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/download/page.tsx', import.meta.url), 'utf8');
  for (const platform of ['WEB · PWA', 'IOS · IPADOS', 'ANDROID', 'Windows', 'macOS Apple 芯片', 'macOS Intel', 'Linux', 'WECHAT MINI PROGRAM', 'H5 CLIENT']) {
    assert.ok(center.includes(platform) || page.includes(platform), `download platform missing: ${platform}`);
  }
  assert.match(center, /打开网页并安装/);
  assert.match(center, /Safari 打开后，点“分享”→“添加到主屏幕”/);
  assert.match(center, /暂不提供原生 IPA/);
  assert.match(center, /const readyManifest = release\?\.ready === true \? release : null/);
  assert.match(center, /const desktopManifest = readyManifest && readyManifest\.desktop\?\.version === readyManifest\.version/);
  assert.equal((center.match(/<a className="download-action" href="\/">/g) || []).length, 2);
  assert.match(readFileSync(new URL('../components/DocumentShell.tsx', import.meta.url), 'utf8'), /<a href="\/">← 返回徒步地球<\/a>/);
  assert.match(center, /正式版本准备中/);
});
