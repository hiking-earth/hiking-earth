import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Copy the reviewed full-color Mercator image from the exact pinned client source.
 * Do not enlarge the old indexed thumbnail: it cannot recover satellite detail.
 */
export function exportEarthTexture(sourcePath, outputPath) {
  const assetPath = path.resolve(path.dirname(sourcePath), '../../../shared/design/earth/blue-marble-mercator-4096.webp');
  const asset = readFileSync(assetPath);
  const metadata = JSON.parse(readFileSync(`${assetPath}.provenance.json`, 'utf8'));
  const source = JSON.parse(readFileSync(sourcePath.replace(/earth-texture\.json$/i, 'earth-texture.provenance.json'), 'utf8'));
  const digest = createHash('sha256').update(asset).digest('hex');
  if (metadata.sha256 !== digest || metadata.bytes !== asset.length
      || metadata.width !== 4096 || metadata.height !== 4096 || metadata.projection !== 'EPSG:3857'
      || asset.subarray(0, 4).toString() !== 'RIFF' || asset.subarray(8, 12).toString() !== 'WEBP'
      || asset.length > 8 * 1024 * 1024) throw new Error('Reviewed high-resolution NASA image is incomplete or invalid');
  for (const key of ['source', 'sourcePage', 'credit', 'description']) {
    if (metadata[key] !== source[key]) throw new Error(`NASA image provenance mismatch: ${key}`);
  }
  const provenance = { ...metadata, generatedAsset: path.basename(outputPath),
    generatedAssetSha256: digest, generatedAssetBytes: asset.length,
    generatedAssetDimensions: `${metadata.width}x${metadata.height}` };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, asset);
  writeFileSync(`${outputPath}.provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
  return { width: metadata.width, height: metadata.height, bytes: asset.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) throw new Error('Usage: node export-earth-texture.mjs <pinned-earth-texture.json> <output.webp>');
  const result = exportEarthTexture(sourcePath, outputPath);
  process.stdout.write(`Generated ${result.width}x${result.height} full-color Mercator image (${result.bytes} bytes).\n`);
}
