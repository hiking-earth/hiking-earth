/** Optional regional DEM contract. No network requests or downloads on import. */
export const TERRAIN_PACK_MAX_BYTES = 32 * 1024 * 1024;
export const TERRAIN_PACK_MAX_TILES = 256;
export interface TerrainTileRecord { z: number; x: number; y: number; path: string; bytes: number; sha256: string }
export interface TerrainPackManifest {
  schemaVersion: 1; kind: 'hiking-terrain-terrarium'; encoding: 'terrarium';
  id: string; bounds: [number, number, number, number]; zoom: number;
  source: string; attribution: string; licenseUrl: string; navigationSuitable: false;
  tiles: TerrainTileRecord[];
}
export function terrariumHeight(red: number, green: number, blue: number): number {
  if (![red, green, blue].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('地形像素无效');
  return red * 256 + green + blue / 256 - 32768;
}
export function validateTerrainManifest(value: unknown): TerrainPackManifest {
  const r = value as TerrainPackManifest;
  if (!r || r.schemaVersion !== 1 || r.kind !== 'hiking-terrain-terrarium' || r.encoding !== 'terrarium'
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(r.id) || r.navigationSuitable !== false
    || r.source !== 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/'
    || r.licenseUrl !== 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'
    || typeof r.attribution !== 'string' || r.attribution.length < 100 || r.attribution.length > 8000
    || !Number.isInteger(r.zoom) || r.zoom < 0 || r.zoom > 14
    || !Array.isArray(r.bounds) || r.bounds.length !== 4 || !r.bounds.every(Number.isFinite)
    || !(r.bounds[0] >= -180 && r.bounds[0] < r.bounds[2] && r.bounds[2] <= 180
      && r.bounds[1] >= -85.05112878 && r.bounds[1] < r.bounds[3] && r.bounds[3] <= 85.05112878)
    || !Array.isArray(r.tiles) || !r.tiles.length || r.tiles.length > TERRAIN_PACK_MAX_TILES) throw new Error('地形包清单无效');
  let bytes = 0; const seen = new Set<string>();
  for (const tile of r.tiles) {
    if (!tile || tile.z !== r.zoom || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)
      || tile.x < 0 || tile.y < 0 || tile.x >= 2 ** r.zoom || tile.y >= 2 ** r.zoom
      || tile.path !== `tiles/${tile.z}/${tile.x}/${tile.y}.png` || seen.has(tile.path)
      || !Number.isSafeInteger(tile.bytes) || tile.bytes < 33 || tile.bytes > 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(tile.sha256)) throw new Error('地形瓦片记录无效');
    seen.add(tile.path); bytes += tile.bytes;
  }
  if (bytes > TERRAIN_PACK_MAX_BYTES) throw new Error('地形包超过32 MiB，请缩小区域');
  const n = 2 ** r.zoom;
  const x = (lon: number) => Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
  const y = (lat: number) => Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)));
  // Bounds may touch an adjacent tile edge; permit that edge tile, never outside the rectangle.
  const left=x(r.bounds[0]),right=x(r.bounds[2]),top=y(r.bounds[3]),bottom=y(r.bounds[1]);
  for (const tile of r.tiles) if(tile.x<left||tile.x>right||tile.y<top||tile.y>bottom) throw new Error('地形瓦片超出声明区域');
  return r;
}
