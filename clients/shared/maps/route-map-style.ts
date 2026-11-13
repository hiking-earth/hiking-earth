import type { StyleSpecification } from 'maplibre-gl';
import { HE_PALETTE } from '../design/palette';

/** Shared online route-map presentation for web, desktop and H5 clients. */
export function createHikingRouteMapStyle(): StyleSpecification {
  const name = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name:en'], ['get', 'name']];
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '地图 © OpenFreeMap / OpenMapTiles；数据 © OpenStreetMap 贡献者',
      },
    },
    layers: [
      { id: 'route-map-ocean', type: 'background', paint: { 'background-color': HE_PALETTE.mapOcean } },
      { id: 'route-map-land', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', paint: { 'fill-color': ['match', ['get', 'class'], 'wood', HE_PALETTE.mapWood, 'grass', HE_PALETTE.mapGrass, 'ice', HE_PALETTE.mapIce, 'sand', HE_PALETTE.mapSand, HE_PALETTE.mapLand], 'fill-opacity': 0.88 } },
      { id: 'route-map-water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': HE_PALETTE.mapWater } },
      { id: 'route-map-waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', minzoom: 7, paint: { 'line-color': HE_PALETTE.mapWater, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 14, 2.4], 'line-opacity': 0.9 } },
      { id: 'route-map-boundaries', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', minzoom: 2, filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': HE_PALETTE.mapBoundary, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 9, 1], 'line-dasharray': [3, 2], 'line-opacity': 0.68 } },
      { id: 'route-map-road-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 7, filter: ['!in', ['get', 'class'], ['literal', ['rail', 'ferry']]], paint: { 'line-color': 'rgba(5,15,17,.58)', 'line-width': ['interpolate', ['exponential', 1.35], ['zoom'], 7, 1, 13, 4, 17, 13] } },
      { id: 'route-map-roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 7, filter: ['!in', ['get', 'class'], ['literal', ['rail', 'ferry']]], paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], HE_PALETTE.mapRoadTrunk, ['primary', 'secondary'], HE_PALETTE.mapRoadPrimary, ['path', 'track'], HE_PALETTE.accent, HE_PALETTE.mapRoad], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.52, 11, 0.82, 15, 0.94], 'line-width': ['interpolate', ['exponential', 1.35], ['zoom'], 7, 0.45, 13, 2.2, 17, 8] } },
      { id: 'route-map-trails', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': HE_PALETTE.accent, 'line-opacity': 0.96, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 3.5] } },
      { id: 'route-map-places', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 3, layout: { 'text-field': name as never, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 9, 13, 14, 15], 'text-allow-overlap': false, 'text-padding': 4 }, paint: { 'text-color': HE_PALETTE.mapLabel, 'text-halo-color': 'rgba(4,12,15,.9)', 'text-halo-width': 1.5 } },
      { id: 'route-map-peaks', type: 'symbol', source: 'openmaptiles', 'source-layer': 'mountain_peak', minzoom: 8, layout: { 'text-field': ['concat', '▲ ', name as never, ['case', ['has', 'ele'], ['concat', ' · ', ['to-string', ['get', 'ele']], ' m'], '']], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0.75], 'text-allow-overlap': false }, paint: { 'text-color': '#f2f5e8', 'text-halo-color': 'rgba(4,12,15,.92)', 'text-halo-width': 1.4 } },
    ],
  };
}
