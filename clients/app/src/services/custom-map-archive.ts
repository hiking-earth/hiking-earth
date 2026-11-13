import { sha256 } from '@noble/hashes/sha256';
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8 } from 'fflate';
import { OFFLINE_MAP_STORAGE_BUDGET_BYTES } from './offline-map-limits';

export const CUSTOM_MAP_ARCHIVE_LIMIT = OFFLINE_MAP_STORAGE_BUDGET_BYTES;
const MAP_LIMIT = 64 * 1024 * 1024;
const FILE_LIMIT = 34;
const JSON_LIMIT = 256 * 1024;

export interface CustomMapArchiveExpectation { bytes: number; sha256: string }
export interface CustomMapArchiveEntry {
  name: string;
  label: string;
  bytes: number;
  sha256: string;
  attribution: string;
  license: string;
  data: Uint8Array;
}
export interface CustomMapArchiveReader {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function shaHex(value: Uint8Array): string {
  return Array.from(sha256(value), (byte: number) => byte.toString(16).padStart(2, '0')).join('');
}
function jsonFile(files: Map<string, Uint8Array>, name: string): unknown {
  const bytes = files.get(name);
  if (!bytes || bytes.byteLength > JSON_LIMIT) throw new Error('地图压缩包清单缺失或过大');
  let parsed: unknown;
  try { parsed = JSON.parse(strFromU8(bytes)); } catch { throw new Error('地图压缩包清单无法读取'); }
  return parsed;
}

/** Streams ZIP input, bounds expanded output, and verifies both delivery and per-map digests. */
export async function readCustomMapArchive(
  source: CustomMapArchiveReader,
  expected: CustomMapArchiveExpectation,
  onProgress?: (bytes: number) => void,
): Promise<CustomMapArchiveEntry[]> {
  if (!Number.isSafeInteger(source.size) || source.size < 22 || source.size > CUSTOM_MAP_ARCHIVE_LIMIT
      || !Number.isSafeInteger(expected?.bytes) || expected.bytes !== source.size
      || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    throw new Error('地图压缩包大小或校验信息无效，最多支持192 MiB');
  }

  const compressedHash = sha256.create();
  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let expandedMapsBytes = 0;
  let expandedBytes = 0;
  let fileCount = 0;
  let failure: Error | undefined;
  const unzip = new Unzip(file => {
    try {
      if (failure) return;
      fileCount += 1;
      if (fileCount > FILE_LIMIT || !file.name || file.name.includes('/') || file.name.includes('\\')
          || file.name === '.' || file.name === '..' || seen.has(file.name)
          || ![0, 8].includes(file.compression)) throw new Error('地图压缩包包含不受支持的文件');
      seen.add(file.name);
      const isJson = file.name === 'catalog.json' || file.name === 'source-inventory.json';
      const isMap = /^[a-z0-9-]{1,80}\.pmtiles$/.test(file.name);
      const originalSize = file.originalSize;
      const compressedSize = file.size;
      if ((!isJson && !isMap) || typeof originalSize !== 'number' || !Number.isSafeInteger(originalSize) || originalSize < 1
          || typeof compressedSize !== 'number' || !Number.isSafeInteger(compressedSize) || compressedSize < 0) throw new Error('地图压缩包文件清单无效');
      if (isJson && originalSize > JSON_LIMIT) throw new Error('地图清单超过256 KiB');
      if (isMap && originalSize > MAP_LIMIT) throw new Error('单张地图超过64 MiB');
      if (originalSize > Math.max(1_048_576, compressedSize) * 200) throw new Error('地图压缩比异常，拒绝解压');
      if (isMap) {
        expandedMapsBytes += originalSize;
        if (expandedMapsBytes > CUSTOM_MAP_ARCHIVE_LIMIT) throw new Error('地图总量超过192 MiB设备容量上限');
      }
      expandedBytes += originalSize;
      if (expandedBytes > CUSTOM_MAP_ARCHIVE_LIMIT + JSON_LIMIT * 2) throw new Error('地图压缩包解压总量超出上限');

      // Allocate only the declared, already-bounded entry size. Retaining every
      // inflate chunk and then concatenating it briefly doubled memory for a
      // single map file (up to 64 MiB) during import.
      const output = new Uint8Array(originalSize);
      let received = 0;
      file.ondata = (error, chunk, final) => {
        try {
          if (error) throw new Error('地图压缩包解压失败');
          if (chunk) {
            received += chunk.byteLength;
            if (received > originalSize) throw new Error('地图压缩包条目超出声明大小');
            output.set(chunk, received - chunk.byteLength);
          }
          if (!final) return;
          if (received !== originalSize) throw new Error('地图压缩包条目不完整');
          files.set(file.name, output);
        } catch (error) { failure = error instanceof Error ? error : new Error('地图压缩包解压失败'); }
      };
      file.start();
    } catch (error) { failure = error instanceof Error ? error : new Error('地图压缩包无效'); }
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);

  for (let offset = 0; offset < source.size; offset += 1024 * 1024) {
    if (failure) throw failure;
    const length = Math.min(1024 * 1024, source.size - offset);
    const chunk = await source.read(offset, length);
    if (!(chunk instanceof Uint8Array) || chunk.byteLength !== length) throw new Error('地图压缩包读取不完整');
    compressedHash.update(chunk);
    try { unzip.push(chunk, offset + length === source.size); }
    catch (error) { throw error instanceof Error ? error : new Error('地图压缩包结构无效'); }
    if (failure) throw failure;
    onProgress?.(offset + length);
  }
  if (shaHex(compressedHash.digest()) !== expected.sha256) throw new Error('地图压缩包SHA-256校验失败');

  const inventoryValue = jsonFile(files, 'source-inventory.json');
  const catalogValue = jsonFile(files, 'catalog.json');
  if (!isRecord(inventoryValue) || !Array.isArray(catalogValue)) throw new Error('地图压缩包清单格式无效');
  const inventory = inventoryValue;
  const rows = catalogValue;
  const provenance = inventory.maps;
  // catalog.json intentionally uses the existing client catalog's bare-array format.
  if (inventory.schemaVersion !== 1
      || inventory.accessVerified !== false || inventory.terrainIncluded !== false
      || !Array.isArray(rows) || !Array.isArray(provenance) || rows.length < 1 || rows.length > 32
      || provenance.length !== rows.length || inventory.bytes !== expandedMapsBytes) throw new Error('地图压缩包目录与来源记录不匹配');
  const byFile = new Map<string, Record<string, any>>();
  for (const record of provenance) {
    if (!isRecord(record) || typeof record.file !== 'string' || byFile.has(record.file)
        || record.license !== 'ODbL-1.0 Produced Work' || typeof record.attribution !== 'string'
        || !record.attribution.trim() || typeof record.sourcePolicy !== 'string') {
      throw new Error('地图来源或许可记录无效');
    }
    byFile.set(record.file, record);
  }
  const result: CustomMapArchiveEntry[] = [];
  const expectedNames = new Set(['catalog.json', 'source-inventory.json']);
  for (const row of rows) {
    if (!isRecord(row) || typeof row.name !== 'string' || !/^[a-z0-9-]{1,80}\.pmtiles$/.test(row.name)
        || expectedNames.has(row.name) || row.url !== `static/offline-maps/${row.name}`
        || !Number.isSafeInteger(row.bytes) || row.bytes < 127 || row.bytes > MAP_LIMIT
        || !/^[a-f0-9]{64}$/.test(row.sha256) || typeof row.label !== 'string' || !row.label.trim()
        || row.license !== 'ODbL-1.0 Produced Work' || typeof row.attribution !== 'string' || !row.attribution.trim()) {
      throw new Error('地图目录条目无效');
    }
    expectedNames.add(row.name);
    const bytes = files.get(row.name), record = byFile.get(row.name);
    if (!bytes || bytes.byteLength !== row.bytes || shaHex(bytes) !== row.sha256 || !record
        || record.bytes !== row.bytes || record.sha256 !== row.sha256
        || record.license !== row.license || record.attribution !== row.attribution
        || record.name !== row.label || JSON.stringify(record.bounds) !== JSON.stringify(row.bounds)) {
      throw new Error('地图文件或来源清单校验失败');
    }
    result.push({name: row.name, label: row.label, bytes: row.bytes, sha256: row.sha256,
      attribution: row.attribution, license: row.license, data: bytes});
  }
  if (expectedNames.size !== files.size || [...files.keys()].some(name => !expectedNames.has(name))) {
    throw new Error('地图压缩包包含未列入清单的文件');
  }
  return result;
}
