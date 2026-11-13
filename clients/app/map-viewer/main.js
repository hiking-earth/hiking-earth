import {Map,NavigationControl,LngLatBounds,setWorkerUrl} from 'maplibre-gl';
import {createHikingRouteMapStyle} from '../../shared/maps/route-map-style.ts';
import {HE_PALETTE} from '../../shared/design/palette.ts';
setWorkerUrl(URL.createObjectURL(new Blob([window.hikingWorker],{type:'text/javascript'})));
function start(){
 const data=window.plus?.webview.currentWebview().hikingMapData;
 if(!data||!Array.isArray(data.points)){document.getElementById('status').textContent='地图资料已失效，请返回重新打开';return;}
 const points=data.points.filter(p=>Number.isFinite(p.longitude)&&Number.isFinite(p.latitude));
 const position=data.position;const first=position||points[0]||{longitude:104,latitude:35};
 try{const map=new Map({container:'map',style:createHikingRouteMapStyle(),center:[first.longitude,first.latitude],zoom:13,attributionControl:{compact:false}});map.addControl(new NavigationControl());map.on('error',()=>{document.getElementById('status').textContent='部分底图未加载。返回可查看本机离线资料。';});
 map.on('load',()=>{const segments=[];for(const p of points){if(!segments.length||p.segmentStart)segments.push([]);segments[segments.length-1].push([p.longitude,p.latitude]);}
 map.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:segments.filter(p=>p.length>=2).map(coordinates=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates}}))}});map.addLayer({id:'route',type:'line',source:'route',paint:{'line-color':HE_PALETTE.accent,'line-width':4}});
 if(position){map.addSource('position',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[position.longitude,position.latitude]}}});map.addLayer({id:'position',type:'circle',source:'position',paint:{'circle-radius':7,'circle-color':HE_PALETTE.info,'circle-stroke-color':'white','circle-stroke-width':2}});}
 const bounds=new LngLatBounds();points.forEach(p=>bounds.extend([p.longitude,p.latitude]));if(!bounds.isEmpty())map.fitBounds(bounds,{padding:35,maxZoom:16});document.getElementById('status').textContent='本次查看快照；返回导航页继续实时导航。';});
 }catch{document.getElementById('status').textContent='系统 WebView 不支持此地图，请返回查看本机资料。';}
}
if(window.plus)start();else document.addEventListener('plusready',start,{once:true});
