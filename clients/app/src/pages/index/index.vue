<template>
  <view class="page explore-home">
    <view class="home-topbar">
      <view class="home-brand"><view class="brand-mark" aria-hidden="true"><view class="brand-mountain"><view class="mountain-slope mountain-back-left"></view><view class="mountain-slope mountain-back-right"></view><view class="mountain-slope mountain-front-left"></view><view class="mountain-slope mountain-front-right"></view><view class="mountain-base"></view></view></view><view><text class="brand-name">徒步地球</text><text class="brand-caption">全球徒步路线</text></view></view>
      <view class="home-tabs"><text class="home-tab active">徒步路线</text><navigator class="home-tab" url="/pages/route/news">官方户外公告</navigator></view>
      <button class="home-cta he-primary" @click="openCompanions">发起约伴 ›</button>
    </view>
    <view class="earth-stage"><ExploreGlobe :routes="globeRoutes" :selected-id="selectedRoute" :page-scroll-top="pageScrollTop" @select="selectGlobeRoute" /></view>
    <view class="explore-panel">
    <!-- 自定义导航头 -->
    <view class="hero">
      <text class="hero-title">今天，走哪一条？</text>
      <navigator class="hero-link" open-type="switchTab" url="/pages/my/my">账号、轨迹、组队与社区 →</navigator>
      <text class="hero-sub">本机目录含 {{ ROUTES.length }} 条路线发现档案 · “待核验”不代表已开放或可导航</text>
      <text class="hero-sub">路线数据 © OpenStreetMap contributors · ODbL</text>
      <view v-if="showSources" class="source-status"><text v-for="source in catalogSources" :key="source.id" class="hero-sub">{{ source.label }}：{{ catalogSourceStatus(source.id) }}</text></view>
      <text v-else-if="catalogRefreshing" class="hero-sub source-status-summary">{{ catalogRefreshSummary }}</text>
      <button size="mini" class="quiet" @click="showSources=!showSources">{{showSources?'收起同步状态':'目录同步状态'}}</button>
      <button size="mini" :disabled="catalogRefreshing" @click="refreshRouteCatalog(true)">{{catalogRefreshing ? '正在刷新目录…' : '刷新路线目录'}}</button>
      <view class="search-box">
        <input v-model="keyword" class="search-input" placeholder="搜索路线 / 地区 / 景观" placeholder-class="ph" confirm-type="search" />
      </view>
    </view>
    <view class="online-search">
      <text>本机搜索仅覆盖已同步目录；在线检索覆盖当前来源快照。</text>
      <picker :range="catalogSourceLabels" :value="searchSourceIndex" @change="changeSearchSource"><view>来源：{{ catalogSources[searchSourceIndex].label }}</view></picker>
      <button size="mini" class="he-primary" :disabled="searchLoading" @click="onlineSearch(false)">{{ searchLoading?'检索中…':'在线检索全部来源记录' }}</button>
      <button v-if="onlineMode" size="mini" @click="leaveOnlineSearch">返回本机目录</button>
      <text v-if="searchMessage">{{ searchMessage }}</text>
    </view>

    <!-- 筛选 -->
    <scroll-view scroll-x class="chips" :show-scrollbar="false">
      <view class="chips-inner">
        <view
          v-for="c in statusChips" :key="c"
          class="chip" :class="{ on: statusFilter === c }"
          @click="statusFilter = statusFilter === c ? '' : c"
        >{{ c || '全部状态' }}</view>
      </view>
    </scroll-view>
    <scroll-view scroll-x class="chips" :show-scrollbar="false">
      <view class="chips-inner">
        <view
          v-for="c in seasonChips" :key="c"
          class="chip" :class="{ on: seasonFilter === c }"
          @click="seasonFilter = seasonFilter === c ? '' : c"
        >{{ c || '全部季节' }}</view>
      </view>
    </scroll-view>

    <!-- 路线卡片 -->
    <scroll-view scroll-y class="list">
      <view
        v-for="r in filtered.slice(0, visibleCount)" :key="r.id"
        class="card"
        @click="goDetail(r)"
      >
        <view class="card-head">
          <view class="dot" :style="{ background: STATUS_COLORS[r.status] }"></view>
          <text class="card-status">{{ r.status }}</text>
          <text v-if="hasSourceNameReview(r)" class="name-review-tag">名称待核对</text>
          <text class="card-region">{{ r.region }}</text>
        </view>
        <text class="card-name">{{ r.name }}</text>
        <text class="card-summary">{{ r.summary }}</text>
        <view class="card-meta">
          <text>{{ r.distance }}</text>
          <text>爬升 {{ r.ascent }}</text>
          <text>{{ r.duration }}</text>
          <text>{{ r.difficulty }}</text>
        </view>
        <view class="card-tags">
          <text v-for="s in r.scenery" :key="s" class="tag">{{ s }}</text>
          <text v-if="isNavigable(r)" class="tag nav">可导航</text>
        </view>
      </view>
      <button v-if="onlineMode && searchHasMore" :disabled="searchLoading" @click="onlineSearch(true)">继续读取在线结果</button>
      <button v-if="filtered.length > visibleCount" @click="visibleCount += 50">加载更多（共 {{ filtered.length }} 条）</button>
      <view v-if="filtered.length === 0" class="empty">没有匹配的路线</view>
      <view class="disclaimer">候选版本，不构成导航服务或许可；出行以属地公告为准</view>
    </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onPageScroll } from "@dcloudio/uni-app";
import ExploreGlobe from "@/components/ExploreGlobe.vue";
const selectedRoute=ref('');
const pageScrollTop=ref(0);
onPageScroll(event=>{pageScrollTop.value=event.scrollTop;});
import { ROUTES, catalogCacheState, catalogRefreshState, refreshRouteCatalog, rememberDiscoveredRoute } from "@/services/route-catalog";
import {searchPublicCatalog, type PublicCatalogSource} from "@/services/catalog-search";
import type {HikingRoute} from "@shared/types/route";
import { STATUS_COLORS, isNavigable, type RouteStatus, type Season } from "@shared/types/route";

const catalogSources=[{id:'osm',label:'OSM'},{id:'usfs',label:'美国国家森林'},{id:'hk',label:'香港官方步道'},{id:'nzdoc',label:'新西兰环保部官方步道'},{id:'parkscanada',label:'加拿大公园管理局'},{id:'nsw-npws',label:'新南威尔士州公园步道'},{id:'england',label:'英格兰国家步道'},{id:'wales',label:'威尔士国家步道'},{id:'japan-tokai',label:'日本·东海自然步道'},{id:'scotland-argyll',label:'苏格兰阿盖尔-比特核心步道'},{id:'ni-midulster',label:'北爱尔兰·米德阿尔斯特公共通行权'},{id:'norfolk-prow',label:'英格兰诺福克公共通行权'},{id:'cambridgeshire-prow',label:'英格兰剑桥郡公共通行权'},{id:'nps-public-trails',label:'美国国家公园步道（NPS）'},{id:'usgs-trails',label:'美国全国数字步道（USGS）'},{id:'swisstopo-wanderwege',label:'瑞士 swisstopo 官方徒步网络（待核验）'},{id:'victoria-recreation-tracks',label:'澳大利亚·维多利亚州官方步道'},{id:'queensland-qpws-trails',label:'澳大利亚·昆士兰州官方步道'},{id:'taiwan-trails',label:'台湾观光署官方步道（待核验）'},{id:'korea-durunubi-trails',label:'韩国·韩国旅游发展局 DuruNubi 官方步道（待核验）'}] as const;
const catalogSourceLabels=catalogSources.map(source=>source.label);
const keyword = ref("");
const showSources=ref(false);
const catalogRefreshing=computed(()=>Object.values(catalogRefreshState).some(Boolean));
const catalogRefreshSummary=computed(()=>{const refreshState=catalogRefreshState as Partial<Record<PublicCatalogSource,boolean>>;return `正在同步 ${catalogSources.filter(source=>refreshState[source.id]).length} 个来源，已保存路线仍可查看`;});
function catalogSourceStatus(source:PublicCatalogSource):string{const refreshState=catalogRefreshState as Partial<Record<PublicCatalogSource,boolean>>;const cacheState=catalogCacheState as Partial<Record<PublicCatalogSource,{saved:boolean;message:string}>>;const refreshing=refreshState[source];if(refreshing===undefined)return '在线按需检索，不缓存整库';return refreshing?'正在获取目录，已保存资料仍可查看':cacheState[source]?.message??'尚未同步';}
const searchSourceIndex=ref(0),onlineMode=ref(false),searchLoading=ref(false),searchHasMore=ref(false),searchMessage=ref(''),onlineRoutes=ref<HikingRoute[]>([]);
let searchGeneration=0,searchSnapshot='',searchOffset=0;
function leaveOnlineSearch(){searchGeneration++;onlineMode.value=false;searchLoading.value=false;searchHasMore.value=false;onlineRoutes.value=[];searchMessage.value='';}
function changeSearchSource(event:any){searchSourceIndex.value=Number(event.detail.value)||0;leaveOnlineSearch();}
async function onlineSearch(more:boolean){
 if(searchLoading.value)return;const query=keyword.value.trim();if(query.length<2){searchMessage.value='在线检索至少输入2个字符';return;}
 const generation=++searchGeneration;searchLoading.value=true;
 try{const result=await searchPublicCatalog(catalogSources[searchSourceIndex.value].id,query,more?searchOffset:0,more?searchSnapshot:undefined);if(generation!==searchGeneration)return;
  onlineMode.value=true;onlineRoutes.value=more?[...onlineRoutes.value,...result.routes]:result.routes;searchSnapshot=result.snapshot;searchOffset=result.offset+result.routes.length;searchHasMore.value=result.hasMore;searchMessage.value=`来源匹配${result.total}条，已读取${onlineRoutes.value.length}条；收录不代表开放或可导航。`;
 }catch(error){if(generation===searchGeneration)searchMessage.value=error instanceof Error?error.message:'在线检索失败，保留现有结果';}
 finally{if(generation===searchGeneration)searchLoading.value=false;}
}
watch(keyword,()=>{if(onlineMode.value||searchLoading.value)leaveOnlineSearch();});
const visibleCount = ref(50);
const statusFilter = ref<RouteStatus | "">("");
const seasonFilter = ref<Season | "">("");

watch([keyword, statusFilter, seasonFilter], () => { visibleCount.value = 50; });
const statusChips: (RouteStatus | "")[] = ["", "开放中", "待核验", "即将开放", "临时关闭"];
const seasonChips: (Season | "")[] = ["", "春", "夏", "秋", "冬"];
const hasSourceNameReview = (route: HikingRoute) => route.archive.highlights.some(item => item.startsWith("来源名称包含"));

const filtered = computed(() => {
  const kw = keyword.value.trim();
  return (onlineMode.value?onlineRoutes.value:ROUTES).filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false;
    if (seasonFilter.value && !r.bestSeasons.includes(seasonFilter.value)) return false;
    if (kw && !onlineMode.value) {
      const hay = `${r.name} ${r.region} ${r.scenery.join(" ")} ${r.summary}`;
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
});

const globeRoutes=computed(()=>{const step=Math.max(1,Math.ceil(filtered.value.length/2000));return filtered.value.filter((route,index)=>index%step===0||route.id===selectedRoute.value);});
function selectGlobeRoute(id:string){const route=filtered.value.find(r=>r.id===id);if(route)goDetail(route);}
function goDetail(route: HikingRoute) {
  selectedRoute.value=route.id;rememberDiscoveredRoute(route);const id=route.id;
  uni.navigateTo({ url: `/pages/route/detail?id=${encodeURIComponent(id)}` });
}
function openCompanions(){uni.switchTab({url:'/pages/companion/companion'});}
</script>

<style lang="scss" scoped>
.page { --he-home-mobile-panel-height:63vh; display:flex; flex-direction:column; min-height:100vh; background-color:var(--he-bg, var(--he-color-background)); background-image:radial-gradient(ellipse at 48% 48%,rgba(25,65,112,.3) 0,rgba(6,19,43,.2) 30%,transparent 60%),radial-gradient(ellipse at 18% 14%,rgba(63,73,136,.2),transparent 32%),radial-gradient(circle,rgba(255,255,255,.718) 0 1px,transparent 1.5px),radial-gradient(circle,rgba(170,204,255,.585) 0 1px,transparent 1.7px),radial-gradient(circle,rgba(255,240,201,.429) 0 1.2px,transparent 1.8px),radial-gradient(circle,rgba(255,255,255,.256) 0 .8px,transparent 1.4px),radial-gradient(circle,rgba(128,171,255,.224) 0 1.4px,transparent 2px),linear-gradient(145deg,#010208 0%,#04091b 45%,#000106 100%);background-size:auto,auto,137px 149px,211px 197px,293px 257px,71px 83px,367px 331px,auto;background-position:center,center,17px 31px,79px 113px,151px 47px,11px 19px,203px 91px,center;background-repeat:no-repeat,no-repeat,repeat,repeat,repeat,repeat,repeat,no-repeat;color:var(--he-text, var(--he-color-text)); }
.home-topbar{display:flex;align-items:center;gap:20px;min-height:var(--he-home-topbar-height, 66px);margin:12px 12px 0;padding:0 14px;border:1px solid var(--he-overlay-border, rgba(255,255,255,.12));border-radius:var(--he-home-topbar-radius, 20px);background:var(--he-overlay, rgba(5,12,18,.84));box-sizing:border-box}
.home-brand{display:flex;align-items:center;gap:10px;min-width:200px}.brand-mark{display:grid;place-items:center;width:var(--he-home-brand-mark-size, 40px);height:var(--he-home-brand-mark-size, 40px);border-radius:13px;background:var(--he-color-accent);color:var(--he-color-on-accent);flex:none}.brand-mountain{position:relative;width:20px;height:17px}.mountain-slope,.mountain-base{position:absolute;height:2px;border-radius:2px;background:var(--he-color-on-accent);transform-origin:left center}.mountain-back-left{left:1px;top:14px;width:12px;transform:rotate(-58deg)}.mountain-back-right{left:7px;top:3.8px;width:13px;transform:rotate(58deg)}.mountain-front-left{left:9px;top:12px;width:7px;transform:rotate(-42deg)}.mountain-front-right{left:14px;top:7px;width:9px;transform:rotate(61deg)}.mountain-base{left:1px;top:15px;width:18px}.brand-name,.brand-caption{display:block;line-height:1.2}.brand-name{font-size:16px;font-weight:700;color:var(--he-text, var(--he-color-text))}.brand-caption{margin-top:4px;color:var(--he-muted, var(--he-color-muted));font-size:10px;letter-spacing:.12em}
.home-tabs{display:flex;align-items:center;gap:5px;padding:4px;border-radius:14px;background:rgba(255,255,255,.05)}.home-tab{display:block;padding:10px 13px;border-radius:10px;color:var(--he-muted, var(--he-color-muted));font-size:13px;text-decoration:none;white-space:nowrap}.home-tab.active{background:var(--he-color-accent);color:var(--he-color-on-accent);font-weight:700}.home-cta{margin-left:auto!important;margin-right:0!important;flex:none;max-width:none!important;padding:9px 16px!important;border-radius:12px!important}
.earth-stage{min-height:0;padding:12px 12px 0;box-sizing:border-box;}
.explore-panel{display:flex;flex-direction:column;min-height:0;}
@supports (height:100dvh){.page{--he-home-mobile-panel-height:min(63dvh,585px)}}
@media(min-width:901px){.page{display:grid;grid-template-columns:minmax(0,1fr) var(--he-home-panel-width, 374px);grid-template-rows:var(--he-home-topbar-height, 66px) minmax(0,1fr);height:calc(100dvh - 50px);min-height:0;padding:12px 20px 20px;gap:12px 20px;box-sizing:border-box}.home-topbar{grid-column:1/-1;grid-row:1;margin:0}.earth-stage{grid-column:1;grid-row:2;min-width:0;padding:0}.explore-panel{grid-column:2;grid-row:2;width:100%;min-height:0;background:var(--he-overlay, rgba(5,12,18,.84));border:1px solid var(--he-overlay-border, rgba(255,255,255,.12));border-radius:var(--he-home-panel-radius, 24px);overflow:hidden;backdrop-filter:blur(12px)}.list{min-height:0;height:0;flex:1}.hero{padding-top:24px!important}.chips{white-space:normal}.chips-inner{display:flex;flex-wrap:wrap;width:100%;box-sizing:border-box}}
@media(max-width:900px){.page{position:relative;display:block;height:100vh;height:100dvh;min-height:0;overflow:hidden;box-sizing:border-box}.home-topbar{position:absolute;z-index:20;top:calc(var(--status-bar-height, 0px) + 8px);left:10px;right:10px;margin:0}.home-brand{min-width:0}.home-tabs{display:none}.brand-caption{display:none}.earth-stage{position:absolute;z-index:1;inset:0;padding:0}.explore-panel{position:absolute;z-index:12;left:8px;right:8px;bottom:58px;height:var(--he-home-mobile-panel-height);max-height:585px;border:1px solid var(--he-overlay-border, rgba(255,255,255,.12));border-radius:var(--he-home-panel-radius, 24px);background:var(--he-overlay, rgba(5,12,18,.84));overflow:hidden;box-sizing:border-box;box-shadow:0 18px 50px rgba(0,0,0,.3);backdrop-filter:blur(14px)}.hero{padding:14px 16px 8px}.hero-title{font-size:24px}.hero-sub{font-size:11px}.list{height:0;min-height:0;flex:1}.globe-shell{height:100%;border-radius:0}}
@media(max-width:900px){.home-topbar{height:var(--he-home-mobile-topbar-height,58px);min-height:var(--he-home-mobile-topbar-height,58px);border-radius:var(--he-home-mobile-topbar-radius,17px)}.brand-mark{width:var(--he-home-mobile-brand-mark-size,36px);height:var(--he-home-mobile-brand-mark-size,36px)}}
@media(max-width:560px){.page{--he-home-mobile-panel-height:min(50vh,440px)}@supports (height:100dvh){.page{--he-home-mobile-panel-height:min(50dvh,440px)}}.explore-panel{max-height:440px}.home-topbar{gap:8px;min-height:var(--he-home-mobile-topbar-height, 58px);padding:0 10px;border-radius:var(--he-home-mobile-topbar-radius, 17px)}.home-brand{gap:7px;min-width:0}.brand-mark{width:var(--he-home-mobile-brand-mark-size, 36px);height:var(--he-home-mobile-brand-mark-size, 36px)}.brand-name{font-size:14px}.brand-caption{font-size:8px}.home-tabs{display:none}.home-cta{padding:8px 11px!important;font-size:12px!important}.earth-stage{padding:0}}
.hero { padding: 14px 16px 8px; }
.hero-title { display: block; font-size: 28px; font-weight: 700; color: var(--he-text, var(--he-color-text)); }
.hero-sub { display: block; margin-top: 4px; font-size: 12px; color: var(--he-muted, var(--he-color-muted)); }
.source-status-summary{font-size:11px;line-height:1.4}
.hero-link { display:flex;align-items:center;min-height:34px;margin:4px 0;color:var(--he-color-accent);font-size:13px;line-height:1.4;text-decoration:none; }
.online-search { display:flex;flex-direction:column;gap:6px;padding:6px 16px;font-size:12px;color:var(--he-muted, var(--he-color-muted)); }
.search-box { margin-top: 12px; background: var(--he-surface, var(--he-color-surface)); border-radius: var(--he-input-radius, 13px); padding: 4px 12px; }
.search-input { height: 32px; font-size: 14px; color: var(--he-text, var(--he-color-text)); }
.ph { color: var(--he-muted, var(--he-color-muted)); }
.chips { white-space: nowrap; padding: 4px 0; }
.chips-inner { display: inline-flex; gap: 8px; padding: 0 16px; }
.chip { padding: 5px 12px; font-size: 12px; color: var(--he-muted, var(--he-color-muted)); background: var(--he-surface, var(--he-color-surface)); border-radius: 499.5px; }
.chip.on { color: var(--he-color-on-accent); background: var(--he-accent, var(--he-color-accent)); font-weight: 600; }
.list { height:0; min-height:0; flex:1; padding: 4px 16px 0; box-sizing: border-box; }
.card { background: var(--he-panel, var(--he-color-panel)); border-radius: var(--he-card-radius, 16px); padding: 12px; margin-bottom: 12px; }
.card-head { display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.card-status { font-size: 11px; color: var(--he-muted, var(--he-color-muted)); }
.name-review-tag { padding: 2px 6px; border: 1px solid rgba(var(--he-color-warning-rgb),.28); border-radius: 999px; color: var(--he-color-warning-text); background: rgba(var(--he-color-warning-rgb),.08); font-size: 9px; line-height: 1.35; white-space: nowrap; }
.card-region { margin-left: auto; font-size: 11px; color: var(--he-muted, var(--he-color-muted)); }
.card-name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: 2.7em; overflow: hidden; margin-top: 6px; font-size: 16px; line-height: 1.35; font-weight: 600; color: var(--he-text, var(--he-color-text)); }
.card-summary { display: block; margin-top: 4px; font-size: 12px; color: var(--he-muted, var(--he-color-muted)); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.card-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 11px; color: var(--he-muted, var(--he-color-muted)); }
.card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag { font-size: 10px; color: var(--he-muted, var(--he-color-muted)); background: var(--he-surface, var(--he-color-surface)); padding: 3px 8px; border-radius: 4px; }
.tag.nav { color: var(--he-accent, var(--he-color-accent)); }
.empty { text-align: center; color: var(--he-muted, var(--he-color-muted)); padding: 40px 0; font-size: 13px; }
.disclaimer { text-align: center; color: var(--he-muted, var(--he-color-muted)); font-size: 10px; padding: 12px 0 24px; }
@media(min-width:901px){.hero-link{font-size:14px}.hero-sub{font-size:10px}.card-name{font-size:14px}.card-status,.card-region,.card-summary,.card-meta{font-size:10px}}
</style>
