// Match the catalog-feed service contract; merged caches contain three sources plus seed routes.
export const CATALOG_PAGE_SIZE = 400;
export const CATALOG_SOURCE_LIMIT = 250000;
export const CATALOG_CACHE_LIMIT = CATALOG_SOURCE_LIMIT * 3 + 1000;
