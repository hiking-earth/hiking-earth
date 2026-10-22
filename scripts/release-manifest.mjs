import { existsSync, readFileSync } from 'node:fs';

export const UNPUBLISHED_RELEASE_MANIFEST = Object.freeze({
  schemaVersion: 1,
  channel: 'stable',
  version: '0.0.0',
  versionCode: 0,
  publishedAt: null,
  notes: '正式客户端版本尚未发布',
  ready: false,
  android: null,
  ios: null,
  web: null,
  desktop: null,
});

export function loadReleaseManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return { manifest: { ...UNPUBLISHED_RELEASE_MANIFEST }, available: false };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== 1 || manifest.channel !== 'stable'
    || typeof manifest.ready !== 'boolean'
    || typeof manifest.version !== 'string'
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)
    || !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 0
    || !(manifest.publishedAt === null
      || (typeof manifest.publishedAt === 'string' && Number.isFinite(Date.parse(manifest.publishedAt))))) {
    throw new Error('Pinned stable release manifest is invalid; refusing to publish download metadata');
  }
  return { manifest, available: true };
}
