import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("3D 地球首屏包含真实卫星、高程和路线交互", async () => {
  const [page, layout] = await Promise.all([
    source("app/page.tsx"),
    source("app/layout.tsx"),
  ]);

  assert.match(layout, /title:\s*"徒步地球全球徒步路线"/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(page, /projection:\s*\{ type: "globe" \}/);
  assert.match(page, /World_Imagery\/MapServer\/tile/);
  assert.match(page, /\/terrain\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(page, /maxzoom: 0/);
  assert.match(page, /city-buildings-3d/);
  assert.match(page, /返回完整3D地球/);
  assert.match(page, /全球季相探索/);
  assert.match(page, /MODIS_Terra_CorrectedReflectance_TrueColor/);
  assert.match(page, /SEASON_LAYER_IDS/);
  assert.match(page, /真实时相/);
});

test("生产渲染不把中文本机字体路径写入 Link 响应头", async () => {
  const [layout, css] = await Promise.all([source("app/layout.tsx"), source("app/globals.css")]);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.doesNotMatch(layout, /Noto_Sans_SC/);
  assert.match(css, /"PingFang SC", "Microsoft YaHei", system-ui/);
});

test("路线数据、筛选和高风险轨迹规则保持完整", async () => {
  const [routes, page] = await Promise.all([
    source("data/routes.ts"),
    source("app/page.tsx"),
  ]);

  const routeIds = [...routes.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(routeIds).size, 20);
  assert.match(routes, /id: "aotai-warning"[\s\S]*?status: "永久关闭"[\s\S]*?trackMode: "不展示轨迹"/);
  assert.match(page, /route\.trackMode === "不展示轨迹" \? \[\] : route\.path/);
  assert.match(page, /路线状态/);
  assert.match(page, /最佳季节/);
  assert.match(page, /行程方式/);
  assert.match(page, /夜宿方式/);
  assert.match(page, /路面与环境/);
});

test("手机性能档、安全区和后置功能懒加载已配置", async () => {
  const [page, css, vite] = await Promise.all([
    source("app/page.tsx"),
    source("app/globals.css"),
    source("vite.config.ts"),
  ]);

  assert.match(page, /compactTouchDevice/);
  assert.match(page, /await import\("maplibre-gl"\)/);
  assert.doesNotMatch(page, /import \* as maplibregl from "maplibre-gl"/);
  assert.match(page, /setMaxParallelImageRequests\(efficientRendering \? 12 : 20\)/);
  assert.match(page, /maxTileCacheSize:\s*efficientRendering \? 24 : 52/);
  assert.match(page, /const ProjectHub = lazy\(/);
  assert.match(page, /<Suspense fallback=/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.route-detail \.detail-copy \{ padding-bottom: 70px; \}/);
  assert.match(css, /\.route-detail \{ z-index: 24;/);
  assert.match(page, /mobile-dock glass \$\{panelOpen \? "" : "panel-closed"\}/);
  assert.match(page, /panelOpen \|\| detailOpen \? "map-controls-hidden"/);
  assert.match(page, /filtersOpen \? "filters-open"/);
  assert.match(page, /设置完成后显示匹配路线/);
  assert.match(page, /!filtersOpen && <>/);
  assert.match(css, /\.mobile-dock \{[^}]*left: max\(8px, env\(safe-area-inset-left\)\);[^}]*right: max\(8px, env\(safe-area-inset-right\)\)/);
  assert.match(css, /\.mobile-dock\.panel-closed \{[^}]*left: max\(112px,[^}]*right: max\(52px/);
  assert.match(css, /\.route-browser \{[^}]*bottom: calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.route-browser\.filters-open \{ height: min\(72dvh, 590px\); \}/);
  assert.match(css, /\.map-controls-hidden \.maplibregl-ctrl-bottom-right \.maplibregl-ctrl-group/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(vite, /host:\s*"0\.0\.0\.0"/);
  assert.match(vite, /port:\s*8080/);
  assert.match(vite, /strictPort:\s*true/);
});

test("iPhone 地图工具反馈、署名和完整地球复位保持可验收", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);

  assert.match(page, /className=\{city3DActive \? "active" : ""\}/);
  assert.match(page, /aria-pressed=\{city3DActive\}/);
  assert.match(page, /if \(city3DActive\) \{\s*showGlobe\(\)/);
  assert.match(page, /city3DActive \? "退出3D" : "城市3D"/);
  assert.match(page, /NavigationControl\(\{ showCompass: false \}\)/);
  assert.match(page, /flat-view-control/);
  assert.match(page, /button\.title = "恢复平面视角"/);
  assert.match(page, /map\.stop\(\)/);
  assert.match(page, /map\.easeTo\(\{ pitch: 0, bearing: 0/);
  assert.match(page, /\[city3DActive, mapDetails\]/);
  assert.match(page, /setGlobeResetToken\(\(value\) => value \+ 1\)/);
  assert.match(page, /\[activeRoute, globeResetToken, mapView\]/);
  assert.match(page, /影像 © Esri、Maxar/);
  assert.match(page, /地形 © Mapzen \/ AWS 开放数据/);
  assert.match(page, /数据 © OpenStreetMap 贡献者/);
  assert.doesNotMatch(page, /Terrain tile ©|Source: Esri|OpenStreetMap contributors/);
  assert.match(page, /route-browser glass[^\n]*detailOpen \? "detail-hidden"/);
  assert.match(page, /season-explorer glass[^\n]*detailOpen \? "detail-hidden"/);
  assert.match(page, /mapError\.sourceId\?\.startsWith\("season"\)/);
  assert.match(page, /onClose=\{closeHub\}/);
  assert.match(page, /setLayer\("routes"\)/);
  assert.match(page, /const closeHub = useCallback\(\(\) => \{[\s\S]*?setDetailOpen\(false\);[\s\S]*?setPanelOpen\(true\)/);
  assert.match(page, /window\.isSecureContext/);
  assert.match(page, /enableHighAccuracy: true/);
  assert.match(page, /user-location-marker/);
  assert.match(page, /PERMISSION_DENIED/);
  assert.match(css, /\.user-location-marker/);
  assert.match(css, /\.terrain-toggle \{[^}]*left: max\(10px, env\(safe-area-inset-left\)\);[^}]*right: max\(10px, env\(safe-area-inset-right\)\)/);
  assert.match(css, /\.route-browser\.detail-hidden, \.season-explorer\.detail-hidden/);
  assert.match(css, /scroll-snap-type: y proximity/);
  assert.ok(page.indexOf('className="route-weather"') < page.indexOf('className="route-archive"'));
});

test("本地功能中心覆盖推荐、社区、约伴、日记和管理台", async () => {
  const [hub, css] = await Promise.all([source("components/ProjectHub.tsx"), source("app/globals.css")]);

  for (const expected of ["自然语言行程需求", "推荐结果", "路线留言", "免费/AA约伴", "保存日记并打卡", "我的发光足迹", "国内著名景点首批档案", "路线审核总览"]) {
    assert.match(hub, new RegExp(expected));
  }
  assert.match(hub, /localStorage/);
  assert.match(hub, /无需登录/);
  assert.match(hub, /role="dialog" aria-modal="true"/);
  assert.match(css, /\.project-hub \{ inset: 0; border: 0; border-radius: 0; box-shadow: none; \}/);
  assert.match(hub, /hiking-earth-registrations-v1/);
  assert.match(hub, /报名并进入群聊/);
  assert.match(hub, /只有已报名成员可见/);
  assert.match(hub, /未成年人报名需要由监护人确认/);
  assert.match(hub, /isTripArchived/);
  assert.match(hub, /数据来源与发布闸门/);
  assert.match(hub, /不可发布/);
});

test("数据来源闸门不会把演示素材当成正式发布数据", async () => {
  const [registry, routes] = await Promise.all([source("data/source-registry.ts"), source("data/routes.ts")]);
  assert.match(registry, /OFFICIAL_SOURCE_REGISTRY/);
  assert.match(registry, /中国气象局 SmartWeatherAPI/);
  assert.match(registry, /待授权/);
  assert.match(registry, /isPublishReady/);
  assert.match(registry, /NASA Earthdata GIBS \/ MODIS Terra 季节影像/);
  assert.match(routes, /Unsplash 演示影像/);
});

test("官方天气读取层存在且失败时不伪造实时天气", async () => {
  const [weatherRoute, page, routes] = await Promise.all([
    source("app/api/weather/route.ts"),
    source("app/page.tsx"),
    source("data/routes.ts"),
  ]);
  assert.match(weatherRoute, /weather\.com\.cn\/adat\/sk/);
  assert.match(weatherRoute, /status: "unavailable"/);
  assert.match(page, /\/api\/weather\?cityId=/);
  assert.match(page, /官方天气实况/);
  assert.match(routes, /weatherCityId: "101180101"/);
});

test("高程瓦片使用本地低缩放回退，浏览器不直连远程源", async () => {
  const [page, terrainAsset] = await Promise.all([source("app/page.tsx"), stat(new URL("public/terrain/0/0/0.png", root))]);
  assert.match(page, /\/terrain\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(page, /maxzoom: 0/);
  assert.doesNotMatch(page, /s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium/);
  assert.ok(terrainAsset.size > 1000);
});

test("PC网页交互具备恢复、异常反馈和键盘闭环", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /重置筛选/);
  assert.match(page, /当前没有匹配路线/);
  assert.match(page, /部分地图资源暂时无法加载/);
  assert.match(page, /定位权限未开启/);
  assert.match(page, /event\.key === "\/"/);
  assert.match(page, /event\.key\.toLowerCase\(\) === "g"/);
  assert.match(page, /查看地图轨迹/);
  assert.match(css, /\.empty-routes/);
  assert.match(css, /\.app-message/);
});

test("PWA 安装与离线降级不会缓存实时接口", async () => {
  const [page, manifest, serviceWorker] = await Promise.all([
    source("app/page.tsx"),
    source("public/manifest.webmanifest"),
    source("public/sw.js"),
  ]);
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.scope, "/");
  assert.ok(parsed.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(parsed.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
  assert.match(page, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(page, /当前处于离线状态/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.doesNotMatch(serviceWorker, /cache\.put\([^\n]*api/);
});

test("隐私控制支持本机数据导出和删除", async () => {
  const hub = await source("components/ProjectHub.tsx");
  assert.match(hub, /exportLocalData/);
  assert.match(hub, /clearLocalData/);
  assert.match(hub, /application\/json/);
  assert.match(hub, /LOCAL_DATA_KEYS\.forEach/);
  assert.match(hub, /导出本机数据/);
  assert.match(hub, /清除本机数据/);
});

test("上线前闸门、法律页面、健康检查和安全头已配置", async () => {
  const [layout, robots, health, worker, release, privacy, sources] = await Promise.all([
    source("app/layout.tsx"),
    source("app/robots.ts"),
    source("app/api/health/route.ts"),
    source("worker/index.ts"),
    source("app/release/page.tsx"),
    source("app/privacy/page.tsx"),
    source("app/sources/page.tsx"),
  ]);
  assert.match(layout, /NEXT_PUBLIC_RELEASE_READY/);
  assert.match(robots, /disallow: "\/"/);
  assert.match(health, /releaseReady/);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /Permissions-Policy/);
  assert.match(worker, /img-src[^\n]*https:\/\/gibs\.earthdata\.nasa\.gov/);
  assert.match(worker, /connect-src[^\n]*https:\/\/gibs\.earthdata\.nasa\.gov/);
  assert.match(worker, /url\.protocol === "https:"/);
  assert.match(worker, /contentSecurityPolicy\.push\("upgrade-insecure-requests"\)/);
  assert.match(release, /禁止正式发布/);
  assert.match(privacy, /清除本机数据/);
  assert.match(sources, /RELEASE_SOURCE_REGISTRY/);
});

test("EdgeOne 国内测试入口完整转发现有 Worker，而不是误作纯静态部署", async () => {
  const [config, packageJson, handler, rootFunction, catchAllFunction, buildScript] = await Promise.all([
    source("edgeone-domestic/edgeone.json"),
    source("edgeone-domestic/package.json"),
    source("edgeone-domestic/cloud-functions/_handler.js"),
    source("edgeone-domestic/cloud-functions/index.js"),
    source("edgeone-domestic/cloud-functions/[[default]].js"),
    source("edgeone-domestic/build.mjs"),
  ]);

  assert.match(config, /"buildCommand": "npm run build"/);
  assert.match(config, /"outputDirectory": "static"/);
  assert.match(packageJson, /"build": "node build\.mjs"/);
  assert.match(config, /"mainlandRegions": \["ap-guangzhou"\]/);
  assert.match(config, /"includeFiles": \["runtime\/\*\*", "static\/\*\*"\]/);
  assert.match(handler, /vinext\.default\.fetch/);
  assert.match(handler, /ASSETS/);
  assert.match(handler, /IMAGES/);
  assert.match(rootFunction, /onRequest/);
  assert.match(catchAllFunction, /onRequest/);
  assert.match(buildScript, /dist\/client/);
  assert.match(buildScript, /dist\/server/);
});
