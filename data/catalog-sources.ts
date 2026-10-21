/** Public route sources supported by the shared catalog and search APIs. */
export const PUBLIC_ROUTE_SOURCES = [
  'osm',
  'usfs',
  'hk',
  'nzdoc',
  'parkscanada',
  'nsw-npws',
  'england',
  'wales',
  'japan-tokai',
  'scotland-argyll',
  'ni-midulster',
  'norfolk-prow',
  'cambridgeshire-prow',
  'nps-public-trails',
  'usgs-trails',
  'swisstopo-wanderwege',
  'victoria-recreation-tracks',
  'queensland-qpws-trails',
  'taiwan-trails',
  'korea-durunubi-trails',
] as const;

export type PublicRouteSource = typeof PUBLIC_ROUTE_SOURCES[number];

export const CATALOG_FEED_SOURCES = [...PUBLIC_ROUTE_SOURCES, 'news'] as const;

export function isPublicRouteSource(value: string | null): value is PublicRouteSource {
  return value !== null && (PUBLIC_ROUTE_SOURCES as readonly string[]).includes(value);
}

export function isCatalogFeedSource(value: string | null): value is typeof CATALOG_FEED_SOURCES[number] {
  return value !== null && (CATALOG_FEED_SOURCES as readonly string[]).includes(value);
}
