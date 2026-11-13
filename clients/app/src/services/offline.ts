import {reactive} from 'vue';
import {readCatalogCache,writeCatalogCache} from './catalog-cache';
export type OfflineLayer = { id: string; name: string; attribution: string; license: string; savedAt: number; paths: [number, number][][]; bytes: number; sourceKey?:'hk-afcd' };
const state=reactive<{layers:OfflineLayer[];active:string}>({layers:[],active:String(uni.getStorageSync('he_offline_active')||'')});
let restoring:Promise<void>|undefined;let mutation:Promise<void>=Promise.resolve();
function validLayers(value:any):value is OfflineLayer[]{
 if(!Array.isArray(value)||value.length>100)return false;
 const ids=new Set<string>(),sourceKeys=new Set<string>();
 for(const layer of value){
  if(!layer||typeof layer!=='object'||Array.isArray(layer)
    ||Object.keys(layer).some(key=>!['id','name','attribution','license','savedAt','paths','bytes','sourceKey'].includes(key))
    ||typeof layer.id!=='string'||!layer.id||layer.id.length>128||ids.has(layer.id)
    ||typeof layer.name!=='string'||!layer.name.trim()||layer.name.length>80
    ||typeof layer.attribution!=='string'||!layer.attribution.trim()||layer.attribution.length>300
    ||typeof layer.license!=='string'||!layer.license.trim()||layer.license.length>300
    ||!Number.isSafeInteger(layer.savedAt)||layer.savedAt<=0
    ||!Number.isSafeInteger(layer.bytes)||layer.bytes<0||layer.bytes>8*1024*1024
    ||!Array.isArray(layer.paths)||layer.paths.length===0||layer.paths.length>50000)return false;
  if(layer.sourceKey!==undefined){
   if(layer.sourceKey!=='hk-afcd'||sourceKeys.has(layer.sourceKey))return false;
   sourceKeys.add(layer.sourceKey);
  }
  ids.add(layer.id);
  let pointCount=0;
  for(const line of layer.paths){
   if(!Array.isArray(line)||line.length<2||line.length>50000)return false;
   for(const point of line){
    if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>90)return false;
    if(++pointCount>50000)return false;
   }
  }
 }
 return true;
}
export function restoreOfflineLayers():Promise<void>{
 return restoring??=readCatalogCache('offline',validLayers).then(value=>{if(value&&bytesOf(JSON.stringify(value))<=8*1024*1024)state.layers=value;}).catch(()=>{});
}
async function commitLayers(update:(rows:OfflineLayer[])=>OfflineLayer[]):Promise<void>{
 const work=mutation.catch(()=>{}).then(async()=>{await restoreOfflineLayers();const next=update([...state.layers]);await writeCatalogCache('offline',next);state.layers=next;});mutation=work;return work;
}
const bytesOf = (text: string) => encodeURIComponent(text).replace(/%[A-F\d]{2}|./g, 'x').length;
export function offlineLayers():OfflineLayer[]{return state.layers;}
export async function importOfflineLayer(text: string, sourceKey?:'hk-afcd', options:{replaceOnly?:boolean;shouldApply?:()=>boolean}={}): Promise<OfflineLayer> {
  await restoreOfflineLayers();
  if (bytesOf(text) > 5 * 1024 * 1024) throw new Error('离线资料最多5 MB');
  const data = JSON.parse(text);
  if (data.format !== 'hiking-earth-offline-v1' || typeof data.name !== 'string' || !data.name.trim() || typeof data.attribution !== 'string' || !data.attribution.trim() || typeof data.license !== 'string' || !data.license.trim() || data.geometry?.type !== 'FeatureCollection' || !Array.isArray(data.geometry.features)) throw new Error('资料需包含名称、来源、许可和GeoJSON FeatureCollection');
  const paths: [number, number][][] = []; let count = 0;
  const add = (line: unknown) => {
    if (!Array.isArray(line) || line.length < 2) throw new Error('线段至少需要两个点');
    const points: [number, number][] = [];
    for (const coord of line) {
      if (!Array.isArray(coord) || !Number.isFinite(coord[0]) || Math.abs(coord[0]) > 180 || !Number.isFinite(coord[1]) || Math.abs(coord[1]) > 90) throw new Error('离线资料包含无效WGS84坐标');
      if (++count > 50000) throw new Error('离线资料最多50000个点');
      points.push([coord[0], coord[1]]);
    }
    paths.push(points);
  };
  for (const feature of data.geometry.features) {
    const g = feature?.geometry;
    if (g?.type === 'LineString') add(g.coordinates);
    else if (g?.type === 'MultiLineString' || g?.type === 'Polygon') { if (!Array.isArray(g.coordinates)) throw new Error('几何数据无效'); g.coordinates.forEach(add); }
    else if (g?.type === 'MultiPolygon') { if (!Array.isArray(g.coordinates)) throw new Error('几何数据无效'); for (const polygon of g.coordinates) { if (!Array.isArray(polygon)) throw new Error('几何数据无效'); polygon.forEach(add); } }
    else throw new Error('仅支持线段与区域边界，不支持未知几何类型');
  }
  if (!paths.length) throw new Error('资料没有可显示的线段');
  const layer:OfflineLayer = { ...(sourceKey?{sourceKey}:{}), id: `offline-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name: data.name.trim().slice(0,80), attribution: data.attribution.trim().slice(0,300), license: data.license.trim().slice(0,300), savedAt: Date.now(), paths, bytes: 0 };
  layer.bytes = bytesOf(JSON.stringify(layer));
  let selected=layer;
  await commitLayers(rows=>{
   if(options.shouldApply&&!options.shouldApply())throw new Error('参考线更新已停止，保留现有资料');
   if(sourceKey){
    const previous=rows.find(item=>item.sourceKey===sourceKey);
    if(options.replaceOnly&&!previous)throw new Error('参考资料已删除，本轮不会重新下载');
    if(previous){layer.id=previous.id;layer.bytes=bytesOf(JSON.stringify(layer));}
    const all=[...rows.filter(item=>item.sourceKey!==sourceKey),layer];
    if(all.length>100||bytesOf(JSON.stringify(all))>8*1024*1024)throw new Error('离线资料总量最多8 MB和100份，请先删除不需要的资料');
    return all;
   }
   const existing=rows.find(item=>item.name===layer.name&&item.attribution===layer.attribution&&item.license===layer.license&&JSON.stringify(item.paths)===JSON.stringify(layer.paths));
   if(existing){selected=existing;return rows;}
   const all=[...rows,layer];if(all.length>100||bytesOf(JSON.stringify(all))>8*1024*1024)throw new Error('离线资料总量最多8 MB和100份，请先删除不需要的资料');return all;
  });return selected;
}
export async function deleteOfflineLayer(id: string): Promise<void> {
 await commitLayers(rows=>rows.filter(layer=>layer.id!==id));
 if(state.active===id){state.active='';try{uni.removeStorageSync('he_offline_active');}catch{}}
}
export function activeOfflineLayer(): OfflineLayer | null {
  const id = state.active; return offlineLayers().find(p => p.id === id) || null;
}
export function selectOfflineLayer(id: string): void {
  if (!offlineLayers().some(p => p.id === id)) throw new Error('离线资料不存在');
  uni.setStorageSync('he_offline_active', id);state.active=id;
}
