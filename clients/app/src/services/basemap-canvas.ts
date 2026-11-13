import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
export type MapShape={layer:string;type:2|3;paths:{x:number;y:number}[][];kind:string};
const LAYERS=['earth','landuse','water','buildings','roads','boundaries'];
/** Coordinates remain in tile units; no browser, network or font dependency. */
export function decodeMapShapes(data:ArrayBuffer):MapShape[]{
 if(data.byteLength<1||data.byteLength>8*1024*1024)throw new Error('地图瓦片容量无效');
 const tile=new VectorTile(new PbfReader(new Uint8Array(data))),shapes:MapShape[]=[];
 let points=0,features=0;
 for(const name of LAYERS){const layer=tile.layers[name];if(!layer)continue;
  if(!Number.isFinite(layer.extent)||layer.extent<1||layer.extent>65536||layer.length>12000)throw new Error('地图瓦片复杂度超过限制');
  for(let i=0;i<layer.length;i++){
   if(++features>12000)throw new Error('地图瓦片复杂度超过限制');
   const feature=layer.feature(i);if(feature.type!==2&&feature.type!==3)continue;
   const paths=feature.loadGeometry().map(path=>path.map(p=>{
    if(++points>100000||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>layer.extent*8||Math.abs(p.y)>layer.extent*8)throw new Error('地图几何超出限制');
    return {x:p.x/layer.extent,y:p.y/layer.extent};
   }));
   shapes.push({layer:name,type:feature.type,paths,kind:String(feature.properties.kind||'')});
  }
 }
 return shapes;
}
export function mapTileCenter(longitude:number,latitude:number,z:number){
 if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude< -180||longitude>180||Math.abs(latitude)>85.05112878||!Number.isInteger(z)||z<0||z>15)throw new Error('地图中心无效');
 const size=2**z,lat=latitude*Math.PI/180;
 return {x:Math.min(size-1,Math.max(0,Math.floor((longitude+180)/360*size))),y:Math.min(size-1,Math.max(0,Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*size)))};
}

export type MapLabel={text:string;x:number;y:number;rank:number};
/** Use only names embedded in licensed tiles; system fonts keep labels offline. */
export function decodeMapLabels(data:ArrayBuffer):MapLabel[]{
 if(data.byteLength<1||data.byteLength>8*1024*1024)throw new Error('地图瓦片容量无效');
 const tile=new VectorTile(new PbfReader(new Uint8Array(data))),labels:MapLabel[]=[];
 let features=0,points=0;
 for(const name of ['places','pois']){
  const layer=tile.layers[name];if(!layer)continue;
  if(!Number.isFinite(layer.extent)||layer.extent<1||layer.extent>65536||layer.length>12000)throw new Error('地图标签复杂度超过限制');
  for(let i=0;i<layer.length;i++){
   if(++features>12000)throw new Error('地图标签复杂度超过限制');
   const feature=layer.feature(i);if(feature.type!==1)continue;
   const value=feature.properties['name:zh']||feature.properties.name;
   if(typeof value!=='string')continue;
   const text=value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim();
   if(!text||text.length>64)continue;
   const rawRank=feature.properties.min_zoom;
   const rank=name==='places'?(typeof rawRank==='number'&&Number.isFinite(rawRank)?Math.max(0,Math.min(30,rawRank)):10):30;
   for(const path of feature.loadGeometry())for(const p of path){
    if(++points>100000||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>layer.extent*8||Math.abs(p.y)>layer.extent*8)throw new Error('地图标签坐标超出限制');
    if(labels.length<512)labels.push({text,x:p.x/layer.extent,y:p.y/layer.extent,rank});
   }
  }
 }
 return labels;
}
export type PositionedMapLabel=MapLabel&{width:number};
/** Conservative system-font width and bounded placement avoid unreadable overlaps. */
export function placeMapLabels(labels:MapLabel[],width:number,height:number):PositionedMapLabel[]{
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)return [];
 const placed:PositionedMapLabel[]=[],seen=new Set<string>();
 for(const item of labels.slice(0,4608).sort((a,b)=>a.rank-b.rank)){
  if(placed.length>=60)break;
  if(!Number.isFinite(item.x)||!Number.isFinite(item.y)||!Number.isFinite(item.rank)||!item.text||item.text.length>64)continue;
  const labelWidth=Array.from(item.text).reduce((n,c)=>n+(c.charCodeAt(0)>127?12:7),0)+8;
  if(item.x-labelWidth/2<0||item.x+labelWidth/2>width||item.y-10<0||item.y+10>height||seen.has(item.text))continue;
  if(placed.some(other=>Math.abs(other.x-item.x)<(other.width+labelWidth)/2+4&&Math.abs(other.y-item.y)<24))continue;
  seen.add(item.text);placed.push({...item,width:labelWidth});
 }
 return placed;
}
