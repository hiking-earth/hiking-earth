import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const MAX_MERCATOR_LATITUDE = 85.05112878;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, 'ascii');
  const checksumInput = Buffer.concat([typeBytes, payload]);
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(checksumInput), 8 + payload.length);
  return chunk;
}

export function exportEarthTexture(sourcePath, outputPath) {
  const texture = JSON.parse(readFileSync(sourcePath, 'utf8'));
  if (!Number.isSafeInteger(texture.width) || !Number.isSafeInteger(texture.height)
      || texture.width < 2 || texture.height < 2 || !Array.isArray(texture.palette)
      || texture.palette.length !== 768 || texture.palette.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('Pinned NASA earth texture dimensions or RGB palette are invalid');
  }
  const indices = Buffer.from(texture.indices, 'base64');
  if (indices.length !== texture.width * texture.height) throw new Error('Pinned NASA earth texture index map is incomplete');

  const cropRows = Math.round((90 - MAX_MERCATOR_LATITUDE) / 180 * texture.height);
  const width = texture.width;
  const height = texture.height - cropRows * 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    scanlines[rowOffset] = 0;
    const sourceRowOffset = (y + cropRows) * width;
    for (let x = 0; x < width; x++) {
      const colorOffset = indices[sourceRowOffset + x] * 3;
      const targetOffset = rowOffset + 1 + x * 3;
      scanlines[targetOffset] = texture.palette[colorOffset];
      scanlines[targetOffset + 1] = texture.palette[colorOffset + 1];
      scanlines[targetOffset + 2] = texture.palette[colorOffset + 2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  if (png.length > 8 * 1024 * 1024) throw new Error('Generated NASA globe texture exceeds the PWA single-file cache budget');
  const provenancePath = sourcePath.replace(/earth-texture\.json$/i, 'earth-texture.provenance.json');
  const sourceProvenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (sourceProvenance.credit !== 'NASA Earth Observatory'
      || !/^https:\/\/science\.nasa\.gov\//.test(sourceProvenance.sourcePage)
      || !/^https:\/\//.test(sourceProvenance.source)
      || !/historical|not live/i.test(sourceProvenance.description)) {
    throw new Error('Pinned NASA earth texture attribution metadata is missing or invalid');
  }
  const provenance = {
    source: sourceProvenance.source,
    sourcePage: sourceProvenance.sourcePage,
    credit: sourceProvenance.credit,
    description: sourceProvenance.description,
    generatedAsset: path.basename(outputPath),
    generatedAssetSha256: createHash('sha256').update(png).digest('hex'),
    generatedAssetBytes: png.length,
    generatedAssetDimensions: `${width}x${height}`,
    polarRowsCropped: cropRows,
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, png);
  writeFileSync(`${outputPath}.provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
  return { width, height, bytes: png.length, cropRows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) throw new Error('Usage: node export-earth-texture.mjs <pinned-earth-texture.json> <output.png>');
  const result = exportEarthTexture(sourcePath, outputPath);
  process.stdout.write(`Generated ${result.width}x${result.height} globe image (${result.bytes} bytes; ${result.cropRows} polar rows cropped).\n`);
}
