"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HE_PALETTE } from "./palette";
import Image from "next/image";
import { RegionPhoto } from "@/components/RegionPhoto";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ROUTES, reviewedRouteStatus, STATUS_COLORS, type HikingRoute, type OvernightStyle, type PackStyle, type RouteStatus, type Season, type SurfaceStyle } from "@/data/routes";
import type { HubTab } from "@/components/ProjectHub";
import {readWebCatalogCache,writeWebCatalogCache} from '@/data/catalog-cache';
import {loadOfficialNotices,loadPublicRouteCatalog,searchPublicRoutes,publicCatalogCoverageSummary,publicCatalogHasSourceFailures,type OfficialNotice} from "@/data/live-catalog";
import { buildGearAdvice, type GearMode } from "@/data/gear-advice";
import { isCurrentForecastTime } from "@/data/weather-gear-advice";
import {
  Backpack,
  Building2,
  CalendarDays,
  CircleAlert,
  ChevronRight,
  Compass,
  Download,
  Globe2,
  Layers3,
  LocateFixed,
  MapPin,
  MessageCircle,
  Mountain,
  Newspaper,
  Route as RouteIcon,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  WifiOff,
  X,
} from "lucide-react";

const hasSourceNameReview = (route: HikingRoute) => route.archive.highlights.some(item => item.startsWith("来源名称包含"));

type WeatherState = { status: "loading" | "available" | "unavailable"; weather?: { city: string; temperature: string; wind: string; humidity: string; rain: string; observedAt: string; fetchedAt: string }; message?: string; sourceUrl?: string; providerNotice?: string };
type WeatherDetails = NonNullable<WeatherState["weather"]>;
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
function isWeatherDetails(value:unknown):value is WeatherDetails{
  return isRecord(value)
    && [value.city,value.temperature,value.wind,value.humidity,value.rain].every(item=>typeof item==="string"&&item.length<100)
    && typeof value.fetchedAt==="string"&&Number.isFinite(Date.parse(value.fetchedAt))
    && Date.parse(value.fetchedAt)<=Date.now()+5*60*1000
    && typeof value.observedAt==="string"&&isCurrentForecastTime(value.observedAt);
}
function isAvailableWeatherPayload(value:unknown):value is {status:"available";provider:"MET Norway";license:"CC BY 4.0";weather:WeatherDetails;providerNotice?:unknown}{
  return isRecord(value)&&value.status==="available"&&value.provider==="MET Norway"&&value.license==="CC BY 4.0"&&isWeatherDetails(value.weather);
}
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const ProjectHub = lazy(() => import("@/components/ProjectHub").then((module) => ({ default: module.ProjectHub })));
const GearPhotoScan = lazy(() => import("@/components/GearPhotoScan").then((module) => ({ default: module.GearPhotoScan })));

const MAP_DETAIL_LAYERS = ["admin-boundaries", "roads-casing", "roads", "road-labels", "water-labels", "peak-labels", "poi-labels", "place-labels"];
const BUILDING_LAYERS = ["building-footprints", "city-buildings-3d"];
const SEASON_LAYER_IDS = ["season-spring", "season-summer", "season-autumn", "season-winter"] as const;
const LOCALIZED_NAME = ["coalesce", ["get", "name:zh-Hans"], ["get", "name:zh"], ["get", "name"], ["get", "name_en"]] as ExpressionSpecification;

function nasaSeasonTiles(date: string) {
  return [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`];
}

type SeasonId = "春" | "夏" | "秋" | "冬";
type SeasonImageDates = Record<SeasonId, string>;

function getSeasonImageDates(now = new Date()): SeasonImageDates {
  const year = now.getUTCFullYear();
  const safeThrough = Date.UTC(year, now.getUTCMonth(), now.getUTCDate() - 3);
  const dateFor = (month: number, day: number) => {
    const thisYear = Date.UTC(year, month - 1, day);
    const imageYear = thisYear <= safeThrough ? year : year - 1;
    return `${imageYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  return {
    春: dateFor(4, 15),
    夏: dateFor(7, 15),
    秋: dateFor(10, 15),
    冬: dateFor(1, 15),
  };
}

const SEASONS = [
  { id: "春", layerId: "season-spring", label: "春日花期", hint: "春季返青与融雪", saturation: 0.04, contrast: 0.05, brightness: 0.99, hue: 0 },
  { id: "夏", layerId: "season-summer", label: "盛夏秘境", hint: "盛夏植被与丰水期", saturation: 0.06, contrast: 0.06, brightness: 1, hue: 0 },
  { id: "秋", layerId: "season-autumn", label: "金秋层林", hint: "秋季植被与旱湿变化", saturation: 0.03, contrast: 0.08, brightness: 0.97, hue: 0 },
  { id: "冬", layerId: "season-winter", label: "冬日雪境", hint: "冬季积雪与低植被覆盖", saturation: 0, contrast: 0.08, brightness: 0.95, hue: 0 },
] as const;

const REGION_BOUNDS = [
  { label: "北京", west: 115.4, east: 117.6, south: 39.4, north: 41.1 },
  { label: "河南", west: 110.3, east: 116.7, south: 31.3, north: 36.5 },
  { label: "江西", west: 113.5, east: 118.5, south: 24.4, north: 30.1 },
  { label: "云南", west: 97.5, east: 106.3, south: 21.1, north: 29.3 },
  { label: "四川", west: 97.2, east: 108.6, south: 26, north: 34.4 },
] as const;

function getRegionLabel([lng, lat]: [number, number]) {
  const region = REGION_BOUNDS.find((item) => lng >= item.west && lng <= item.east && lat >= item.south && lat <= item.north);
  if (region) return region.label;
  if (lng >= 73 && lng <= 135 && lat >= 18 && lat <= 54) return "中国";
  return "全球";
}

function safeExternalHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.port ? url.href : "";
  } catch {
    return "";
  }
}

function setRouteMarkerSelected(element: HTMLButtonElement, selected: boolean) {
  element.classList.toggle("selected", selected);
  if (!element.classList.contains("maplibregl-marker")) return;
  if (selected) element.style.setProperty("z-index", "10000", "important");
  else element.style.removeProperty("z-index");
}

function featureCollection(route: HikingRoute) {
  const coordinates = route.trackMode === "不展示轨迹" ? [] : route.path;
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: { id: route.id },
      geometry: { type: "LineString" as const, coordinates },
    }],
  };
}

type TerrainContours = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { elevationMeters: number };
    geometry: { type: "MultiLineString"; coordinates: Array<Array<[number, number]>> };
  }>;
};

function buildTerrainContours(map: MapLibreMap, columns: number, rows: number, requestedInterval: number, exaggeration: number): TerrainContours {
  const width = map.getContainer().clientWidth;
  const height = map.getContainer().clientHeight;
  const grid: Array<Array<{ coordinate: [number, number]; elevation: number } | null>> = [];
  const elevations: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    const line: Array<{ coordinate: [number, number]; elevation: number } | null> = [];
    for (let column = 0; column < columns; column += 1) {
      try {
        const point = map.unproject([width * column / (columns - 1), height * row / (rows - 1)]);
        const coordinate: [number, number] = [point.lng, Math.max(-85.05112878, Math.min(85.05112878, point.lat))];
        const sampled = map.queryTerrainElevation(coordinate);
        if (sampled === null || !Number.isFinite(sampled)) {
          line.push(null);
          continue;
        }
        const elevation = sampled / exaggeration;
        line.push({ coordinate, elevation });
        elevations.push(elevation);
      } catch {
        line.push(null);
      }
    }
    grid.push(line);
  }

  if (elevations.length < Math.floor(columns * rows * 0.3)) return { type: "FeatureCollection", features: [] };
  const minimum = Math.min(...elevations);
  const maximum = Math.max(...elevations);
  const interval = Math.max(requestedInterval, Math.ceil((maximum - minimum) / 64 / 10) * 10 || requestedInterval);
  const features: TerrainContours["features"] = [];
  const interpolate = (first: NonNullable<(typeof grid)[number][number]>, second: NonNullable<(typeof grid)[number][number]>, level: number): [number, number] => {
    const ratio = Math.max(0, Math.min(1, (level - first.elevation) / (second.elevation - first.elevation || 1)));
    return [first.coordinate[0] + (second.coordinate[0] - first.coordinate[0]) * ratio, first.coordinate[1] + (second.coordinate[1] - first.coordinate[1]) * ratio];
  };

  for (let level = Math.ceil(minimum / interval) * interval; level <= maximum && features.length < 64; level += interval) {
    const segments: Array<Array<[number, number]>> = [];
    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const corners = [grid[row][column], grid[row][column + 1], grid[row + 1][column + 1], grid[row + 1][column]];
        if (corners.some((corner) => !corner)) continue;
        const points = corners as Array<NonNullable<(typeof grid)[number][number]>>;
        const edges: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0]];
        const crossings: Array<{ edge: number; coordinate: [number, number] }> = [];
        for (let edge = 0; edge < edges.length; edge += 1) {
          const [from, to] = edges[edge];
          const first = points[from];
          const second = points[to];
          if ((first.elevation < level && second.elevation >= level) || (second.elevation < level && first.elevation >= level)) {
            crossings.push({ edge, coordinate: interpolate(first, second, level) });
          }
        }
        if (crossings.length === 2) segments.push([crossings[0].coordinate, crossings[1].coordinate]);
        else if (crossings.length === 4) {
          const centerIsHigh = points.reduce((sum, point) => sum + point.elevation, 0) / 4 >= level;
          const northWestIsHigh = points[0].elevation >= level;
          const pairs = centerIsHigh === northWestIsHigh ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
          for (const [firstEdge, secondEdge] of pairs) segments.push([crossings[firstEdge].coordinate, crossings[secondEdge].coordinate]);
        }
      }
    }
    if (segments.length) features.push({ type: "Feature", properties: { elevationMeters: Math.round(level) }, geometry: { type: "MultiLineString", coordinates: segments } });
  }
  return { type: "FeatureCollection", features };
}

function routeAreaRing(route: HikingRoute) {
  const referencePath = route.path.length ? route.path : [route.center];
  const lngs = referencePath.map(([lng]) => lng);
  const lats = referencePath.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngPadding = Math.max((maxLng - minLng) * 0.55, 0.012);
  const latPadding = Math.max((maxLat - minLat) * 0.55, 0.01);
  return [
    [minLng - lngPadding, minLat - latPadding],
    [maxLng + lngPadding, minLat - latPadding],
    [maxLng + lngPadding, maxLat + latPadding],
    [minLng - lngPadding, maxLat + latPadding],
    [minLng - lngPadding, minLat - latPadding],
  ];
}

function areaCollection(route: HikingRoute) {
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: { id: route.id, label: "路线关注区域示意" },
      geometry: { type: "Polygon" as const, coordinates: [routeAreaRing(route)] },
    }],
  };
}

function maskCollection(route: HikingRoute) {
  const worldRing = [[-180, -84], [180, -84], [180, 84], [-180, 84], [-180, -84]];
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: { id: route.id },
      geometry: { type: "Polygon" as const, coordinates: [worldRing, [...routeAreaRing(route)].reverse()] },
    }],
  };
}

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [routes,setRoutes]=useState(ROUTES);
  const currentRoutesRef=useRef(routes);
  const syncViewportRoutesRef=useRef<()=>void>(()=>{});
  useEffect(()=>{currentRoutesRef.current=routes;},[routes]);
  useEffect(()=>{syncViewportRoutesRef.current();},[routes]);
  const catalogRefreshRef=useRef<()=>void>(()=>{});
  const [catalogMessage,setCatalogMessage]=useState("");
  const [catalogRefreshing,setCatalogRefreshing]=useState(false);
  useEffect(()=>{
    let active=true;let loading=false;let restoring=true;let hasRestoredCatalog=false;let lastSuccess=0;let failures=0;let retryAt=0;
    const refresh=async(force=false)=>{
      const now=Date.now();
      if(restoring||loading||(!force&&(now<retryAt||now-lastSuccess<6*60*60*1000)))return;
      loading=true;
      if(active)setCatalogRefreshing(true);
      try{const next=await loadPublicRouteCatalog(currentRoutesRef.current);if(!active)return;currentRoutesRef.current=next;setRoutes(next);const partial=publicCatalogHasSourceFailures();if(partial){failures+=1;lastSuccess=0;retryAt=Date.now()+Math.min(6*60*60*1000,15*60*1000*2**Math.min(failures-1,5));}else{lastSuccess=Date.now();failures=0;retryAt=0;}const saved=await writeWebCatalogCache(next);if(active)setCatalogMessage(`${partial?'部分路线源已刷新':'路线及官方状态已刷新'}，共 ${next.length} 条。${publicCatalogCoverageSummary()}. ${saved?'已保存本机目录。':'本机保存失败，本次资料仅在当前页面可用。'}`);}
      catch{if(active){failures+=1;retryAt=Date.now()+Math.min(6*60*60*1000,15*60*1000*2**Math.min(failures-1,5));setCatalogMessage(`云端路线刷新失败，${hasRestoredCatalog?'继续显示已保存的本机目录':'当前仅显示内置待核验基础档案'}；稍后自动重试，也可手动刷新。`);}}
      finally{loading=false;if(active)setCatalogRefreshing(false);}
    };
    catalogRefreshRef.current=()=>{void refresh(true);};
    const expireOpeningStatuses=()=>{
      const now=Date.now();
      setRoutes(previous=>{
        let changed=false;
        const next=previous.map(route=>{
          const status=reviewedRouteStatus(route.status,route.openingExpiresAt,now);
          if(status===route.status)return route;
          changed=true;return {...route,status:'待核验' as const,openingExpiresAt:0};
        });
        return changed?next:previous;
      });
    };
    const onVisible=()=>{if(document.visibilityState==='visible'){expireOpeningStatuses();void refresh();}};
    void (async()=>{const cached=await readWebCatalogCache();if(!active)return;restoring=false;if(cached){hasRestoredCatalog=true;currentRoutesRef.current=cached.routes;setRoutes(cached.routes);setCatalogMessage(`已恢复 ${cached.routes.length} 条本机目录（${new Date(cached.savedAt).toLocaleString()}），正在检查更新。`);}await refresh(true);})();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible'){expireOpeningStatuses();void refresh();}},60*1000);
    document.addEventListener('visibilitychange',onVisible);
    return()=>{active=false;catalogRefreshRef.current=()=>{};window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
  },[]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const mapReadyRef = useRef(false);
  const lowPowerRef = useRef(false);
  const loadingTimerRef = useRef<number | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const markerElementsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [routeDisplayLimit, setRouteDisplayLimit] = useState(50);
  const [activeId, setActiveId] = useState(ROUTES[0].id);
  const activeIdRef = useRef(ROUTES[0].id);
  const selectedRouteId=routes.some(route=>route.id===activeId)?activeId:(routes[0]?.id??'');
  useEffect(()=>{activeIdRef.current=selectedRouteId;},[selectedRouteId]);
  const [status, setStatus] = useState<"全部" | RouteStatus>("全部");
  const [seasonFilter, setSeasonFilter] = useState<"全部" | Season>("全部");
  const [packFilter, setPackFilter] = useState<"全部" | PackStyle>("全部");
  const [overnightFilter, setOvernightFilter] = useState<"全部" | OvernightStyle>("全部");
  const [surfaceFilter, setSurfaceFilter] = useState<"全部" | SurfaceStyle>("全部");
  const [query, setQuery] = useState("");
  const [searchSource,setSearchSource]=useState<'osm'|'usfs'|'hk'|'nzdoc'|'parkscanada'|'nsw-npws'|'england'|'wales'|'japan-tokai'|'scotland-argyll'|'ni-midulster'|'norfolk-prow'|'cambridgeshire-prow'|'nps-public-trails'|'usgs-trails'|'swisstopo-wanderwege'|'victoria-recreation-tracks'|'queensland-qpws-trails'|'taiwan-trails'|'korea-durunubi-trails'>('osm');
  const [onlineSearchState,setOnlineSearchState]=useState<{key:string;rows:HikingRoute[];message:string;loading:boolean;more:boolean;offset:number;snapshot:string}>({key:'',rows:[],message:'',loading:false,more:false,offset:0,snapshot:''});
  const currentSearchKey=`${searchSource}\u0000${query.trim()}`;
  const emptyOnlineSearchState={key:currentSearchKey,rows:[] as HikingRoute[],message:'',loading:false,more:false,offset:0,snapshot:''};
  const currentOnlineSearch=onlineSearchState.key===currentSearchKey?onlineSearchState:emptyOnlineSearchState;
  const searchGenerationRef=useRef(0);
  useEffect(()=>{searchGenerationRef.current++;},[currentSearchKey]);
  useEffect(()=>()=>{searchGenerationRef.current++;},[]);
  async function onlineSearch(more=false){
    const key=currentSearchKey;
    if(currentOnlineSearch.loading)return;
    if(query.trim().length<2){setOnlineSearchState({key,rows:[],message:'在线检索至少输入2个字符',loading:false,more:false,offset:0,snapshot:''});return;}
    const generation=++searchGenerationRef.current;
    const startingState=more?currentOnlineSearch:{key,rows:[],message:'',loading:false,more:false,offset:0,snapshot:''};
    setOnlineSearchState({...startingState,key,loading:true,message:''});
    try{const result=await searchPublicRoutes(searchSource,query.trim(),more?currentOnlineSearch.offset:0,more?currentOnlineSearch.snapshot||undefined:undefined);if(generation!==searchGenerationRef.current)return;
      setOnlineSearchState(previous=>previous.key===key?{key,rows:more?[...previous.rows,...result.routes]:result.routes,message:`来源匹配${result.total}条，已读取${result.offset+result.routes.length}条；不代表开放或可导航。`,loading:false,more:result.hasMore,offset:result.offset+result.routes.length,snapshot:result.snapshot}:previous);
    }catch(error){if(generation===searchGenerationRef.current)setOnlineSearchState(previous=>previous.key===key?{...previous,message:error instanceof Error?error.message:'在线检索失败，保留现有结果',loading:false}:previous);}
    finally{if(generation===searchGenerationRef.current)setOnlineSearchState(previous=>previous.key===key?{...previous,loading:false}:previous);}
  }
  function openOnlineRoute(route:HikingRoute){
    setRoutes(previous=>previous.some(item=>item.id===route.id)?previous:[...previous,route]);setActiveId(route.id);setDetailOpen(true);setMapView('route');
  }
  const [panelOpen, setPanelOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Keep the first route view light: the public vector basemap is enough to orient the user.
  // Terrain and seasonal imagery remain available as opt-in enhancements.
  const [terrain, setTerrain] = useState(false);
  const [contours, setContours] = useState(false);
  const [contourMessage, setContourMessage] = useState("");
  const [mapDetails, setMapDetails] = useState(true);
  const [city3DActive, setCity3DActive] = useState(false);
  const [globeResetToken, setGlobeResetToken] = useState(0);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapMessage, setMapMessage] = useState("");
  const [webUpdateReady, setWebUpdateReady] = useState(false);
  const [layer, setLayer] = useState<"routes" | "news">("routes");
  const [officialNotices,setOfficialNotices]=useState<OfficialNotice[]>([]);
  const [noticeUpdatedAt,setNoticeUpdatedAt]=useState("");
  const [noticeState,setNoticeState]=useState<"loading"|"available"|"unavailable">("loading");
  const [noticeCollectionStatus,setNoticeCollectionStatus]=useState<{state:"success"|"partial"|"all-attempted-sources-failed";attemptedSourceCount:number;failedSourceCount:number}|null>(null);
  const [noticeReload,setNoticeReload]=useState(0);
  const noticeReloadHandledRef=useRef(0);
  const noticeLastSuccessRef=useRef(0);
  const noticeRetryAtRef=useRef(0);
  const noticeFailuresRef=useRef(0);
  const noticeLoadingRef=useRef(false);
  const [season, setSeason] = useState<(typeof SEASONS)[number]["id"]>("秋");
  const [seasonImageDates, setSeasonImageDates] = useState<SeasonImageDates>({ 春: "2025-04-15", 夏: "2025-07-15", 秋: "2025-10-15", 冬: "2025-01-15" });
  const [seasonOverlayEnabled, setSeasonOverlayEnabled] = useState(false);
  const [mapView, setMapView] = useState<"globe" | "route">("globe");
  const [viewportRouteIds, setViewportRouteIds] = useState<string[]>(ROUTES.map((route) => route.id));
  const [viewportRegion, setViewportRegion] = useState("全球");
  const [gearOpen, setGearOpen] = useState(false);
  const [gearMode, setGearMode] = useState<GearMode>("轻装");
  const [departureDate, setDepartureDate] = useState("");
  const [hubOpen, setHubOpen] = useState(false);
  const [hubTab, setHubTab] = useState<HubTab>("推荐");
  const [weatherState, setWeatherState] = useState<WeatherState>({ status: "loading" });
  const [isOnline, setIsOnline] = useState(true);
  const [locating, setLocating] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(()=>{
    if(layer!=="news")return;
    const refresh=async(force=false)=>{
      const now=Date.now();
      const cutoff=now-90*24*60*60*1000;
      setOfficialNotices(current=>current.filter(item=>typeof item.publishedAt==="string"
        &&Date.parse(item.publishedAt)<=now+300000&&Date.parse(item.publishedAt)>=cutoff));
      if(noticeLoadingRef.current||(!force&&(now<noticeRetryAtRef.current||now-noticeLastSuccessRef.current<6*60*60*1000)))return;
      noticeLoadingRef.current=true;
      setNoticeState("loading");
      try{
        const snapshot=await loadOfficialNotices();
        setOfficialNotices(snapshot.items);
        setNoticeUpdatedAt(snapshot.generatedAt);
        setNoticeCollectionStatus(snapshot.collectionStatus);
        noticeLastSuccessRef.current=Date.now();
        noticeFailuresRef.current=0;
        noticeRetryAtRef.current=0;
        setNoticeState("available");
      }catch{
        noticeFailuresRef.current+=1;
        noticeRetryAtRef.current=Date.now()+Math.min(6*60*60*1000,15*60*1000*2**Math.min(noticeFailuresRef.current-1,5));
        setNoticeState("unavailable");
      }finally{noticeLoadingRef.current=false;}
    };
    const force=noticeReload>noticeReloadHandledRef.current;
    noticeReloadHandledRef.current=noticeReload;
    void refresh(force);
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void refresh();},6*60*60*1000);
    const onVisible=()=>{if(document.visibilityState==="visible")void refresh();};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",onVisible);};
  },[layer,noticeReload]);

  const visibleRoutes = useMemo(() => routes.filter((route) => {
    const statusMatch = status === "全部" || route.status === status;
    const seasonMatch = seasonFilter === "全部" || route.bestSeasons.includes(seasonFilter);
    const packMatch = packFilter === "全部" || route.packStyle === packFilter;
    const overnightMatch = overnightFilter === "全部" || route.overnight === overnightFilter;
    const surfaceMatch = surfaceFilter === "全部" || route.surface === surfaceFilter;
    const textMatch = `${route.name}${route.region}${route.scenery.join("")}`.includes(query.trim());
    return statusMatch && seasonMatch && packMatch && overnightMatch && surfaceMatch && textMatch && viewportRouteIds.includes(route.id);
  }), [routes, overnightFilter, packFilter, query, seasonFilter, status, surfaceFilter, viewportRouteIds]);

  const activeRoute = routes.find((route) => route.id === selectedRouteId) ?? routes[0];
  const weatherSourceUrl = safeExternalHttpsUrl(weatherState.sourceUrl);
  const routeSourceUrl = safeExternalHttpsUrl(activeRoute.archive.source.url);
  const routeValidityNotice = activeRoute.status === "永久关闭"
    ? "资料标记为永久关闭，不提供导航。"
    : activeRoute.status === "临时关闭"
      ? "资料标记为临时关闭，不提供导航。"
      : activeRoute.status === "待核验"
        ? "开放状态尚未核验；路线资料不能作为通行许可或导航依据。"
        : typeof activeRoute.openingExpiresAt !== "number" || !Number.isFinite(activeRoute.openingExpiresAt) || activeRoute.openingExpiresAt <= Date.now()
          ? "开放核验期限缺失或已过期；当前资料不能作为开放或导航依据。"
          : `${activeRoute.status === "即将开放" ? "本次即将开放资料" : "本次开放资料"}有效至 ${new Date(activeRoute.openingExpiresAt).toLocaleString("zh-CN")}；出行前仍须查看属地官方原文。`;
  const activeSeason = SEASONS.find((item) => item.id === season) ?? SEASONS[2];
  const gearAdvice = useMemo(() => buildGearAdvice(activeRoute, gearMode, departureDate,
    weatherState.status === "available" ? weatherState.weather : undefined), [activeRoute, departureDate, gearMode, weatherState]);
  const weatherLatitude=activeRoute.center[1],weatherLongitude=activeRoute.center[0];

  useEffect(() => {
    let cancelled = false;
    async function loadWeather() {
      setWeatherState({ status: "loading" });
      try {
        const latitude=Number(weatherLatitude.toFixed(2)),longitude=Number(weatherLongitude.toFixed(2));
        const response=await fetch(`/api/weather?latitude=${latitude}&longitude=${longitude}`,{signal:AbortSignal.timeout(15000),cache:"default"});
        const payload:unknown=await response.json();
        if (cancelled) return;
        const message=isRecord(payload)&&typeof payload.message==="string"?payload.message:"天气预报暂不可用，请查属地预警后再出发。";
        setWeatherState(response.ok&&isAvailableWeatherPayload(payload) ? { status: "available", weather:payload.weather, sourceUrl: "https://api.met.no/doc/TermsOfService",
          ...(typeof payload.providerNotice === "string" && payload.providerNotice.length <= 200 ? { providerNotice: payload.providerNotice } : {}) }
          : { status: "unavailable", message });
      } catch {
        if (!cancelled) setWeatherState({ status: "unavailable", message: "官方天气暂时无法核实。" });
      }
    }
    void loadWeather();
    const refreshTimer = window.setInterval(() => { void loadWeather(); }, 30 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(refreshTimer); };
  }, [activeRoute.id, activeRoute.weatherCityId, weatherLatitude, weatherLongitude]);

  useEffect(() => {
    const updateNetworkState = () => setIsOnline(navigator.onLine);
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    let disposed = false;
    let hadController = "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
    let registration: ServiceWorkerRegistration | undefined;
    let updateTimer: number | undefined;
    const controllerChanged = () => {
      if (hadController) setWebUpdateReady(true);
      hadController = true;
    };
    const checkWorkerUpdate = () => { if (registration) void registration.update().catch(() => {}); };
    const canUseServiceWorker = "serviceWorker" in navigator
      && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1");
    if (canUseServiceWorker) {
      navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
      window.addEventListener("focus", checkWorkerUpdate);
      updateTimer = window.setInterval(checkWorkerUpdate, 6 * 60 * 60 * 1000);
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((value) => {
        if (disposed) return;
        registration = value;
        if (hadController && value.waiting) setWebUpdateReady(true);
        checkWorkerUpdate();
      }).catch(() => {
        if (!disposed) setMapMessage("离线缓存初始化失败；在线浏览不受影响。");
      });
    }
    return () => {
      disposed = true;
      if (updateTimer !== undefined) window.clearInterval(updateTimer);
      if (canUseServiceWorker) navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
      window.removeEventListener("focus", checkWorkerUpdate);
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
    };
  }, []);

  const startMapLoading = useCallback(() => {
    setMapLoading(true);
    if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = window.setTimeout(() => setMapLoading(false), 2600);
  }, []);

  const selectRoute = useCallback((routeId: string) => {
    startMapLoading();
    setActiveId(routeId);
    setMapView("route");
    setCity3DActive(false);
    setDetailOpen(true);
    setPanelOpen(true);
    setGearOpen(false);
    const packStyle=currentRoutesRef.current.find((route)=>route.id===routeId)?.packStyle;
    setGearMode(packStyle==="轻装"||packStyle==="重装"?packStyle:"中度");
  }, [startMapLoading]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let disposed = false;
    const markerElements = markerElementsRef.current;

    void (async () => {
      // Keep the 3D engine out of the React/UI entry chunk. The loading panel
      // stays visible while the browser fetches MapLibre in parallel.
      const maplibregl = await import("maplibre-gl");
      maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
      if (disposed || !mapContainer.current || mapRef.current) return;
      const markers = markersRef.current;

    const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
    const compactTouchDevice = window.matchMedia("(max-width: 900px)").matches || navigator.maxTouchPoints > 1;
    const lowPowerHardware = deviceMemory <= 4 || navigator.hardwareConcurrency <= 4 || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const efficientRendering = compactTouchDevice || lowPowerHardware;
    const seasonDates = getSeasonImageDates();
    setSeasonImageDates(seasonDates);
    lowPowerRef.current = efficientRendering;
    document.documentElement.classList.toggle("low-power", efficientRendering);
    maplibregl.setMaxParallelImageRequests(efficientRendering ? 12 : 20);

    const map = new maplibregl.Map({
      container: mapContainer.current,
      center: [105, 28],
      zoom: 2,
      minZoom: 0.75,
      maxZoom: 18,
      maxPitch: efficientRendering ? 65 : 78,
      pitch: 0,
      bearing: -8,
      fadeDuration: efficientRendering ? 0 : 120,
      pixelRatio: lowPowerHardware ? 1 : compactTouchDevice ? Math.min(window.devicePixelRatio, 1.25) : Math.min(window.devicePixelRatio, 1.5),
      maxTileCacheSize: efficientRendering ? 24 : 52,
      maxTileCacheZoomLevels: efficientRendering ? 2 : 3,
      refreshExpiredTiles: false,
      renderWorldCopies: false,
      crossSourceCollisions: false,
      cancelPendingTileRequestsWhileZooming: true,
      validateStyle: false,
      maxCanvasSize: efficientRendering ? [2560, 2560] : [3584, 3584],
      canvasContextAttributes: { antialias: !efficientRendering },
      attributionControl: false,
      style: {
        version: 8,
        projection: { type: "globe" },
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sources: {
          seasonSpring: { type: "raster", tiles: nasaSeasonTiles(seasonDates["春"]), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          seasonSummer: { type: "raster", tiles: nasaSeasonTiles(seasonDates["夏"]), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          seasonAutumn: { type: "raster", tiles: nasaSeasonTiles(seasonDates["秋"]), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          seasonWinter: { type: "raster", tiles: nasaSeasonTiles(seasonDates["冬"]), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          blueMarbleOverview: {
            type: "image",
            url: "/static/earth/blue-marble-june-2004.png",
            coordinates: [[-180, 85.05112878], [180, 85.05112878], [180, -85.05112878], [-180, -85.05112878]],
            attribution: "地球影像 © NASA Earth Observatory Blue Marble Next Generation（2004年6月合成，非实时）",
          },
          terrainSource: {
            type: "raster-dem",
            tiles: ["/api/terrain/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 14,
            encoding: "terrarium",
            attribution: '地形：Mapzen / AWS 开放数据 · <a href="/terrain-sources" target="_blank" rel="noreferrer">数据来源与署名</a>',
          },
          terrainContours: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          openmaptiles: {
            type: "vector",
            url: "https://tiles.openfreemap.org/planet",
            attribution: "地图 © OpenFreeMap / OpenMapTiles；数据 © OpenStreetMap 贡献者",
          },
        },
        layers: [
          { id: "ocean", type: "background", paint: { "background-color": HE_PALETTE.mapOcean } },
          { id: "basemap", type: "fill", source: "openmaptiles", "source-layer": "landcover", paint: { "fill-color": ["match", ["get", "class"], "wood", HE_PALETTE.mapWood, "grass", HE_PALETTE.mapGrass, "ice", HE_PALETTE.mapIce, "sand", HE_PALETTE.mapSand, HE_PALETTE.mapLand], "fill-opacity": 0.82 } },
          { id: "base-water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": HE_PALETTE.mapWater } },
          { id: "blue-marble-overview", type: "raster", source: "blueMarbleOverview", minzoom: 0.75, maxzoom: 3.2, paint: { "raster-opacity": 0.96, "raster-fade-duration": 0 } },
          { id: "season-spring", type: "raster", source: "seasonSpring", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "season-summer", type: "raster", source: "seasonSummer", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "season-autumn", type: "raster", source: "seasonAutumn", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "season-winter", type: "raster", source: "seasonWinter", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "terrain-shading", type: "hillshade", source: "terrainSource", layout: {visibility:"none"}, paint: { "hillshade-exaggeration": efficientRendering ? 0.38 : 0.55, "hillshade-shadow-color": "#081018", "hillshade-highlight-color": "#e8f2d0", "hillshade-accent-color": "#5e7544" } },
          { id: "terrain-contours", type: "line", source: "terrainContours", minzoom: 8, layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": HE_PALETTE.accent, "line-opacity": 0.78, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.65, 14, 1.35] } },
          { id: "admin-boundaries", type: "line", source: "openmaptiles", "source-layer": "boundary", minzoom: 2, layout: { visibility: "none" }, filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": HE_PALETTE.mapBoundary, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 1.15], "line-dasharray": [3, 2] } },
          { id: "roads-casing", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 7, layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, filter: ["!in", ["get", "class"], ["literal", ["rail", "ferry"]]], paint: { "line-color": "rgba(7,14,16,.72)", "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 7, 1.2, 13, 4.8, 17, 15] } },
          { id: "roads", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 7, layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, filter: ["!in", ["get", "class"], ["literal", ["rail", "ferry"]]], paint: { "line-color": ["match", ["get", "class"], ["motorway", "trunk"], HE_PALETTE.mapRoadTrunk, ["primary", "secondary"], HE_PALETTE.mapRoadPrimary, ["path", "track"], HE_PALETTE.accent, HE_PALETTE.mapRoad], "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.38, 11, 0.72, 15, 0.9], "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 7, 0.45, 13, 2.5, 17, 9] } },
          { id: "building-footprints", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 13, layout: { visibility: "none" }, filter: ["!=", ["get", "hide_3d"], true], paint: { "fill-color": "rgba(220,230,224,.64)", "fill-outline-color": "rgba(20,30,31,.55)" } },
          { id: "city-buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13.7, layout: { visibility: "none" }, filter: ["!=", ["get", "hide_3d"], true], paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, HE_PALETTE.mapBuilding, 25, "#cbd2cd", 80, "#e9e1cf", 180, "#f2c989"], "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.82, "fill-extrusion-vertical-gradient": true } },
          { id: "road-labels", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", minzoom: 10, layout: { visibility: "none", "symbol-placement": "line", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 16, 13], "text-letter-spacing": 0.04 }, paint: { "text-color": HE_PALETTE.mapRoadLabel, "text-halo-color": "rgba(3,7,10,.88)", "text-halo-width": 1.35 } },
          { id: "water-labels", type: "symbol", source: "openmaptiles", "source-layer": "water_name", minzoom: 4, layout: { visibility: "none", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 13] }, paint: { "text-color": "#89d9ff", "text-halo-color": "rgba(2,9,16,.9)", "text-halo-width": 1.4 } },
          { id: "peak-labels", type: "symbol", source: "openmaptiles", "source-layer": "mountain_peak", minzoom: 8, layout: { visibility: "none", "text-field": ["concat", "▲ ", LOCALIZED_NAME, ["case", ["has", "ele"], ["concat", "  ", ["to-string", ["get", "ele"]], "m"], ""]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 0.7], "text-allow-overlap": false }, paint: { "text-color": "#f6f8f3", "text-halo-color": "rgba(3,8,9,.92)", "text-halo-width": 1.5 } },
          { id: "poi-labels", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 12, layout: { visibility: "none", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 0.7], "text-optional": true }, filter: ["in", ["get", "class"], ["literal", ["park", "attraction", "museum", "lodging", "hospital"]]], paint: { "text-color": HE_PALETTE.accent, "text-halo-color": "rgba(3,8,9,.94)", "text-halo-width": 1.4 } },
          { id: "place-labels", type: "symbol", source: "openmaptiles", "source-layer": "place", minzoom: 2, layout: { visibility: "none", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": ["match", ["get", "class"], "country", 15, "state", 13, "city", 13, "town", 11, 10], "text-allow-overlap": false, "text-padding": 5 }, paint: { "text-color": HE_PALETTE.mapLabel, "text-halo-color": "rgba(2,6,9,.92)", "text-halo-width": 1.8 } },
        ],
        // Globe projection and raster DEM can tear on Safari when the whole planet is visible.
        // Terrain is enabled below only after a route is opened, where its local relief is useful.
      } as StyleSpecification,
    });

    loadingTimerRef.current = window.setTimeout(() => setMapLoading(false), 2600);

    const flatViewControl = {
      onAdd() {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl maplibregl-ctrl-group flat-view-control";
        const button = document.createElement("button");
        button.type = "button";
        button.title = "恢复平面视角";
        button.setAttribute("aria-label", "恢复平面视角");
        button.innerHTML = '<span aria-hidden="true">▼</span>';
        button.addEventListener("click", () => {
          map.stop();
          setCity3DActive(false);
          map.easeTo({ pitch: 0, bearing: 0, duration: lowPowerRef.current ? 180 : 360, essential: true });
        });
        container.appendChild(button);
        return container;
      },
      onRemove() { document.querySelector(".flat-view-control")?.remove(); },
    };
    map.addControl(flatViewControl, "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("style.load", () => {
      map.setProjection({ type: "globe" });
      mapReadyRef.current = true;
    });

    map.on("error", (event) => {
      const mapError = event as unknown as { sourceId?: string; error?: { message?: string } };
      if (mapError.sourceId?.startsWith("season")) return;
      console.warn("地图资源错误", mapError.sourceId ?? "unknown", mapError.error?.message ?? "未提供错误详情");
      setMapMessage("部分地图资源暂时无法加载；路线档案、筛选和天气信息仍可继续使用。请检查网络后重试。");
    });

    map.on("load", () => {
      setMapMessage("");
      const firstRoute=currentRoutesRef.current[0];
      map.addSource("active-route", { type: "geojson", data: featureCollection(firstRoute) });
      map.addSource("active-area", { type: "geojson", data: areaCollection(firstRoute) });
      map.addSource("route-mask", { type: "geojson", data: maskCollection(firstRoute) });
      map.addLayer({ id: "area-mask", type: "fill", source: "route-mask", layout: { visibility: "none" }, paint: { "fill-color": "#01040b", "fill-opacity": 0.52 } });
      map.addLayer({ id: "area-fill", type: "fill", source: "active-area", layout: { visibility: "none" }, paint: { "fill-color": HE_PALETTE.accent, "fill-opacity": 0.1 } });
      map.addLayer({ id: "area-outline-glow", type: "line", source: "active-area", layout: { visibility: "none" }, paint: { "line-color": HE_PALETTE.accent, "line-width": 9, "line-opacity": 0.28, "line-blur": 4 } });
      map.addLayer({ id: "area-outline", type: "line", source: "active-area", layout: { visibility: "none" }, paint: { "line-color": HE_PALETTE.accent, "line-width": 2.2, "line-opacity": 0.95 } });
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "active-route",
        layout: { visibility: "none" },
        paint: { "line-color": HE_PALETTE.accent, "line-width": 10, "line-opacity": 0.32, "line-blur": 4 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "active-route",
        layout: { visibility: "none" },
        paint: { "line-color": HE_PALETTE.accent, "line-width": 4.2 },
      });
    });
    map.on("idle", () => {
      if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
      setMapLoading(false);
    });

    const catalogMarkers = new Map<string, Marker>();
    const syncViewportRoutes = () => {
      const markerBounds = map.getBounds();
      const markerRoutes = currentRoutesRef.current.filter(route => map.getZoom() < 3 || markerBounds.contains(route.center)).slice(0,400);
      const desired = new Set(markerRoutes.map(route=>route.id));
      catalogMarkers.forEach((marker,id)=>{if(!desired.has(id)){marker.remove();catalogMarkers.delete(id);markerElements.delete(id);}});
      markerRoutes.forEach((route) => {
        if (catalogMarkers.has(route.id)) return;
      const button = document.createElement("button");
      button.className = route.id === activeIdRef.current ? "route-marker selected" : "route-marker";
      button.style.setProperty("--marker-color", STATUS_COLORS[route.status]);
      button.setAttribute("aria-label", `查看${route.name}`);
      button.innerHTML = `<span></span>`;
      button.addEventListener("click", () => {
        selectRoute(route.id);
      });
      markerElements.set(route.id, button);
      const marker = new maplibregl.Marker({ element: button, anchor: "bottom" }).setLngLat(route.center).addTo(map);
      setRouteMarkerSelected(button, route.id === activeIdRef.current);
      catalogMarkers.set(route.id, marker);
      markers.push(marker);
    });
      markers.splice(0,markers.length,...catalogMarkers.values());
      const center = map.getCenter();
      setViewportRegion(getRegionLabel([center.lng, center.lat]));
      if (map.getZoom() < 3) {
        setViewportRouteIds(currentRoutesRef.current.map((route) => route.id));
        return;
      }
      const bounds = map.getBounds();
      setViewportRouteIds(currentRoutesRef.current.filter((route) => bounds.contains(route.center)).map((route) => route.id));
    };
    syncViewportRoutesRef.current=syncViewportRoutes;
    map.on("moveend", syncViewportRoutes);
    map.on("load", syncViewportRoutes);



      mapRef.current = map;
    })();

    return () => {
      disposed = true;
      syncViewportRoutesRef.current=()=>{};
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      markerElements.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
      document.documentElement.classList.remove("low-power");
    };
  }, [selectRoute]);

  useEffect(() => {
    markerElementsRef.current.forEach((element, routeId) => {
      setRouteMarkerSelected(element, routeId === selectedRouteId);
    });
  }, [selectedRouteId]);

  useEffect(() => {
    const visibleIds = new Set(visibleRoutes.map((route) => route.id));
    markerElementsRef.current.forEach((element, routeId) => {
      element.hidden = !visibleIds.has(routeId);
    });
  }, [visibleRoutes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateView = () => {
      const source = map.getSource("active-route") as GeoJSONSource | undefined;
      source?.setData(featureCollection(activeRoute));
      const areaSource = map.getSource("active-area") as GeoJSONSource | undefined;
      const maskSource = map.getSource("route-mask") as GeoJSONSource | undefined;
      areaSource?.setData(areaCollection(activeRoute));
      maskSource?.setData(maskCollection(activeRoute));
      const focusLayers = ["area-mask", "area-fill", "area-outline-glow", "area-outline", "route-glow", "route-line"];
      const setFocusVisible = (visible: boolean) => focusLayers.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"));
      if (mapView === "globe") {
        setFocusVisible(false);
        map.setLayoutProperty("basemap", "visibility", "visible");
        map.setProjection({ type: "globe" });
        map.flyTo({ center: [105, 28], zoom: 2, pitch: 8, bearing: -8, curve: 1.15, duration: lowPowerRef.current ? 500 : 900, easing: (t) => t * t * (3 - 2 * t), essential: true });
        return;
      }
      setFocusVisible(activeRoute.trackMode !== "不展示轨迹");
      map.setLayoutProperty("basemap", "visibility", "visible");
      map.flyTo({ center: activeRoute.center, zoom: 12, pitch: lowPowerRef.current ? 42 : 52, bearing: -24, curve: 1.35, duration: lowPowerRef.current ? 700 : 1250, easing: (t) => t * t * (3 - 2 * t), essential: true });
    };
    if (mapReadyRef.current) updateView();
    else map.once("style.load", updateView);
  }, [activeRoute, globeResetToken, mapView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateTerrain = () => {
      const terrainEnabled = (terrain || contours) && mapView === "route";
      const exaggeration = lowPowerRef.current ? 1.25 : 1.65;
      if(map.getLayer("terrain-shading"))map.setLayoutProperty("terrain-shading","visibility",terrain&&mapView==="route"?"visible":"none");
      map.setTerrain(terrainEnabled ? { source: "terrainSource", exaggeration } : null);
    };
    if (map.getSource("terrainSource")) updateTerrain();
    else map.once("load", updateTerrain);
  }, [mapView, terrain, contours]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let active = true;
    let lastViewport = "";
    let initialTimer = 0;
    const source = () => map.getSource("terrainContours") as GeoJSONSource | undefined;
    const empty: TerrainContours = { type: "FeatureCollection", features: [] };

    const update = () => {
      if (!active || !map.getLayer("terrain-contours") || !source()) return;
      const target = source();
      if (!target) return;
      if (!contours || mapView !== "route") {
        map.setLayoutProperty("terrain-contours", "visibility", "none");
        if (lastViewport !== "hidden") target.setData(empty);
        setContourMessage("");
        lastViewport = "hidden";
        return;
      }
      map.setLayoutProperty("terrain-contours", "visibility", "visible");
      if (map.getZoom() < 8) {
        if (lastViewport !== "low-zoom") target.setData(empty);
        setContourMessage("请放大到路线区域后查看等高线。");
        lastViewport = "low-zoom";
        return;
      }
      if (!map.areTilesLoaded()) return;
      const bounds = map.getBounds().toArray().flat().map((value) => Number(value).toFixed(3));
      const signature = [map.getZoom().toFixed(2), map.getPitch().toFixed(0), map.getBearing().toFixed(0), map.getContainer().clientWidth, map.getContainer().clientHeight, ...bounds].join(":");
      if (signature === lastViewport) return;
      const lowPower = lowPowerRef.current;
      const columns = lowPower ? 24 : 36;
      const rows = lowPower ? 18 : 28;
      const zoom = map.getZoom();
      const interval = zoom >= 14 ? 10 : zoom >= 12 ? 20 : zoom >= 10 ? 50 : 100;
      const exaggeration = lowPower ? 1.25 : 1.65;
      const data = buildTerrainContours(map, columns, rows, interval, exaggeration);
      lastViewport = signature;
      target.setData(data);
      setContourMessage(data.features.length ? `生成 ${data.features.length} 个高程级别；基于屏幕网格抽样，仅供地形参考，不用于测绘或导航。` : "当前视野的高程数据暂不可用，未显示等高线。");
    };

    const onIdle = () => update();
    const onMoveEnd = () => update();
    map.on("idle", onIdle);
    map.on("moveend", onMoveEnd);
    initialTimer = window.setTimeout(update, 700);
    update();
    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      map.off("idle", onIdle);
      map.off("moveend", onMoveEnd);
    };
  }, [contours, mapView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateMapDetails = () => {
      MAP_DETAIL_LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", mapDetails ? "visible" : "none"));
      BUILDING_LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
      if (city3DActive) {
        if (map.getLayer("city-buildings-3d")) map.setLayoutProperty("city-buildings-3d", "visibility", "visible");
      } else if (mapDetails) {
        const buildingLayer = lowPowerRef.current ? "building-footprints" : "city-buildings-3d";
        if (map.getLayer(buildingLayer)) map.setLayoutProperty(buildingLayer, "visibility", "visible");
      }
    };
    if (map.getLayer("place-labels")) updateMapDetails();
    else map.once("load", updateMapDetails);
  }, [city3DActive, mapDetails]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateSeason = () => {
      if (!map.getLayer("basemap")) return;
      // NASA's raster tiles show visible seams on the low-zoom globe projection in Safari.
      // Keep the complete-earth overview on the public vector basemap; show a selected
      // season only while inspecting a route at regional scale.
      const showSeason = seasonOverlayEnabled && mapView === "route";
      SEASON_LAYER_IDS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", showSeason && id === activeSeason.layerId ? "visible" : "none"));
      map.setPaintProperty(activeSeason.layerId, "raster-saturation", activeSeason.saturation);
      map.setPaintProperty(activeSeason.layerId, "raster-contrast", activeSeason.contrast);
      map.setPaintProperty(activeSeason.layerId, "raster-brightness-max", activeSeason.brightness);
      map.setPaintProperty(activeSeason.layerId, "raster-hue-rotate", activeSeason.hue);
    };
    if (map.getLayer("basemap")) updateSeason();
    else map.once("load", updateSeason);
  }, [activeSeason, mapView, seasonOverlayEnabled]);

  function locateUser() {
    if (!window.isSecureContext) {
      setMapMessage("iPhone 仅允许 HTTPS 页面读取定位；当前局域网 HTTP 地址不能请求位置。请改用上线前 HTTPS 验收地址。");
      return;
    }
    if (!navigator.geolocation) {
      setMapMessage("当前浏览器不支持定位；你仍可以拖动地球选择路线。");
      return;
    }
    setLocating(true);
    setMapMessage("正在请求当前位置…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void (async () => {
          setLocating(false);
          setCity3DActive(false);
          setDetailOpen(false);
          const map = mapRef.current;
          if (!map) {
            setMapMessage("地图尚未准备完成，请稍后再试。");
            return;
          }
          const maplibregl = await import("maplibre-gl");
          const markerElement = document.createElement("span");
          markerElement.className = "user-location-marker";
          markerElement.setAttribute("aria-label", "我的当前位置");
          userMarkerRef.current?.remove();
          userMarkerRef.current = new maplibregl.Marker({ element: markerElement }).setLngLat([coords.longitude, coords.latitude]).addTo(map);
          map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 12, pitch: 42, bearing: 0, duration: 1500, essential: true });
          setMapMessage(`已定位到当前位置，系统报告精度约 ${Math.max(1, Math.round(coords.accuracy))} 米。`);
        })();
      },
      (error) => {
        setLocating(false);
        const message = error.code === error.PERMISSION_DENIED
          ? "定位权限未开启：请在 iPhone 的 Safari 网站设置中允许位置访问后重试。"
          : error.code === error.TIMEOUT
            ? "定位超时：请确认系统定位服务已开启，并到开阔处重试。"
            : "暂时无法取得位置：请检查系统定位服务和网络后重试。";
        setMapMessage(message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  const showGlobe = useCallback(() => {
    startMapLoading();
    setCity3DActive(false);
    setMapView("globe");
    setGlobeResetToken((value) => value + 1);
    setDetailOpen(false);
  }, [startMapLoading]);

  function showCity3D() {
    if (city3DActive) {
      showGlobe();
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    startMapLoading();
    setCity3DActive(true);
    setDetailOpen(false);
    ["area-mask", "area-fill", "area-outline-glow", "area-outline", "route-glow", "route-line"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
    map.flyTo({ center: [113.625, 34.747], zoom: lowPowerRef.current ? 14.5 : 15.6, pitch: lowPowerRef.current ? 52 : 68, bearing: -28, curve: 1.35, duration: lowPowerRef.current ? 900 : 1800, easing: (t) => t * t * (3 - 2 * t), essential: true });
  }

  function openHub(tab: HubTab) {
    setHubTab(tab);
    setHubOpen(true);
  }

  const closeHub = useCallback(() => {
    setHubOpen(false);
    setLayer("routes");
    setDetailOpen(false);
    setPanelOpen(true);
  }, []);

  async function installPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const resetFilters = useCallback(() => {
    setStatus("全部");
    setSeasonFilter("全部");
    setPackFilter("全部");
    setOvernightFilter("全部");
    setSurfaceFilter("全部");
    setQuery("");
  }, []);

  const focusActiveRoute = useCallback(() => {
    startMapLoading();
    setCity3DActive(false);
    setMapView("route");
    setDetailOpen(true);
  }, [startMapLoading]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select");
      if (event.key === "Escape") {
        if (gearOpen) return setGearOpen(false);
        if (hubOpen) return closeHub();
        if (detailOpen) return setDetailOpen(false);
        return;
      }
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key.toLowerCase() === "g") showGlobe();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeHub, detailOpen, gearOpen, hubOpen, showGlobe]);

  return (
    <main className={`app-shell ${panelOpen || detailOpen ? "map-controls-hidden" : ""}`}>
      <div className="space-backdrop" aria-hidden="true" />
      <div ref={mapContainer} className={`earth-map ${mapLoading ? "loading" : "ready"}`} aria-label="徒步路线 3D 地球" />
      <div className={`map-loading ${mapLoading ? "visible" : ""}`} aria-live="polite" aria-hidden={!mapLoading}><Globe2 size={25} /><span>{mapView === "globe" ? "正在构建立体地球" : "正在展开立体路线"}</span><small>底图与路线资料加载中；地形和季节影像需单独开启</small></div>
      <div className="map-vignette" />
      {!isOnline && <div className="offline-banner" role="status"><WifiOff size={15} />当前处于离线状态：可查看已缓存页面，本次天气和远程地图不能保证更新。</div>}
      {webUpdateReady ? <div className="app-message glass" role="status"><span>网页有新版本。保存当前输入或记录后，可刷新加载更新。</span><div className="app-update-actions"><button className="update-apply-button" onClick={() => window.location.reload()}>保存后刷新</button><button className="update-dismiss-button" onClick={() => setWebUpdateReady(false)}>稍后</button></div></div> : mapMessage && <div className="app-message glass" role="status"><span>{mapMessage}</span><button onClick={() => setMapMessage("")} aria-label="关闭提示"><X size={15} /></button></div>}

      <header className="topbar glass">
        <Link className="brand" href="/" aria-label="徒步地球首页">
          <span className="brand-mark"><Mountain size={20} /></span>
          <span><b>徒步地球</b><small>全球徒步路线</small></span>
        </Link>
        <nav className="layer-switch" aria-label="地球图层">
          <button className={layer === "routes" ? "active" : ""} onClick={() => setLayer("routes")}><RouteIcon size={16} />徒步路线</button>
          <button className={layer === "news" ? "active" : ""} onClick={() => { setLayer("news"); openHub("景点新闻"); }}><Newspaper size={16} />官方户外公告<span>NPS</span></button>
        </nav>
        <div className="top-actions">
          {installPrompt && <button className="icon-button" onClick={installPwa} aria-label="安装徒步地球" title="安装为桌面应用"><Download size={18} /></button>}
          <a className="icon-button offline-map-topbar-link" href="/offline-map" aria-label="离线地图" title="离线地图"><Download size={18} /></a>
          <a className="download-center-button" href="/download" aria-label="多端下载中心" title="多端下载"><Download size={15} />多端下载</a>
          <button className="icon-button" onClick={showGlobe} aria-label="返回完整3D地球" title="返回完整3D地球"><Globe2 size={19} /></button>
          <button className={`icon-button ${locating ? "active" : ""}`} aria-pressed={locating} disabled={locating} onClick={locateUser} aria-label={locating ? "正在定位" : "定位到我"}><LocateFixed size={19} /></button>
          <button className="primary-button" onClick={() => openHub("社区约伴")}>发起约伴 <ChevronRight size={17} /></button>
        </div>
      </header>

      <nav className="main-navigation glass" aria-label="徒步地球主导航"><Link href="/">地球发现</Link><a href="/client?tab=companion">约伴</a><a href="/client?tab=navigation">导航</a><a href="/client?tab=track">轨迹</a><a href="/client?tab=my">我的</a><a href="/download">下载</a></nav>
      <nav className="release-links glass" aria-label="发布与法律信息">
        <a href="/download">多端下载</a>
        <a href="/release">发布状态</a>
        <a href="/sources">数据来源</a>
        <a href="/privacy">隐私</a>
        <a href="/terms">规则</a>
        <a href="/report">举报与帮助</a>
      </nav>

      {layer === "news" && (
        <section className="future-layer glass" aria-label="官方户外公告">
          <Newspaper size={22} />
          <div className="future-layer-content">
            <div className="future-layer-heading"><div><b>官方户外公告</b><p>展示已接入地区过去90天内的官方标题与原文链接；过期条目自动撤下，不代表全球全部公告，也不自动决定路线开放状态。</p></div><button className="notice-refresh" onClick={()=>setNoticeReload((value)=>value+1)} disabled={noticeState==="loading"}>{noticeState==="loading"?"更新中…":"刷新"}</button></div>
            <small className="notice-updated">采集快照：{noticeUpdatedAt||"尚未取得"} · {noticeState==="available"?`${officialNotices.length} 条索引`:noticeState==="loading"?"正在读取":officialNotices.length?`更新失败，保留上次 ${officialNotices.length} 条快照`:"读取失败；可重试"}</small>
            {noticeState==="available"&&noticeCollectionStatus?.state!=="success"&&noticeCollectionStatus&&<small className="notice-updated">{noticeCollectionStatus.state==="all-attempted-sources-failed"?"本次尝试的公告源暂不可用；当前仅显示复核后仍在有效期内的缓存条目。":"部分公告源暂时不可用；当前缓存条目已按有效期复核。"}</small>}
            <div className="official-notice-list" aria-live="polite">
              {noticeState==="loading"&&!officialNotices.length&&<p>正在读取官方公告目录…</p>}
              {noticeState==="unavailable"&&!officialNotices.length&&<p>当前无法取得公告目录。请稍后重试；核对具体路线时，请从路线详情打开属地管理部门的官方来源。此索引不覆盖所有地区。</p>}
              {officialNotices.slice(0,8).map((item)=><article key={item.id}><small>{item.sourceLabel} · {item.region} · {item.publishedAt?new Date(item.publishedAt).toLocaleDateString("zh-CN"):"日期未提供"}</small><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></article>)}
              {noticeState==="available"&&!officialNotices.length&&<p>官方快照中暂无公告条目。</p>}
            </div>
          </div>
          <button className="future-layer-close" onClick={() => setLayer("routes")} aria-label="关闭公告图层"><X size={17} /></button>
        </section>
      )}

      <aside className={`route-browser glass ${panelOpen ? "open" : "closed"} ${filtersOpen ? "filters-open" : ""} ${detailOpen ? "detail-hidden" : ""}`}>
        <div className="browser-head">
          <div><span className="eyebrow">EXPLORE THE EARTH</span><h1>今天，走哪一条？</h1></div>
          <button className="mobile-close" onClick={() => setPanelOpen(false)} aria-label="关闭路线列表"><X size={20} /></button>
        </div>

        <a href="/client" style={{ display: "block", color: HE_PALETTE.accent, padding: "12px 16px", fontSize: 14 }}>账号、轨迹、组队与社区 →</a>

        <div className="search-row">
          <label className="search-box"><Search size={17} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜路线、地区或风景" aria-label="搜索路线、地区或风景" /><kbd>/</kbd></label>
          <button className={`filter-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={18} /><span>筛选</span></button>
        </div>

        <section className="online-catalog-search" aria-label="在线来源目录检索">
          <p>本机搜索覆盖已同步目录；在线检索覆盖当前来源快照。</p>
          <label>来源 <select value={searchSource} onChange={event=>setSearchSource(event.target.value as 'osm'|'usfs'|'hk'|'nzdoc'|'parkscanada'|'nsw-npws'|'england'|'wales'|'japan-tokai'|'scotland-argyll'|'ni-midulster'|'norfolk-prow'|'cambridgeshire-prow'|'nps-public-trails'|'usgs-trails'|'swisstopo-wanderwege'|'victoria-recreation-tracks'|'queensland-qpws-trails'|'taiwan-trails'|'korea-durunubi-trails')}><option value="osm">OpenStreetMap</option><option value="usfs">美国国家森林</option><option value="hk">香港官方步道</option><option value="nzdoc">新西兰环保部官方步道</option><option value="parkscanada">加拿大公园管理局</option><option value="nsw-npws">新南威尔士州公园步道</option><option value="england">英格兰国家步道</option><option value="wales">威尔士国家步道</option><option value="japan-tokai">日本环境省东海自然步道（待核验）</option><option value="scotland-argyll">苏格兰阿盖尔-比特核心步道</option><option value="ni-midulster">北爱尔兰米德阿尔斯特公共通行权</option><option value="norfolk-prow">英格兰诺福克公共通行权</option><option value="cambridgeshire-prow">英格兰剑桥郡公共通行权</option><option value="nps-public-trails">美国国家公园步道（NPS）</option><option value="usgs-trails">美国全国步道汇总（USGS）</option><option value="swisstopo-wanderwege">瑞士官方徒步网络（swisstopo）</option><option value="victoria-recreation-tracks">澳大利亚·维多利亚州官方步道</option><option value="queensland-qpws-trails">澳大利亚·昆士兰州官方步道</option><option value="taiwan-trails">台湾观光署官方步道（待核验）</option><option value="korea-durunubi-trails">韩国·DuruNubi 韩国环线步道（待核验）</option></select></label>
          <button disabled={currentOnlineSearch.loading} onClick={()=>void onlineSearch()}>{currentOnlineSearch.loading?'检索中…':'在线检索全部来源记录'}</button>
          <p role="status">{currentOnlineSearch.message}</p>
          {currentOnlineSearch.rows.map(route=><button key={route.id} onClick={()=>openOnlineRoute(route)}>{route.name} · {route.region} · 待核验{hasSourceNameReview(route)&&<small className="name-review-flag">名称待核对</small>}</button>)}
          {currentOnlineSearch.more&&<button disabled={currentOnlineSearch.loading} onClick={()=>void onlineSearch(true)}>继续读取在线结果</button>}
        </section>
        {filtersOpen && (
          <div className="filters">
            <div className="filter-panel-head"><div><b>筛选路线</b><span>设置完成后显示匹配路线</span></div><button onClick={() => setFiltersOpen(false)}>完成</button></div>
            <div className="filter-group"><span>路线状态</span><div>{(["全部", "开放中", "即将开放", "临时关闭", "永久关闭", "待核验"] as const).map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item}</button>)}</div></div>
            <div className="filter-group"><span>最佳季节</span><div>{(["全部", "春", "夏", "秋", "冬"] as const).map((item) => <button key={item} className={seasonFilter === item ? "active" : ""} onClick={() => setSeasonFilter(item)}>{item === "全部" ? item : `${item}季`}</button>)}</div></div>
            <div className="filter-group"><span>行程方式</span><div>{(["全部", "轻装", "重装", "待核验"] as const).map((item) => <button key={item} className={packFilter === item ? "active" : ""} onClick={() => setPackFilter(item)}>{item}</button>)}</div></div>
            <div className="filter-group"><span>夜宿方式</span><div>{(["全部", "营地", "住宿", "无过夜", "待核验"] as const).map((item) => <button key={item} className={overnightFilter === item ? "active" : ""} onClick={() => setOvernightFilter(item)}>{item === "营地" ? "自带帐篷" : item}</button>)}</div></div>
            <div className="filter-group"><span>路面与环境</span><div>{(["全部", "景区成熟", "未铺装", "待核验"] as const).map((item) => <button key={item} className={surfaceFilter === item ? "active" : ""} onClick={() => setSurfaceFilter(item)}>{item}</button>)}</div></div>
          </div>
        )}

        {!filtersOpen && <>
          <div className="browser-meta"><span>{viewportRegion} · 当前视野路线</span><span>{visibleRoutes.length} 条 <button className="reset-filters" onClick={resetFilters}>重置筛选</button></span></div>
          <div className="route-list">
            {visibleRoutes.slice(0,routeDisplayLimit).map((route) => (
              <button key={route.id} className={`route-card ${route.id === selectedRouteId ? "active" : ""}`} onClick={() => selectRoute(route.id)}>
                <span className="route-thumb" style={{ backgroundImage: `linear-gradient(180deg, transparent, rgba(4,10,7,.7)), url(${route.image})` }}>
                  <span className="status-dot" style={{ color: STATUS_COLORS[route.status] }}>{route.status}</span>
                </span>
                <span className="route-card-copy"><small><MapPin size={13} />{route.region}</small><b>{route.name}</b>{hasSourceNameReview(route)&&<small className="name-review-flag">名称待核对</small>}<span>{route.distance} · {route.duration} · {route.difficulty}</span></span>
              </button>
            ))}
            {visibleRoutes.length > routeDisplayLimit && <button onClick={()=>setRouteDisplayLimit(limit=>limit+50)}>加载更多路线（共 {visibleRoutes.length} 条）</button>}
            {!visibleRoutes.length && <div className="empty-routes"><Search size={24} /><b>当前没有匹配路线</b><span>可以重置筛选，或拖动地球扩大当前视野。</span><button onClick={resetFilters}>重置筛选</button></div>}
          </div>
          <p className="data-note">全球地球影像来自 <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/" target="_blank" rel="noreferrer">NASA Earth Observatory Blue Marble</a>（2004年6月历史合成，非实时）；路线列表是公开来源的发现档案，“待核验”不代表路线已开放、拥有通行许可或可用于导航。拖动或缩放地球后，会自动更新当前视野内的路线。目录每六小时自动刷新，切回前台时检查；失败后延迟重试。{catalogMessage}开放状态均须以属地公告为准。 <button className="notice-refresh" onClick={()=>catalogRefreshRef.current()} disabled={catalogRefreshing}>{catalogRefreshing?"更新中…":"刷新目录"}</button></p>
        </>}
      </aside>

      <section className={`route-detail glass ${detailOpen ? "open" : ""}`}>
        <button className="detail-close" onClick={() => setDetailOpen(false)} aria-label="收起详情"><X size={18} /></button>
        <div className="detail-image" style={{ backgroundImage: `linear-gradient(90deg, rgba(5,12,8,.8), rgba(5,12,8,.08)), url(${activeRoute.image})` }}>
          <span>{activeRoute.imageCredit}</span>
        </div>
        <RegionPhoto region={activeRoute.region} />
        <div className="detail-copy">
          <div className="detail-title"><div><span className="status-pill" style={{ color: STATUS_COLORS[activeRoute.status] }}>{activeRoute.status}</span><h2>{activeRoute.name}</h2><p><MapPin size={14} />{activeRoute.region}</p></div><button className="round-action" onClick={focusActiveRoute} aria-label="在地图中查看路线" title="在地图中查看路线"><Compass size={20} /></button></div>
          <p className="summary">{activeRoute.summary}</p>
          <section className="route-weather" aria-label="天气服务状态">
            <div className="archive-head"><span>天气服务</span><small>{weatherState.status === "loading" ? "正在核实…" : weatherState.status === "available" ? `预报时刻 ${weatherState.weather?.observedAt}` : "预报暂不可用"}</small></div>
            {weatherState.status === "available" && weatherState.weather ? <><div className="weather-grid"><b>{weatherState.weather.city} {weatherState.weather.temperature}</b><span>风力 {weatherState.weather.wind}</span><span>湿度 {weatherState.weather.humidity}</span><span>降水 {weatherState.weather.rain}</span></div><p>数据获取时间：{weatherState.weather.fetchedAt}（UTC）</p></> : <p>{weatherState.message ?? "正在确认天气接口是否已配置。"}</p>}
            {weatherState.providerNotice && <p role="status">{weatherState.providerNotice}</p>}
            <small>天气不能证明路线开放，也不能替代属地预警。{weatherSourceUrl ? <>查看 <a href={weatherSourceUrl} target="_blank" rel="noopener noreferrer">官方天气</a>；</> : null} 预报来自 MET Norway，按 <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> 转换展示。北欧/北极以外约为9公里网格、每天更新4次；复杂地形的风速可能无法反映山脊与山谷差异。本页按路线中心坐标查询，不使用海拔。</small>
          </section>
          <section className="route-archive">
            <div className="archive-head"><span>路线档案</span><small>{activeRoute.archive.checkedAt}</small></div>
            <ul>{activeRoute.archive.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
            <p><ShieldAlert size={14} /><b>风险提示</b>{activeRoute.archive.riskNotice}</p>
            <small>资料来源：{routeSourceUrl ? <a href={routeSourceUrl} target="_blank" rel="noopener noreferrer">{activeRoute.archive.source.label}</a> : activeRoute.archive.source.label}</small>
            <small className="route-validity-notice">{routeValidityNotice}</small>
          </section>
          <div className="guide-card">
            <Image src="/route-guide-original.png" width={72} height={72} alt="原创Q版徒步路线向导拿着地图" />
            <div><small>你的路线向导 · 原创默认形象</small><b>小陆</b><span>路线导航阶段将支持步行、乘车和抵达状态</span></div>
            <button disabled>自定义 · 后期</button>
          </div>
          <div className="stats">
            <div><RouteIcon size={17} /><span>距离<b>{activeRoute.distance}</b></span></div>
            <div><Mountain size={17} /><span>累计爬升<b>{activeRoute.ascent}</b></span></div>
            <div><CalendarDays size={17} /><span>建议用时<b>{activeRoute.duration}</b></span></div>
          </div>
          <div className="season-row"><span><Sparkles size={15} />最佳风景</span><b>{activeRoute.bestSeason}</b><div>{activeRoute.scenery.map((item) => <i key={item}>{item}</i>)}</div></div>
          <div className="detail-actions">
            <button onClick={focusActiveRoute} disabled={activeRoute.trackMode === "不展示轨迹"}>{activeRoute.trackMode === "不展示轨迹" ? "法规警示档案" : "查看地图轨迹"}</button>
            <button onClick={() => setGearOpen(true)}><Backpack size={15} />装备助手</button>
            <button onClick={() => openHub("社区约伴")}>留言与约伴</button>
          </div>
        </div>
      </section>

      {gearOpen && <section className="gear-panel glass open" aria-label="路线装备与注意事项">
        <div className="gear-head">
          <div><span className="eyebrow">RULE WORKFLOW · V1</span><h2>行前装备助手</h2><p>{activeRoute.name}</p></div>
          <button onClick={() => setGearOpen(false)} aria-label="关闭装备助手"><X size={18} /></button>
        </div>
        <div className="gear-controls">
          <label><span>计划出发日期</span><input type="date" value={departureDate} onChange={(event) => setDepartureDate(event.target.value)} /></label>
          <div><span>负重方式</span><div>{(["轻装", "中度", "重装"] as GearMode[]).map((item) => <button key={item} className={gearMode === item ? "active" : ""} onClick={() => setGearMode(item)}>{item}</button>)}</div></div>
        </div>
        <div className="gear-content">
          <article><h3><Backpack size={16} />建议装备清单</h3><ul>{gearAdvice.items.map((item) => <li key={item}>{item}</li>)}</ul></article>
          <article className="notice-list"><h3><CircleAlert size={16} />路线注意事项</h3><ul>{gearAdvice.notices.map((item) => <li key={item}>{item}</li>)}</ul></article>
        </div>
        <Suspense fallback={<p className="gear-footnote" role="status">正在加载本机照片识别…</p>}>
          <GearPhotoScan />
        </Suspense>
        <p className="gear-footnote">清单根据路线、季节、日期、路况、负重方式及可用的路线坐标天气预报生成；天气失效时不应用天气调整。坐标预报不能替代现场天气、属地预警或专业判断。照片候选仅供人工核对；论坛用户装备清单与语音识别尚未接入。</p>
      </section>}

      {hubOpen && (
        <Suspense fallback={<div className="hub-loading glass">正在打开本地功能中心…</div>}>
          <ProjectHub key={`${hubOpen}-${hubTab}`} open={hubOpen} route={activeRoute} initialTab={hubTab} onClose={closeHub} onSelectRoute={(id) => { selectRoute(id); closeHub(); }} routes={routes} />
        </Suspense>
      )}

      {mapView === "route" && <div className="focus-legend glass" aria-label="路线地图图例"><span><i className="area-key" />路线关注区域（示意）</span><span><i className="route-key" />具体徒步轨迹</span></div>}

      {!panelOpen && <button className="reopen-panel" onClick={() => setPanelOpen(true)}><RouteIcon size={18} />查看路线</button>}
      <div className="terrain-toggle glass">
        <button className={terrain ? "active" : ""} onClick={() => setTerrain((value) => !value)}><Mountain size={16} />{terrain ? "立体地形" : "开启地形"}</button>
        <button className={mapDetails ? "active" : ""} onClick={() => setMapDetails((value) => !value)}><Layers3 size={16} />{mapDetails ? "地名道路" : "开启标注"}</button>
        <button className={city3DActive ? "active" : ""} aria-pressed={city3DActive} onClick={showCity3D}><Building2 size={16} />{city3DActive ? "退出3D" : "城市3D"}</button>
        <button className={contours ? "active" : ""} aria-pressed={contours} disabled={mapView !== "route"} onClick={() => setContours((value) => !value)} title={mapView === "route" ? "从当前地形高程生成抽样等高线，仅供地形参考" : "打开路线后可查看地形等高线"}>参考等高线</button>
        {contours && contourMessage && <span className="terrain-note" role="status">{contourMessage}</span>}
      </div>
      <section className={`season-explorer glass ${detailOpen ? "detail-hidden" : ""}`} aria-label="全球季相探索">
        <div className="season-head">
          <span><SunMedium size={16} />全球季相探索<small>真实时相</small></span>
          <b>{activeSeason.label}</b>
        </div>
        <div className="season-track">
          <button className={!seasonOverlayEnabled ? "active" : ""} onClick={() => setSeasonOverlayEnabled(false)}><i>图</i><span>底图</span></button>
          {SEASONS.map((item) => <button key={item.id} className={seasonOverlayEnabled && season === item.id ? "active" : ""} onClick={() => { setSeason(item.id); setSeasonOverlayEnabled(true); }}><i>{item.id}</i><span>{item.label.slice(2)}</span></button>)}
        </div>
        <p>{activeSeason.hint} · NASA MODIS {seasonImageDates[activeSeason.id]} 北半球代表日影像，非实时；开放状态仍以官方公告为准。</p>
      </section>
      <nav className={`mobile-dock glass ${panelOpen ? "" : "panel-closed"}`} aria-label="主要功能">
        <button onClick={showGlobe}><Globe2 size={17} />地球</button>
        <button onClick={() => openHub("推荐")}><Sparkles size={17} />推荐</button>
        <button onClick={() => openHub("社区约伴")}><MessageCircle size={17} />社区</button>
        <button onClick={() => openHub("日记足迹")}><MapPin size={17} />足迹</button>
        <a href="/offline-map" aria-label="离线地图"><Download size={17} />地图</a>
        <a href="/download" aria-label="多端下载"><Download size={17} />下载</a>
      </nav>
    </main>
  );
}
