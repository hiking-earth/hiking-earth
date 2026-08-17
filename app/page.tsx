"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ROUTES, STATUS_COLORS, type HikingRoute, type RouteStatus } from "@/data/routes";
import {
  CalendarDays,
  ChevronRight,
  Compass,
  LocateFixed,
  MapPin,
  Mountain,
  Newspaper,
  Route as RouteIcon,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  X,
} from "lucide-react";

const SEASONS = [
  { id: "春", label: "春日花期", hint: "山花、杜鹃与新绿", saturation: 0.14, contrast: 0.08, brightness: 0.98, hue: -5 },
  { id: "夏", label: "盛夏秘境", hint: "草甸、湖泊与长日照", saturation: 0.24, contrast: 0.1, brightness: 1, hue: 0 },
  { id: "秋", label: "金秋层林", hint: "彩林、云海与通透光线", saturation: 0.18, contrast: 0.16, brightness: 0.94, hue: 8 },
  { id: "冬", label: "冬日雪境", hint: "雪山、冰湖与低温风险", saturation: -0.38, contrast: 0.19, brightness: 0.86, hue: 0 },
] as const;

function featureCollection(route: HikingRoute) {
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: { id: route.id },
      geometry: { type: "LineString" as const, coordinates: route.path },
    }],
  };
}

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [activeId, setActiveId] = useState(ROUTES[0].id);
  const [status, setStatus] = useState<"全部" | RouteStatus>("全部");
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [terrain, setTerrain] = useState(true);
  const [layer, setLayer] = useState<"routes" | "news">("routes");
  const [season, setSeason] = useState<(typeof SEASONS)[number]["id"]>("秋");

  const visibleRoutes = useMemo(() => ROUTES.filter((route) => {
    const statusMatch = status === "全部" || route.status === status;
    const textMatch = `${route.name}${route.region}${route.scenery.join("")}`.includes(query.trim());
    return statusMatch && textMatch;
  }), [query, status]);

  const activeRoute = ROUTES.find((route) => route.id === activeId) ?? ROUTES[0];
  const activeSeason = SEASONS.find((item) => item.id === season) ?? SEASONS[2];

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      center: [103.8, 34.7],
      zoom: 2.3,
      minZoom: 1.25,
      maxZoom: 14,
      pitch: 18,
      bearing: -8,
      attributionControl: false,
      style: {
        version: 8,
        projection: { type: "globe" },
        sources: {
          satellite: {
            type: "raster",
            tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg"],
            tileSize: 256,
            attribution: "Sentinel-2 cloudless © EOX, Copernicus Sentinel data",
          },
          terrainSource: {
            type: "raster-dem",
            url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
            tileSize: 256,
          },
        },
        layers: [
          { id: "space", type: "background", paint: { "background-color": "#020806" } },
          { id: "satellite", type: "raster", source: "satellite", paint: { "raster-saturation": -0.08, "raster-contrast": 0.12 } },
          { id: "hillshade", type: "hillshade", source: "terrainSource", paint: { "hillshade-exaggeration": 0.4, "hillshade-shadow-color": "#071c13" } },
        ],
      } as maplibregl.StyleSpecification,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.setTerrain({ source: "terrainSource", exaggeration: 1.2 });
      map.addSource("active-route", { type: "geojson", data: featureCollection(ROUTES[0]) });
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "active-route",
        paint: { "line-color": "#b8f36b", "line-width": 8, "line-opacity": 0.22, "line-blur": 3 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "active-route",
        paint: { "line-color": "#eaffc7", "line-width": 3.5 },
      });
    });

    ROUTES.forEach((route) => {
      const button = document.createElement("button");
      button.className = "route-marker";
      button.style.setProperty("--marker-color", STATUS_COLORS[route.status]);
      button.setAttribute("aria-label", `查看${route.name}`);
      button.innerHTML = `<span></span>`;
      button.addEventListener("click", () => {
        setActiveId(route.id);
        setPanelOpen(true);
      });
      markersRef.current.push(new maplibregl.Marker({ element: button, anchor: "bottom" }).setLngLat(route.center).addTo(map));
    });

    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateRoute = () => {
      const source = map.getSource("active-route") as GeoJSONSource | undefined;
      source?.setData(featureCollection(activeRoute));
      map.flyTo({ center: activeRoute.center, zoom: 10.4, pitch: 62, bearing: -20, duration: 1500 });
    };
    if (map.isStyleLoaded()) updateRoute();
    else map.once("load", updateRoute);
  }, [activeRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setTerrain(terrain ? { source: "terrainSource", exaggeration: 1.2 } : null);
  }, [terrain]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateSeason = () => {
      map.setPaintProperty("satellite", "raster-saturation", activeSeason.saturation);
      map.setPaintProperty("satellite", "raster-contrast", activeSeason.contrast);
      map.setPaintProperty("satellite", "raster-brightness-max", activeSeason.brightness);
      map.setPaintProperty("satellite", "raster-hue-rotate", activeSeason.hue);
    };
    if (map.isStyleLoaded()) updateSeason();
    else map.once("load", updateSeason);
  }, [activeSeason]);

  function locateUser() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 8, duration: 1500 });
    });
  }

  return (
    <main className="app-shell">
      <div ref={mapContainer} className="earth-map" aria-label="徒步路线 3D 地球" />
      <div className="map-vignette" />

      <header className="topbar glass">
        <Link className="brand" href="/" aria-label="徒步地球首页">
          <span className="brand-mark"><Mountain size={20} /></span>
          <span><b>徒步地球</b><small>全球徒步路线</small></span>
        </Link>
        <nav className="layer-switch" aria-label="地球图层">
          <button className={layer === "routes" ? "active" : ""} onClick={() => setLayer("routes")}><RouteIcon size={16} />徒步路线</button>
          <button className={layer === "news" ? "active" : ""} onClick={() => setLayer("news")}><Newspaper size={16} />全球户外动态<span>规划中</span></button>
        </nav>
        <div className="top-actions">
          <button className="icon-button" onClick={locateUser} aria-label="定位到我"><LocateFixed size={19} /></button>
          <button className="primary-button">发起约伴 <ChevronRight size={17} /></button>
        </div>
      </header>

      {layer === "news" && (
        <section className="future-layer glass">
          <Newspaper size={22} />
          <div><b>全球户外动态 · 已预留</b><p>未来可按行业、时间和重要度筛选，并把新闻发生地显示为地球锚点。</p></div>
          <button onClick={() => setLayer("routes")}><X size={17} /></button>
        </section>
      )}

      <aside className={`route-browser glass ${panelOpen ? "open" : "closed"}`}>
        <div className="browser-head">
          <div><span className="eyebrow">EXPLORE THE EARTH</span><h1>今天，走哪一条？</h1></div>
          <button className="mobile-close" onClick={() => setPanelOpen(false)} aria-label="关闭路线列表"><X size={20} /></button>
        </div>

        <div className="search-row">
          <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜路线、地区或风景" /></label>
          <button className={`filter-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={18} /><span>筛选</span></button>
        </div>

        {filtersOpen && (
          <div className="filters">
            <span>开放状态</span>
            <div>{(["全部", "演示开放", "待官方核验", "季节性关闭"] as const).map((item) => (
              <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item}</button>
            ))}</div>
          </div>
        )}

        <div className="browser-meta"><span>中国首批演示路线</span><span>{visibleRoutes.length} 条</span></div>
        <div className="route-list">
          {visibleRoutes.map((route) => (
            <button key={route.id} className={`route-card ${route.id === activeId ? "active" : ""}`} onClick={() => { setActiveId(route.id); setPanelOpen(true); }}>
              <span className="route-thumb" style={{ backgroundImage: `linear-gradient(180deg, transparent, rgba(4,10,7,.7)), url(${route.image})` }}>
                <span className="status-dot" style={{ color: STATUS_COLORS[route.status] }}>{route.status}</span>
              </span>
              <span className="route-card-copy"><small><MapPin size={13} />{route.region}</small><b>{route.name}</b><span>{route.distance} · {route.duration} · {route.difficulty}</span></span>
            </button>
          ))}
        </div>
        <p className="data-note">当前路线与开放状态均为产品演示数据，不作为出行或导航依据。</p>
      </aside>

      <section className={`route-detail glass ${panelOpen ? "open" : ""}`}>
        <button className="detail-close" onClick={() => setPanelOpen(false)} aria-label="收起详情"><X size={18} /></button>
        <div className="detail-image" style={{ backgroundImage: `linear-gradient(90deg, rgba(5,12,8,.8), rgba(5,12,8,.08)), url(${activeRoute.image})` }}>
          <span>{activeRoute.imageCredit}</span>
        </div>
        <div className="detail-copy">
          <div className="detail-title"><div><span className="status-pill" style={{ color: STATUS_COLORS[activeRoute.status] }}>{activeRoute.status}</span><h2>{activeRoute.name}</h2><p><MapPin size={14} />{activeRoute.region}</p></div><button className="round-action"><Compass size={20} /></button></div>
          <p className="summary">{activeRoute.summary}</p>
          <section className="route-archive">
            <div className="archive-head"><span>路线档案</span><small>{activeRoute.archive.checkedAt}</small></div>
            <ul>{activeRoute.archive.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
            <p><ShieldAlert size={14} /><b>风险提示</b>{activeRoute.archive.riskNotice}</p>
            <small>资料来源：{activeRoute.archive.source}</small>
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
          <div className="detail-actions"><button disabled={activeRoute.status === "季节性关闭"}>查看完整路线</button><button>留言与约伴</button></div>
        </div>
      </section>

      {!panelOpen && <button className="reopen-panel" onClick={() => setPanelOpen(true)}><RouteIcon size={18} />查看路线</button>}
      <div className="terrain-toggle glass"><button className={terrain ? "active" : ""} onClick={() => setTerrain((value) => !value)}><Mountain size={16} />立体地形</button><button disabled>等高线 · 下一阶段</button></div>
      <section className="season-explorer glass" aria-label="全球季相探索">
        <div className="season-head">
          <span><SunMedium size={16} />全球季相探索<small>视觉模拟</small></span>
          <b>{activeSeason.label}</b>
        </div>
        <div className="season-track">
          {SEASONS.map((item) => <button key={item.id} className={season === item.id ? "active" : ""} onClick={() => setSeason(item.id)}><i>{item.id}</i><span>{item.label.slice(2)}</span></button>)}
        </div>
        <p>{activeSeason.hint} · 地球色彩随季节联动，开放状态仍以官方公告为准。</p>
      </section>
    </main>
  );
}
