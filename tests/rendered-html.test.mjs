import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

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
  assert.match(page, /const terrainEnabled = \(terrain \|\| contours\) && mapView === "route"/);
  assert.match(page, /const showSeason = seasonOverlayEnabled && mapView === "route"/);
  assert.match(page, /const \[terrain, setTerrain\] = useState\(false\)/);
  assert.match(page, /const \[contours, setContours\] = useState\(false\)/);
  assert.match(page, /const \[seasonOverlayEnabled, setSeasonOverlayEnabled\] = useState\(false\)/);
  assert.doesNotMatch(page, /arcgisonline\.com/);
  assert.match(page, /tiles\.openfreemap\.org\/planet/);
  assert.match(page, /\/api\/terrain\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(page, /maxzoom: 14/);
  assert.match(page, /city-buildings-3d/);
  assert.match(page, /返回完整3D地球/);
  assert.match(page, /全球季相探索/);
  assert.match(page, /MODIS_Terra_CorrectedReflectance_TrueColor/);
  assert.match(page, /SEASON_LAYER_IDS/);
  assert.match(page, /真实时相/);
});

test("地球加载提示在加载结束后从辅助技术树隐藏", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /className=\{`map-loading \$\{mapLoading \? "visible" : ""\}`\} aria-live="polite" aria-hidden=\{!mapLoading\}/);
});

test("网页选中路线图钉在重叠时保持最上层", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /function setRouteMarkerSelected\(element: HTMLButtonElement, selected: boolean\)/);
  assert.match(page, /element\.classList\.contains\("maplibregl-marker"\)/);
  assert.match(page, /element\.style\.setProperty\("z-index", "10000", "important"\)/);
  assert.match(page, /element\.style\.removeProperty\("z-index"\)/);
  assert.match(page, /setRouteMarkerSelected\(button, route\.id === activeIdRef\.current\)/);
  assert.match(page, /setRouteMarkerSelected\(element, routeId === selectedRouteId\)/);
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
  assert.ok(routeIds.length >= 20);
  assert.equal(new Set(routeIds).size, routeIds.length);
  const [routeJavascript, paletteSource] = await Promise.all([
    Promise.resolve(ts.transpileModule(routes, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText),
    source("app/palette.ts"),
  ]);
  const paletteModule = { exports: {} };
  new Function("exports", ts.transpileModule(paletteSource, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText)(paletteModule.exports);
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", routeJavascript)(specifier => {
    if (specifier === "../app/palette") return paletteModule.exports;
    throw new Error(`Unexpected route module dependency: ${specifier}`);
  }, routeModule, routeModule.exports);
  const actual = routeModule.exports;
  const warning = actual.ROUTES.find(route => route.id === "aotai-warning");
  assert.ok(warning);
  assert.notEqual(warning.status, "开放中");
  assert.equal(warning.trackMode, "不展示轨迹");
  assert.deepEqual(warning.path, []);
  assert.match(warning.summary, /禁止进入/);
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
  assert.match(page, /地图 © OpenFreeMap/);
  assert.match(page, /terrain-sources/);
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

test("网页嵌入客户端只委托业务实际使用的浏览器权限", async () => {
  const clientFrame = await source("app/client/page.tsx");
  assert.match(clientFrame, /allow="geolocation; camera"/);
  assert.doesNotMatch(clientFrame, /clipboard-write/);
});

test("本地功能中心覆盖推荐、社区、约伴、日记和管理台", async () => {
  const [hub, css] = await Promise.all([source("components/ProjectHub.tsx"), source("app/globals.css")]);

  for (const expected of ["自然语言行程需求", "推荐结果", "统一账号云端社区", "景点档案", "路线审核总览"]) {
    assert.match(hub, new RegExp(expected));
  }
  assert.match(hub, /localStorage/);
  assert.match(hub, /client-app\/index\.html#\/pages\/companion\/social/);
  assert.doesNotMatch(hub, /title="徒步地球云端社区"[^>]*\ballow=/);
  assert.match(hub, /role="dialog" aria-modal="true"/);
  assert.match(css, /\.project-hub \{ inset: 0; border: 0; border-radius: 0; box-shadow: none; \}/);
  assert.match(hub, /公开内容需审核/);
  assert.match(hub, /数据来源与发布闸门/);
  assert.match(hub, /不可发布/);
  assert.match(hub, /功能源码与验收状态/);
  assert.match(hub, /源码已接入，待真实账号验收：小程序微信登录与网页\/桌面扫码；短信登录未启用/);
  assert.match(hub, /暂未接入：授权图片、攻略视频和博物馆导览/);
  assert.doesNotMatch(hub, /更多第三方登录与短信验证/);
});

test("数据来源闸门不会把演示素材当成正式发布数据", async () => {
  const [registry, routes] = await Promise.all([source("data/source-registry.ts"), source("data/routes.ts")]);
  assert.match(registry, /OFFICIAL_SOURCE_REGISTRY/);
  assert.match(registry, /MET Norway 全球天气预报/);
  assert.match(registry, /当前代理不配置 API 密钥/);
  assert.match(registry, /全球开放预报/);
  assert.match(registry, /北欧\/北极以外约9公里分辨率/);
  assert.match(registry, /线上代理仍待统一验收/);
  assert.match(registry, /待授权/);
  assert.match(registry, /isPublishReady/);
  assert.match(registry, /NASA Earthdata GIBS \/ MODIS Terra 季节影像/);
  assert.match(routes, /徒步地球原创几何示意/);
});

test("网页色板门禁从网页构建实际生成的文件读取", async () => {
  const gate = await source("scripts/check-brand-palette.mjs");
  assert.match(gate, /read\('app\/palette\.ts'\)/);
  assert.match(gate, /read\('app\/palette\.css'\)/);
  assert.match(gate, /read\('app\/theme-color\.ts'\)/);
  assert.match(gate, /read\('public\/manifest\.webmanifest'\)/);
  assert.match(gate, /read\('app\/globals\.css'\)/);
  assert.doesNotMatch(gate, /read\('\.\.\/app\/(?:palette|theme-color)/);
  assert.doesNotMatch(gate, /read\('\.\.\/(?:app\/globals\.css|public\/manifest\.webmanifest)/);
});

test("路线来源名称含占位标记时会提示复核但保留发现记录", async () => {
  const [catalog, helper] = await Promise.all([
    source("data/live-catalog.ts"),
    source("data/discovery-tags.ts"),
  ]);
  assert.match(helper, /discoveryNameReview/);
  assert.ok(helper.includes(String.raw`fix\s*me|todo|unknown|unnamed|no\s+name`));
  assert.match(helper, /请核对原始路线记录/);
  assert.match(catalog, /highlights:\[\.\.\.discoveryNameReview\(routeName\)/);
});

test("官方天气读取层存在且失败时不伪造实时天气", async () => {
  const [weatherRoute, page] = await Promise.all([
    source("app/api/weather/route.ts"),
    source("app/page.tsx"),
  ]);
  assert.match(weatherRoute, /api\.met\.no\/doc\/TermsOfService/);
  assert.match(weatherRoute, /action: "weather\.forecast"/);
  assert.match(weatherRoute, /weather\.fetchedAt === undefined/);
  assert.match(weatherRoute, /weather\.fetchedAt = new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(weatherRoute, /fetch\("https:\/\/api\.met\.no/);
  assert.doesNotMatch(weatherRoute, /fetch\([^\n]*adat\/sk/);
  assert.match(weatherRoute, /status: "unavailable"/);
  assert.match(page, /weatherLatitude=activeRoute\.center\[1\]/);
  assert.match(page, /weatherLongitude=activeRoute\.center\[0\]/);
  assert.match(page, /latitude=Number\(weatherLatitude\.toFixed\(2\)\)/);
  assert.match(page, /longitude=Number\(weatherLongitude\.toFixed\(2\)\)/);
  assert.match(page, /天气服务/);
});

test("高程瓦片使用本地低缩放回退，浏览器不直连远程源", async () => {
  const [page, terrainAsset] = await Promise.all([source("app/page.tsx"), stat(new URL("public/terrain/0/0/0.png", root))]);
  assert.match(page, /\/api\/terrain\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(page, /maxzoom: 14/);
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
  const [page, manifest, serviceWorker, serviceWorkerStamper] = await Promise.all([
    source("app/page.tsx"),
    source("public/manifest.webmanifest"),
    source("public/sw.js"),
    source("scripts/stamp-service-worker.mjs"),
  ]);
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.scope, "/");
  assert.ok(parsed.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(parsed.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
  assert.match(page, /navigator\.serviceWorker\.register\("\/sw\.js",/);
  assert.match(page, /当前处于离线状态/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.doesNotMatch(serviceWorker, /cache\.put\([^\n]*api/);
  assert.match(serviceWorkerStamper, /app-shell-resource/);
  assert.match(serviceWorkerStamper, /for\s*\(const url of appShell\)/);
  assert.match(serviceWorkerStamper, /readFileSync\(absolute\)/);
  assert.match(serviceWorkerStamper, /runtime-ssr-route/);
  assert.match(serviceWorkerStamper, /dist',\s*'server',\s*'BUILD_ID/);
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

test("网页色板门禁在干净 CI 中通过不可变提交定位客户端源", async () => {
  const gate = await source("scripts/check-brand-palette.mjs");
  assert.match(gate, /resolvePinnedClientSource/);
  assert.match(gate, /readClient\('app\/src\/pages\/index\/index\.vue'\)/);
  assert.doesNotMatch(gate, /read\('\.\.\/\.client-source/);
});

test("网页路线推荐复用严格导航有效性门禁", async () => {
  const [hub, routes] = await Promise.all([source("components/ProjectHub.tsx"), source("data/routes.ts")]);
  assert.match(hub, /import \{ hasCurrentOfficialReview, isNavigable, ROUTES/);
  assert.match(hub, /routes\.filter\(\(item\) => isNavigable\(item\) && hasCurrentOfficialReview\(item, recommendationNow\)\)/);
  assert.match(routes, /route\.trackMode !== "已核验轨迹"/);
  assert.match(routes, /expiresAt! <= now/);
  assert.match(routes, /point\[0\] >= -180 && point\[0\] <= 180/);
  assert.match(routes, /point\[1\] >= -90 && point\[1\] <= 90/);
});

test("网页路线开放状态与导航必须有有效的人工官方复核", async () => {
  const [routes, sources] = await Promise.all([
    source("data/routes.ts"),
    source("data/source-registry.ts"),
  ]);

  assert.match(routes, /export function hasCurrentOfficialReview\(route: HikingRoute, now = Date\.now\(\)\)/);
  assert.match(routes, /!source \|\| source\.label !== "官方资料人工核验"/);
  assert.match(routes, /checkedAt < now - 30 \* 86400000/);
  assert.match(routes, /expiresAt! > checkedAt \+ 7 \* 86400000/);
  assert.match(routes, /route\.status !== "开放中" \|\| !hasCurrentOfficialReview\(route\)/);
  assert.match(sources, /const openingStatus: SourceRecord = hasCurrentOfficialReview\(route\)/);
  assert.match(sources, /\{ \.\.\.OFFICIAL_SOURCE_REGISTRY\.openingStatus, readiness: "待官方核验" \}/);
});

test("上线前闸门、法律页面、举报联系入口、健康检查和安全头已配置", async () => {
  const [layout, robots, health, worker, release, privacy, report, sources] = await Promise.all([
    source("app/layout.tsx"),
    source("app/robots.ts"),
    source("app/api/health/route.ts"),
    source("worker/index.ts"),
    source("app/release/page.tsx"),
    source("app/privacy/page.tsx"),
    source("app/report/page.tsx"),
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
  assert.match(privacy, /本机资料由你导出或删除/);
  assert.match(report, /举报与帮助/);
  assert.match(report, /2308582955@qq\.com/);
  assert.match(report, /mailto:2308582955@qq\.com/);
  assert.match(sources, /RELEASE_SOURCE_REGISTRY/);
});

test("公开举报帮助页指向现有举报流程并避免额外收集", async () => {
  const [report, home, shell] = await Promise.all([
    source("app/report/page.tsx"),
    source("app/page.tsx"),
    source("components/DocumentShell.tsx"),
  ]);
  assert.match(report, /client\?tab=companion/);
  assert.match(report, /长按帖子并选择举报原因/);
  assert.match(report, /举报已提交，等待处理/);
  assert.match(report, /网页不提供持续进度查询/);
  assert.match(report, /mailto:2308582955@qq\.com/);
  assert.match(report, /不是救援或报警服务/);
  assert.match(report, /不提供新的在线提交表单/);
  assert.match(home, /href="\/report">举报与帮助/);
  assert.match(shell, /href="\/report">举报与帮助/);
});

test("网页装备建议按路线半球处理寒季且不推测全球雨季", async () => {
  const [gearSource, weatherSource] = await Promise.all([
    source("data/gear-advice.ts"),
    source("data/weather-gear-advice.ts"),
  ]);
  const evaluate = (text, dependencies = {}) => {
    const commonJsModule = { exports: {} };
    const javascript = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", javascript)((specifier) => {
      if (!(specifier in dependencies)) throw new Error(`Unexpected gear advice dependency: ${specifier}`);
      return dependencies[specifier];
    }, commonJsModule, commonJsModule.exports);
    return commonJsModule.exports;
  };
  const weather = evaluate(weatherSource);
  const { buildGearAdvice } = evaluate(gearSource, { "./weather-gear-advice": weather });
  const route = (latitude) => ({ center: [0, latitude], name: "示例路线", region: "", difficulty: "", summary: "", archive: { riskNotice: "" }, scenery: [], overnight: "不住宿", surface: "铺装", packStyle: "待核验", status: "待核验" });
  const northSummer = buildGearAdvice(route(35), "轻装", "2026-07-15");
  const southWinter = buildGearAdvice(route(-35), "轻装", "2026-07-15");
  const tropics = buildGearAdvice(route(5), "轻装", "2026-01-15");
  assert.ok(northSummer.items.includes("轻便防雨层"));
  assert.ok(!northSummer.items.includes("保暖帽和手套"));
  assert.ok(!northSummer.notices.some((value) => value.includes("降雨期")));
  assert.ok(southWinter.items.includes("保暖帽和手套"));
  assert.ok(!tropics.items.includes("保暖帽和手套"));
});
