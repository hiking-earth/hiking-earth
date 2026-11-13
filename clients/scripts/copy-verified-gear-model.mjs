import {createHash} from 'node:crypto';
import {cpSync, lstatSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';

const MODEL_FILES = /^(model\.json|group1-shard[1-5]of5)$/;
const EXPECTED_MODEL_FILES = ['model.json', ...Array.from({length: 5}, (_, i) => `group1-shard${i + 1}of5`)];

/** Copy the small, locally hosted COCO-SSD model only after checking its pinned file records. */
export function copyVerifiedGearModel(source, output) {
  const manifest = JSON.parse(readFileSync(path.join(source, 'source.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length !== EXPECTED_MODEL_FILES.length) {
    throw new Error('Invalid local gear model manifest');
  }
  const names = manifest.files.map(record => record?.name);
  if (new Set(names).size !== EXPECTED_MODEL_FILES.length
      || EXPECTED_MODEL_FILES.some(name => !names.includes(name))) {
    throw new Error('Invalid local gear model file set');
  }

  const target = path.join(output, 'models', 'gear');
  rmSync(target, {recursive: true, force: true});
  mkdirSync(target, {recursive: true});
  for (const record of manifest.files) {
    if (!record || !MODEL_FILES.test(record.name)
        || !Number.isSafeInteger(record.bytes) || record.bytes <= 0
        || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      throw new Error('Invalid local gear model file record');
    }
    const input = path.join(source, record.name);
    const stat = lstatSync(input);
    if (!stat.isFile() || stat.size !== record.bytes
        || createHash('sha256').update(readFileSync(input)).digest('hex') !== record.sha256) {
      throw new Error(`Local gear model integrity check failed: ${record.name}`);
    }
    cpSync(input, path.join(target, record.name));
  }
  for (const name of ['source.json', 'LICENSE', 'NOTICE']) {
    cpSync(path.join(source, name), path.join(target, name));
  }
  return target;
}
