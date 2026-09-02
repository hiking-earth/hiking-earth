"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { GeoJSONSource, Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ROUTES, STATUS_COLORS, type HikingRoute, type OvernightStyle, type PackStyle, type RouteStatus, type Season, type SurfaceStyle } from "@/data/routes";
import type { HubTab } from "@/components/ProjectHub";
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

type GearMode = "轻装" | "中度" | "重装";
type WeatherState = { status: "loading" | "available" | "unavailable"; weather?: { city: string; temperature: string; wind: string; humidity: string; rain: string; observedAt: string }; message?: string; sourceUrl?: string };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const ProjectHub = lazy(() => import("@/components/ProjectHub").then((module) => ({ default: module.ProjectHub })));

const MAP_DETAIL_LAYERS = ["admin-boundaries", "roads-casing", "roads", "road-labels", "water-labels", "peak-labels", "poi-labels", "place-labels"];
const BUILDING_LAYERS = ["building-footprints", "city-buildings-3d"];
const SEASON_LAYER_IDS = ["season-spring", "season-summer", "season-autumn", "season-winter"] as const;
const LOCALIZED_NAME = ["coalesce", ["get", "name:zh-Hans"], ["get", "name:zh"], ["get", "name"], ["get", "name_en"]] as maplibregl.ExpressionSpecification;

function nasaSeasonTiles(date: string) {
  return [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`];
}

const SEASONS = [
  { id: "春", layerId: "season-spring", label: "春日花期", hint: "春季返青与融雪", date: "2025-04-15", saturation: 0.04, contrast: 0.05, brightness: 0.99, hue: 0 },
  { id: "夏", layerId: "season-summer", label: "盛夏秘境", hint: "盛夏植被与丰水期", date: "2025-07-15", saturation: 0.06, contrast: 0.06, brightness: 1, hue: 0 },
  { id: "秋", layerId: "season-autumn", label: "金秋层林", hint: "秋季植被与旱湿变化", date: "2025-10-15", saturation: 0.03, contrast: 0.08, brightness: 0.97, hue: 0 },
  { id: "冬", layerId: "season-winter", label: "冬日雪境", hint: "冬季积雪与低植被覆盖", date: "2025-01-15", saturation: 0, contrast: 0.08, brightness: 0.95, hue: 0 },
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

function buildGearAdvice(route: HikingRoute, mode: GearMode, departureDate: string) {
  const month = departureDate ? Number(departureDate.split("-")[1]) : null;
  const routeText = `${route.name}${route.region}${route.difficulty}${route.summary}${route.archive.riskNotice}${route.scenery.join("")}`;
  const isWetSeason = month !== null && month >= 5 && month <= 9;
  const isColdSeason = month !== null && (month <= 3 || month >= 11);
  const isHighAltitude = /高海拔|雪山|垭口/.test(routeText);
  const isRemote = route.surface === "未铺装" || /穿越|高风险/.test(routeText);
  const needsCamp = route.overnight === "营地" || mode === "重装";
  const items = new Set(["离线地图与充电宝", "头灯与备用电量", "饮水与应急能量食品", "基础急救包", "防晒与个人证件"]);

  if (mode === "轻装") ["15–25L 背包", "轻量防风雨外套", "速干层与防滑徒步鞋"].forEach((item) => items.add(item));
  if (mode === "中度") ["30–45L 背包", "保暖中层与备用袜", "登山杖", "背包防雨罩"].forEach((item) => items.add(item));
  if (mode === "重装") ["50–70L 背包", "承重徒步鞋与双杖", "炉头燃料与净水工具"].forEach((item) => items.add(item));
  if (needsCamp) ["适温睡袋", "帐篷与地钉", "隔潮垫", "营地照明"].forEach((item) => items.add(item));
  if (isWetSeason) ["冲锋衣裤", "防水袋", "备用干燥衣物"].forEach((item) => items.add(item));
  if (isColdSeason || isHighAltitude) ["保暖帽和手套", "保温层", "应急保温毯"].forEach((item) => items.add(item));

  const notices = ["出发前再次核验开放状态、天气、预约和属地公告。", "把路线、返回时间和紧急联系人留给未同行人员。"];
  if (isWetSeason) notices.push("降雨期避开沟谷、河道和陡坡；出现持续强降雨、山洪或滑坡预警时取消行程。");
  if (isHighAltitude) notices.push("安排高海拔适应和撤退点；出现明显不适时停止上升并及时下撤。");
  if (isRemote) notices.push("未铺装或偏远路段不要单独出行；预留导航冗余、通信方案和返程时间。");
  if (/四川|云南|新疆|西藏|森林/.test(routeText)) notices.push("野生动物活动信息须向保护区核实；食物密封、保持距离，防熊喷雾等用品需遵守运输与属地规定。");
  if (route.status !== "开放中") notices.unshift(`当前路线状态为“${route.status}”，本清单不代表允许进入或可以成行。`);

  return { items: [...items], notices };
}

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const mapReadyRef = useRef(false);
  const lowPowerRef = useRef(false);
  const loadingTimerRef = useRef<number | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const markerElementsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [activeId, setActiveId] = useState(ROUTES[0].id);
  const [status, setStatus] = useState<"全部" | RouteStatus>("全部");
  const [seasonFilter, setSeasonFilter] = useState<"全部" | Season>("全部");
  const [packFilter, setPackFilter] = useState<"全部" | PackStyle>("全部");
  const [overnightFilter, setOvernightFilter] = useState<"全部" | OvernightStyle>("全部");
  const [surfaceFilter, setSurfaceFilter] = useState<"全部" | SurfaceStyle>("全部");
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [terrain, setTerrain] = useState(true);
  const [mapDetails, setMapDetails] = useState(true);
  const [city3DActive, setCity3DActive] = useState(false);
  const [globeResetToken, setGlobeResetToken] = useState(0);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapMessage, setMapMessage] = useState("");
  const [layer, setLayer] = useState<"routes" | "news">("routes");
  const [season, setSeason] = useState<(typeof SEASONS)[number]["id"]>("秋");
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

  const visibleRoutes = useMemo(() => ROUTES.filter((route) => {
    const statusMatch = status === "全部" || route.status === status;
    const seasonMatch = seasonFilter === "全部" || route.bestSeasons.includes(seasonFilter);
    const packMatch = packFilter === "全部" || route.packStyle === packFilter;
    const overnightMatch = overnightFilter === "全部" || route.overnight === overnightFilter;
    const surfaceMatch = surfaceFilter === "全部" || route.surface === surfaceFilter;
    const textMatch = `${route.name}${route.region}${route.scenery.join("")}`.includes(query.trim());
    return statusMatch && seasonMatch && packMatch && overnightMatch && surfaceMatch && textMatch && viewportRouteIds.includes(route.id);
  }), [overnightFilter, packFilter, query, seasonFilter, status, surfaceFilter, viewportRouteIds]);

  const activeRoute = ROUTES.find((route) => route.id === activeId) ?? ROUTES[0];
  const activeSeason = SEASONS.find((item) => item.id === season) ?? SEASONS[2];
  const gearAdvice = useMemo(() => buildGearAdvice(activeRoute, gearMode, departureDate), [activeRoute, departureDate, gearMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadWeather() {
      if (!activeRoute.weatherCityId) {
        if (!cancelled) setWeatherState({ status: "unavailable", message: "该路线暂未登记官方天气城市编码，当前无法核实。" });
        return;
      }
      setWeatherState({ status: "loading" });
      try {
        const response = await fetch(`/api/weather?cityId=${activeRoute.weatherCityId}`);
        const payload = await response.json() as { weather?: WeatherState["weather"]; message?: string; sourceUrl?: string };
        if (cancelled) return;
        setWeatherState(response.ok && payload.weather ? { status: "available", weather: payload.weather, sourceUrl: payload.sourceUrl } : { status: "unavailable", message: payload.message, sourceUrl: payload.sourceUrl });
      } catch {
        if (!cancelled) setWeatherState({ status: "unavailable", message: "官方天气暂时无法核实。" });
      }
    }
    void loadWeather();
    return () => { cancelled = true; };
  }, [activeRoute.weatherCityId]);

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
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        setMapMessage("离线缓存初始化失败；在线浏览不受影响。");
      });
    }
    return () => {
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
    setGearMode((ROUTES.find((route) => route.id === routeId)?.packStyle ?? "轻装") as GearMode);
  }, [startMapLoading]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let disposed = false;
    const markerElements = markerElementsRef.current;

    void (async () => {
      // Keep the 3D engine out of the React/UI entry chunk. The loading panel
      // stays visible while the browser fetches MapLibre in parallel.
      const maplibregl = await import("maplibre-gl");
      if (disposed || !mapContainer.current || mapRef.current) return;
      const markers = markersRef.current;

    const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
    const compactTouchDevice = window.matchMedia("(max-width: 900px)").matches || navigator.maxTouchPoints > 1;
    const lowPowerHardware = deviceMemory <= 4 || navigator.hardwareConcurrency <= 4 || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const efficientRendering = compactTouchDevice || lowPowerHardware;
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
          satellite: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 18,
            attribution: "影像 © Esri、Maxar、Earthstar Geographics 与 GIS 用户社区",
          },
          seasonSpring: { type: "raster", tiles: nasaSeasonTiles("2025-04-15"), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          seasonSummer: { type: "raster", tiles: nasaSeasonTiles("2025-07-15"), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          seasonAutumn: { type: "raster", tiles: nasaSeasonTiles("2025-10-15"), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          seasonWinter: { type: "raster", tiles: nasaSeasonTiles("2025-01-15"), tileSize: 256, maxzoom: 9, attribution: "季节影像 © NASA Earth Observatory / GIBS（MODIS Terra）" },
          terrainSource: {
            type: "raster-dem",
            tiles: ["/terrain/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 0,
            encoding: "terrarium",
            attribution: "地形 © Mapzen / AWS 开放数据（本地低缩放回退）",
          },
          openmaptiles: {
            type: "vector",
            url: "https://tiles.openfreemap.org/planet",
            attribution: "地图 © OpenFreeMap / OpenMapTiles；数据 © OpenStreetMap 贡献者",
          },
        },
        layers: [
          { id: "ocean", type: "background", paint: { "background-color": "#071a35" } },
          { id: "satellite", type: "raster", source: "satellite", paint: { "raster-saturation": -0.02, "raster-contrast": 0.18, "raster-resampling": "linear" } },
          { id: "season-spring", type: "raster", source: "seasonSpring", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "season-summer", type: "raster", source: "seasonSummer", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "season-autumn", type: "raster", source: "seasonAutumn", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "season-winter", type: "raster", source: "seasonWinter", maxzoom: 9, layout: { visibility: "none" }, paint: { "raster-opacity": 0.96, "raster-fade-duration": efficientRendering ? 0 : 280 } },
          { id: "terrain-shading", type: "hillshade", source: "terrainSource", paint: { "hillshade-exaggeration": efficientRendering ? 0.38 : 0.55, "hillshade-shadow-color": "#081018", "hillshade-highlight-color": "#e8f2d0", "hillshade-accent-color": "#5e7544" } },
          { id: "admin-boundaries", type: "line", source: "openmaptiles", "source-layer": "boundary", minzoom: 2, layout: { visibility: "none" }, filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": "rgba(255,220,220,.72)", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 1.15], "line-dasharray": [3, 2] } },
          { id: "roads-casing", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 7, layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, filter: ["!in", ["get", "class"], ["literal", ["rail", "ferry"]]], paint: { "line-color": "rgba(7,14,16,.72)", "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 7, 1.2, 13, 4.8, 17, 15] } },
          { id: "roads", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 7, layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, filter: ["!in", ["get", "class"], ["literal", ["rail", "ferry"]]], paint: { "line-color": ["match", ["get", "class"], ["motorway", "trunk"], "#f1b45b", ["primary", "secondary"], "#ffe0a3", ["path", "track"], "#b8f36b", "#dce8df"], "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.38, 11, 0.72, 15, 0.9], "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 7, 0.45, 13, 2.5, 17, 9] } },
          { id: "building-footprints", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 13, layout: { visibility: "none" }, filter: ["!=", ["get", "hide_3d"], true], paint: { "fill-color": "rgba(220,230,224,.64)", "fill-outline-color": "rgba(20,30,31,.55)" } },
          { id: "city-buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13.7, layout: { visibility: "none" }, filter: ["!=", ["get", "hide_3d"], true], paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#98a69f", 25, "#cbd2cd", 80, "#e9e1cf", 180, "#f2c989"], "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.82, "fill-extrusion-vertical-gradient": true } },
          { id: "road-labels", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", minzoom: 10, layout: { visibility: "none", "symbol-placement": "line", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 16, 13], "text-letter-spacing": 0.04 }, paint: { "text-color": "#f6ead0", "text-halo-color": "rgba(3,7,10,.88)", "text-halo-width": 1.35 } },
          { id: "water-labels", type: "symbol", source: "openmaptiles", "source-layer": "water_name", minzoom: 4, layout: { visibility: "none", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 13] }, paint: { "text-color": "#89d9ff", "text-halo-color": "rgba(2,9,16,.9)", "text-halo-width": 1.4 } },
          { id: "peak-labels", type: "symbol", source: "openmaptiles", "source-layer": "mountain_peak", minzoom: 8, layout: { visibility: "none", "text-field": ["concat", "▲ ", LOCALIZED_NAME, ["case", ["has", "ele"], ["concat", "  ", ["to-string", ["get", "ele"]], "m"], ""]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 0.7], "text-allow-overlap": false }, paint: { "text-color": "#f6f8f3", "text-halo-color": "rgba(3,8,9,.92)", "text-halo-width": 1.5 } },
          { id: "poi-labels", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 12, layout: { visibility: "none", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 0.7], "text-optional": true }, filter: ["in", ["get", "class"], ["literal", ["park", "attraction", "museum", "lodging", "hospital"]]], paint: { "text-color": "#d9ffad", "text-halo-color": "rgba(3,8,9,.94)", "text-halo-width": 1.4 } },
          { id: "place-labels", type: "symbol", source: "openmaptiles", "source-layer": "place", minzoom: 2, layout: { visibility: "none", "text-field": LOCALIZED_NAME, "text-font": ["Noto Sans Regular"], "text-size": ["match", ["get", "class"], "country", 15, "state", 13, "city", 13, "town", 11, 10], "text-allow-overlap": false, "text-padding": 5 }, paint: { "text-color": "#f7f7f2", "text-halo-color": "rgba(2,6,9,.92)", "text-halo-width": 1.8 } },
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
        container.append(button);
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
      map.addSource("active-route", { type: "geojson", data: featureCollection(ROUTES[0]) });
      map.addSource("active-area", { type: "geojson", data: areaCollection(ROUTES[0]) });
      map.addSource("route-mask", { type: "geojson", data: maskCollection(ROUTES[0]) });
      map.addLayer({ id: "area-mask", type: "fill", source: "route-mask", layout: { visibility: "none" }, paint: { "fill-color": "#01040b", "fill-opacity": 0.52 } });
      map.addLayer({ id: "area-fill", type: "fill", source: "active-area", layout: { visibility: "none" }, paint: { "fill-color": "#57c7ff", "fill-opacity": 0.1 } });
      map.addLayer({ id: "area-outline-glow", type: "line", source: "active-area", layout: { visibility: "none" }, paint: { "line-color": "#4cc9ff", "line-width": 9, "line-opacity": 0.28, "line-blur": 4 } });
      map.addLayer({ id: "area-outline", type: "line", source: "active-area", layout: { visibility: "none" }, paint: { "line-color": "#bcecff", "line-width": 2.2, "line-opacity": 0.95 } });
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "active-route",
        layout: { visibility: "none" },
        paint: { "line-color": "#ff8a4c", "line-width": 10, "line-opacity": 0.32, "line-blur": 4 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "active-route",
        layout: { visibility: "none" },
        paint: { "line-color": "#ffb067", "line-width": 4.2 },
      });
    });
    map.on("idle", () => {
      if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
      setMapLoading(false);
    });

    const syncViewportRoutes = () => {
      const center = map.getCenter();
      setViewportRegion(getRegionLabel([center.lng, center.lat]));
      if (map.getZoom() < 3) {
        setViewportRouteIds(ROUTES.map((route) => route.id));
        return;
      }
      const bounds = map.getBounds();
      setViewportRouteIds(ROUTES.filter((route) => bounds.contains(route.center)).map((route) => route.id));
    };
    map.on("moveend", syncViewportRoutes);
    map.on("load", syncViewportRoutes);

    ROUTES.forEach((route) => {
      const button = document.createElement("button");
      button.className = "route-marker";
      button.style.setProperty("--marker-color", STATUS_COLORS[route.status]);
      button.setAttribute("aria-label", `查看${route.name}`);
      button.innerHTML = `<span></span>`;
      button.addEventListener("click", () => {
        selectRoute(route.id);
      });
      markerElements.set(route.id, button);
      markers.push(new maplibregl.Marker({ element: button, anchor: "bottom" }).setLngLat(route.center).addTo(map));
    });

      mapRef.current = map;
    })();

    return () => {
      disposed = true;
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
        map.setLayoutProperty("satellite", "visibility", "visible");
        map.setProjection({ type: "globe" });
        map.flyTo({ center: [105, 28], zoom: 2, pitch: 8, bearing: -8, curve: 1.15, duration: lowPowerRef.current ? 500 : 900, easing: (t) => t * t * (3 - 2 * t), essential: true });
        return;
      }
      setFocusVisible(activeRoute.trackMode !== "不展示轨迹");
      map.setLayoutProperty("satellite", "visibility", "visible");
      map.flyTo({ center: activeRoute.center, zoom: 13.2, pitch: lowPowerRef.current ? 48 : 60, bearing: -24, curve: 1.45, duration: lowPowerRef.current ? 1050 : 2200, easing: (t) => t * t * (3 - 2 * t), essential: true });
    };
    if (mapReadyRef.current) updateView();
    else map.once("style.load", updateView);
  }, [activeRoute, globeResetToken, mapView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateTerrain = () => {
      const terrainEnabled = terrain && mapView === "route";
      const exaggeration = lowPowerRef.current ? 1.25 : 1.65;
      map.setTerrain(terrainEnabled ? { source: "terrainSource", exaggeration } : null);
    };
    if (map.getSource("terrainSource")) updateTerrain();
    else map.once("load", updateTerrain);
  }, [mapView, terrain]);

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
      if (!map.getLayer("satellite")) return;
      // NASA's raster tiles show visible seams on the low-zoom globe projection in Safari.
      // Keep the complete-earth overview on the seamless satellite source; show a selected
      // season only while inspecting a route at regional scale.
      const showSeason = mapView === "route";
      SEASON_LAYER_IDS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", showSeason && id === activeSeason.layerId ? "visible" : "none"));
      map.setPaintProperty(activeSeason.layerId, "raster-saturation", activeSeason.saturation);
      map.setPaintProperty(activeSeason.layerId, "raster-contrast", activeSeason.contrast);
      map.setPaintProperty(activeSeason.layerId, "raster-brightness-max", activeSeason.brightness);
      map.setPaintProperty(activeSeason.layerId, "raster-hue-rotate", activeSeason.hue);
    };
    if (map.getLayer("satellite")) updateSeason();
    else map.once("load", updateSeason);
  }, [activeSeason, mapView]);

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
      <div className={`map-loading ${mapLoading ? "visible" : ""}`} aria-live="polite"><Globe2 size={25} /><span>{mapView === "globe" ? "正在构建立体地球" : "正在展开立体路线"}</span><small>{mapView === "globe" ? "卫星影像与高程数据加载中" : "区域边界、轨迹与高程加载中"}</small></div>
      <div className="map-vignette" />
      {!isOnline && <div className="offline-banner" role="status"><WifiOff size={15} />当前处于离线状态：可查看已缓存页面，本次天气和远程地图不能保证更新。</div>}
      {mapMessage && <div className="app-message glass" role="status"><span>{mapMessage}</span><button onClick={() => setMapMessage("")} aria-label="关闭提示"><X size={15} /></button></div>}

      <header className="topbar glass">
        <Link className="brand" href="/" aria-label="徒步地球首页">
          <span className="brand-mark"><Mountain size={20} /></span>
          <span><b>徒步地球</b><small>全球徒步路线</small></span>
        </Link>
        <nav className="layer-switch" aria-label="地球图层">
          <button className={layer === "routes" ? "active" : ""} onClick={() => setLayer("routes")}><RouteIcon size={16} />徒步路线</button>
          <button className={layer === "news" ? "active" : ""} onClick={() => { setLayer("news"); openHub("景点新闻"); }}><Newspaper size={16} />全球户外动态<span>框架版</span></button>
        </nav>
        <div className="top-actions">
          {installPrompt && <button className="icon-button" onClick={installPwa} aria-label="安装徒步地球" title="安装为桌面应用"><Download size={18} /></button>}
          <button className="icon-button" onClick={showGlobe} aria-label="返回完整3D地球" title="返回完整3D地球"><Globe2 size={19} /></button>
          <button className={`icon-button ${locating ? "active" : ""}`} aria-pressed={locating} disabled={locating} onClick={locateUser} aria-label={locating ? "正在定位" : "定位到我"}><LocateFixed size={19} /></button>
          <button className="primary-button" onClick={() => openHub("社区约伴")}>发起约伴 <ChevronRight size={17} /></button>
        </div>
      </header>

      <nav className="release-links glass" aria-label="发布与法律信息">
        <Link href="/release">发布状态</Link>
        <Link href="/sources">数据来源</Link>
        <Link href="/privacy">隐私</Link>
        <Link href="/terms">规则</Link>
      </nav>

      {layer === "news" && (
        <section className="future-layer glass">
          <Newspaper size={22} />
          <div><b>全球户外动态 · 已预留</b><p>未来可按行业、时间和重要度筛选，并把新闻发生地显示为地球锚点。</p></div>
          <button onClick={() => setLayer("routes")}><X size={17} /></button>
        </section>
      )}

      <aside className={`route-browser glass ${panelOpen ? "open" : "closed"} ${filtersOpen ? "filters-open" : ""} ${detailOpen ? "detail-hidden" : ""}`}>
        <div className="browser-head">
          <div><span className="eyebrow">EXPLORE THE EARTH</span><h1>今天，走哪一条？</h1></div>
          <button className="mobile-close" onClick={() => setPanelOpen(false)} aria-label="关闭路线列表"><X size={20} /></button>
        </div>

        <div className="search-row">
          <label className="search-box"><Search size={17} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜路线、地区或风景" aria-label="搜索路线、地区或风景" /><kbd>/</kbd></label>
          <button className={`filter-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={18} /><span>筛选</span></button>
        </div>

        {filtersOpen && (
          <div className="filters">
            <div className="filter-panel-head"><div><b>筛选路线</b><span>设置完成后显示匹配路线</span></div><button onClick={() => setFiltersOpen(false)}>完成</button></div>
            <div className="filter-group"><span>路线状态</span><div>{(["全部", "开放中", "即将开放", "临时关闭", "永久关闭", "待核验"] as const).map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item}</button>)}</div></div>
            <div className="filter-group"><span>最佳季节</span><div>{(["全部", "春", "夏", "秋", "冬"] as const).map((item) => <button key={item} className={seasonFilter === item ? "active" : ""} onClick={() => setSeasonFilter(item)}>{item === "全部" ? item : `${item}季`}</button>)}</div></div>
            <div className="filter-group"><span>行程方式</span><div>{(["全部", "轻装", "重装"] as const).map((item) => <button key={item} className={packFilter === item ? "active" : ""} onClick={() => setPackFilter(item)}>{item}</button>)}</div></div>
            <div className="filter-group"><span>夜宿方式</span><div>{(["全部", "营地", "住宿", "无过夜"] as const).map((item) => <button key={item} className={overnightFilter === item ? "active" : ""} onClick={() => setOvernightFilter(item)}>{item === "营地" ? "自带帐篷" : item}</button>)}</div></div>
            <div className="filter-group"><span>路面与环境</span><div>{(["全部", "景区成熟", "未铺装"] as const).map((item) => <button key={item} className={surfaceFilter === item ? "active" : ""} onClick={() => setSurfaceFilter(item)}>{item}</button>)}</div></div>
          </div>
        )}

        {!filtersOpen && <>
          <div className="browser-meta"><span>{viewportRegion} · 当前视野路线</span><span>{visibleRoutes.length} 条 <button className="reset-filters" onClick={resetFilters}>重置筛选</button></span></div>
          <div className="route-list">
            {visibleRoutes.map((route) => (
              <button key={route.id} className={`route-card ${route.id === activeId ? "active" : ""}`} onClick={() => selectRoute(route.id)}>
                <span className="route-thumb" style={{ backgroundImage: `linear-gradient(180deg, transparent, rgba(4,10,7,.7)), url(${route.image})` }}>
                  <span className="status-dot" style={{ color: STATUS_COLORS[route.status] }}>{route.status}</span>
                </span>
                <span className="route-card-copy"><small><MapPin size={13} />{route.region}</small><b>{route.name}</b><span>{route.distance} · {route.duration} · {route.difficulty}</span></span>
              </button>
            ))}
            {!visibleRoutes.length && <div className="empty-routes"><Search size={24} /><b>当前没有匹配路线</b><span>可以重置筛选，或拖动地球扩大当前视野。</span><button onClick={resetFilters}>重置筛选</button></div>}
          </div>
          <p className="data-note">拖动或缩放地球后，会自动更新当前视野内的路线。开放状态均须以属地公告为准。</p>
        </>}
      </aside>

      <section className={`route-detail glass ${detailOpen ? "open" : ""}`}>
        <button className="detail-close" onClick={() => setDetailOpen(false)} aria-label="收起详情"><X size={18} /></button>
        <div className="detail-image" style={{ backgroundImage: `linear-gradient(90deg, rgba(5,12,8,.8), rgba(5,12,8,.08)), url(${activeRoute.image})` }}>
          <span>{activeRoute.imageCredit}</span>
        </div>
        <div className="detail-copy">
          <div className="detail-title"><div><span className="status-pill" style={{ color: STATUS_COLORS[activeRoute.status] }}>{activeRoute.status}</span><h2>{activeRoute.name}</h2><p><MapPin size={14} />{activeRoute.region}</p></div><button className="round-action" onClick={focusActiveRoute} aria-label="在地图中查看路线" title="在地图中查看路线"><Compass size={20} /></button></div>
          <p className="summary">{activeRoute.summary}</p>
          <section className="route-weather" aria-label="官方天气实况">
            <div className="archive-head"><span>官方天气实况</span><small>{weatherState.status === "loading" ? "正在核实…" : weatherState.status === "available" ? `观测时间 ${weatherState.weather?.observedAt}` : "无法核实"}</small></div>
            {weatherState.status === "available" && weatherState.weather ? <div className="weather-grid"><b>{weatherState.weather.city} {weatherState.weather.temperature}</b><span>风力 {weatherState.weather.wind}</span><span>湿度 {weatherState.weather.humidity}</span><span>降水 {weatherState.weather.rain}</span></div> : <p>{weatherState.message ?? "正在读取中国天气网官方公开实况。"}</p>}
            <small>来源：{weatherState.sourceUrl ? <a href={weatherState.sourceUrl} target="_blank" rel="noreferrer">中国天气网官方公开实况</a> : "中国天气网官方公开实况"}；天气不代表路线开放许可。</small>
          </section>
          <section className="route-archive">
            <div className="archive-head"><span>路线档案</span><small>{activeRoute.archive.checkedAt}</small></div>
            <ul>{activeRoute.archive.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
            <p><ShieldAlert size={14} /><b>风险提示</b>{activeRoute.archive.riskNotice}</p>
            <small>资料来源：{activeRoute.archive.source.url ? <a href={activeRoute.archive.source.url} target="_blank" rel="noreferrer">{activeRoute.archive.source.label}</a> : activeRoute.archive.source.label}</small>
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
        <p className="gear-footnote">当前由路线、季节、日期、路况和负重规则生成；论坛用户清单、实时天气、语音与照片多模态将在后续接入。清单不能替代属地公告和专业领队判断。</p>
      </section>}

      {hubOpen && (
        <Suspense fallback={<div className="hub-loading glass">正在打开本地功能中心…</div>}>
          <ProjectHub key={`${hubOpen}-${hubTab}`} open={hubOpen} route={activeRoute} initialTab={hubTab} onClose={closeHub} onSelectRoute={(id) => { selectRoute(id); closeHub(); }} />
        </Suspense>
      )}

      {mapView === "route" && <div className="focus-legend glass" aria-label="路线地图图例"><span><i className="area-key" />路线关注区域（示意）</span><span><i className="route-key" />具体徒步轨迹</span></div>}

      {!panelOpen && <button className="reopen-panel" onClick={() => setPanelOpen(true)}><RouteIcon size={18} />查看路线</button>}
      <div className="terrain-toggle glass">
        <button className={terrain ? "active" : ""} onClick={() => setTerrain((value) => !value)}><Mountain size={16} />{terrain ? "立体地形" : "开启地形"}</button>
        <button className={mapDetails ? "active" : ""} onClick={() => setMapDetails((value) => !value)}><Layers3 size={16} />{mapDetails ? "地名道路" : "开启标注"}</button>
        <button className={city3DActive ? "active" : ""} aria-pressed={city3DActive} onClick={showCity3D}><Building2 size={16} />{city3DActive ? "退出3D" : "城市3D"}</button>
        <button disabled>等高线 · 下一阶段</button>
      </div>
      <section className={`season-explorer glass ${detailOpen ? "detail-hidden" : ""}`} aria-label="全球季相探索">
        <div className="season-head">
          <span><SunMedium size={16} />全球季相探索<small>真实时相</small></span>
          <b>{activeSeason.label}</b>
        </div>
        <div className="season-track">
          {SEASONS.map((item) => <button key={item.id} className={season === item.id ? "active" : ""} onClick={() => setSeason(item.id)}><i>{item.id}</i><span>{item.label.slice(2)}</span></button>)}
        </div>
        <p>{activeSeason.hint} · NASA MODIS {activeSeason.date} 北半球代表日影像，非实时；开放状态仍以官方公告为准。</p>
      </section>
      <nav className={`mobile-dock glass ${panelOpen ? "" : "panel-closed"}`} aria-label="主要功能">
        <button onClick={showGlobe}><Globe2 size={17} />地球</button>
        <button onClick={() => openHub("推荐")}><Sparkles size={17} />推荐</button>
        <button onClick={() => openHub("社区约伴")}><MessageCircle size={17} />社区</button>
        <button onClick={() => openHub("日记足迹")}><MapPin size={17} />足迹</button>
      </nav>
    </main>
  );
}
