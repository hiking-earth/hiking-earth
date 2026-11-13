import { PMTiles, TileType, type Source } from 'pmtiles';
import type { StyleSpecification } from 'maplibre-gl';
import { HE_PALETTE } from '@shared/design/palette';
const MAX_PACK=64*1024*1024,MAX_RANGE=8*1024*1024;
export function decodeBasemapMetadata(bytes:Uint8Array):Record<string,unknown>{
 if(bytes.byteLength>256*1024)throw new Error('地图元数据超过容量限制');
 // decodeURIComponent validates UTF-8 without requiring browser TextDecoder.
 let encoded='';for(const byte of bytes)encoded+=`%${byte.toString(16).padStart(2,'0')}`;
 let value:unknown;try{value=JSON.parse(decodeURIComponent(encoded));}catch{throw new Error('地图元数据损坏');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('地图元数据无效');return value as Record<string,unknown>;
}
export type LocalRangeReader=(offset:number,length:number)=>Promise<ArrayBuffer>;
/** Local-only archive adapter. No URL fallback and no network access. */
export async function openLocalBasemap(id:string,bytes:number,read:LocalRangeReader){
 if(!/^[a-z0-9-]{1,96}$/.test(id)||!Number.isSafeInteger(bytes)||bytes<127||bytes>MAX_PACK)throw new Error('离线地图包信息无效或超过64 MiB');
 const key=`offline-basemap-${id}`;
 const source:Source={getKey:()=>key,getBytes:async(offset,length,signal)=>{
  if(signal?.aborted)throw new Error('地图读取已取消');
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<=0||length>MAX_RANGE||offset>=bytes)throw new Error('地图读取范围无效');
  const expected=Math.min(length,bytes-offset),data=await read(offset,expected);
  if(signal?.aborted)throw new Error('地图读取已取消');
  if(!(data instanceof ArrayBuffer)||data.byteLength!==expected)throw new Error('地图包读取不完整');
  return {data};
 }};
 const archive=new PMTiles(source),header=await archive.getHeader();
 if(header.specVersion!==3||header.tileType!==TileType.Mvt||header.minZoom<0||header.maxZoom>15||header.minZoom>header.maxZoom||!Number.isFinite(header.minLon)||!Number.isFinite(header.maxLon)||!Number.isFinite(header.minLat)||!Number.isFinite(header.maxLat)||header.minLon>=header.maxLon||header.minLat>=header.maxLat||header.minLon< -180||header.maxLon>180||header.minLat< -85.05112878||header.maxLat>85.05112878)throw new Error('仅支持有效的PMTiles v3矢量底图包');
 if(!Number.isSafeInteger(header.jsonMetadataOffset)||!Number.isSafeInteger(header.jsonMetadataLength)||header.jsonMetadataOffset<127||header.jsonMetadataLength<1||header.jsonMetadataLength>256*1024||header.jsonMetadataOffset+header.jsonMetadataLength>bytes)throw new Error('地图元数据范围无效');
 const raw=await source.getBytes(header.jsonMetadataOffset,header.jsonMetadataLength);
 const decoded=await archive.decompress(raw.data,header.internalCompression);
 const metadata=decodeBasemapMetadata(decoded instanceof Uint8Array?decoded:new Uint8Array(decoded));
 archive.getMetadata=async()=>metadata;
 const layers=metadata.vector_layers;
 if(metadata.name!=='Protomaps Basemap'||typeof metadata.version!=='string'||!/^4\.\d+\.\d+$/.test(metadata.version)||!Array.isArray(layers)||layers.length>32||!layers.some(layer=>layer?.id==='roads')||!layers.some(layer=>layer?.id==='water'))throw new Error('当前视图仅支持Protomaps v4区域底图');
 return {key,archive,header};
}
/** Fully local geometry; the viewer overlays system-font labels without glyph URLs. */
export function localBasemapStyle(key:string):StyleSpecification{
 if(!/^offline-basemap-[a-z0-9-]{1,96}$/.test(key))throw new Error('离线地图标识无效');
 return {version:8,sources:{basemap:{type:'vector',url:`pmtiles://${key}`,attribution:'© OpenStreetMap contributors · Protomaps'}},layers:[
  {id:'background',type:'background',paint:{'background-color':HE_PALETTE.mapOcean}},
  {id:'earth',type:'fill',source:'basemap','source-layer':'earth',paint:{'fill-color':HE_PALETTE.mapOcean}},
  {id:'landuse',type:'fill',source:'basemap','source-layer':'landuse',paint:{'fill-color':['match',['get','kind'],'wood',HE_PALETTE.mapWood,'grass',HE_PALETTE.mapGrass,'ice',HE_PALETTE.mapIce,'sand',HE_PALETTE.mapSand,HE_PALETTE.mapLand],'fill-opacity':0.82}},
  {id:'water',type:'fill',source:'basemap','source-layer':'water',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':HE_PALETTE.mapWater}},
  {id:'water-lines',type:'line',source:'basemap','source-layer':'water',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':HE_PALETTE.mapWater,'line-width':1.2}},
  {id:'buildings',type:'fill',source:'basemap','source-layer':'buildings',minzoom:12,paint:{'fill-color':HE_PALETTE.mapBuilding,'fill-opacity':0.64}},
  {id:'roads',type:'line',source:'basemap','source-layer':'roads',paint:{'line-color':['match',['get','kind'],['motorway','trunk'],HE_PALETTE.mapRoadTrunk,['primary','secondary'],HE_PALETTE.mapRoadPrimary,['path','track'],HE_PALETTE.accent,HE_PALETTE.mapRoad],'line-width':['interpolate',['linear'],['zoom'],8,0.5,15,2.5]}},
  {id:'paths',type:'line',source:'basemap','source-layer':'roads',filter:['in',['get','kind'],['literal',['path','track']]],paint:{'line-color':HE_PALETTE.accent,'line-width':1.5}},
  {id:'boundaries',type:'line',source:'basemap','source-layer':'boundaries',paint:{'line-color':HE_PALETTE.mapBoundary,'line-width':0.8,'line-dasharray':[3,3]}},
 ]};
}
