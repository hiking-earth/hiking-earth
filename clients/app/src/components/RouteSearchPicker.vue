<template>
  <view class="route-picker">
    <view v-if="selectedRoute" class="selected">
      <text class="selected-name">{{ selectedRoute.name }}</text>
      <text class="selected-region">{{ selectedRoute.region }}</text>
      <button size="mini" :disabled="disabled" @click="clear">清除</button>
    </view>
    <view v-else-if="modelValue" class="selected">
      <text class="selected-region">已关联路线暂不在本机目录中</text>
      <button size="mini" :disabled="disabled" @click="clear">清除</button>
    </view>
    <text v-else class="selected-placeholder">{{ placeholder }}</text>
    <input v-model="query" :disabled="disabled" class="search" maxlength="100" placeholder="按路线名称或地区搜索" />
    <scroll-view v-if="query.trim().length" scroll-y class="results">
      <text v-if="localMatches.length" class="label">本机已载入目录</text>
      <view v-for="route in localMatches" :key="`local-${route.id}`" class="result" @click="choose(route)">
        <text class="result-name">{{ route.name }}</text><text class="result-meta">{{ route.region }} · {{ route.archive.source.label }}</text>
      </view>
      <view class="online-tools">
        <picker :range="sourceNames" :disabled="disabled || loading" @change="changeSource">
          <text class="source">{{ sourceNames[sourceIndex] }}⌄</text>
        </picker>
        <button size="mini" :disabled="disabled || loading || query.trim().length < 2" @click="searchOnline(false)">{{ loading ? '搜索中…' : '在线搜索' }}</button>
      </view>
      <text v-if="onlineMessage" class="message">{{ onlineMessage }}</text>
      <view v-for="route in onlineMatches" :key="`online-${route.id}`" class="result" @click="choose(route)">
        <text class="result-name">{{ route.name }}</text><text class="result-meta">{{ route.region }} · {{ route.archive.source.label }}</text>
      </view>
      <button v-if="onlineHasMore" size="mini" :disabled="disabled || loading" @click="searchOnline(true)">{{ loading ? '读取中…' : '显示更多匹配路线' }}</button>
      <text v-if="searched && !onlineMatches.length && !loading && !onlineMessage" class="message">这个来源没有匹配结果。</text>
      <text class="notice">目录收录不代表路线当前开放或适合导航；请查看来源和现场公告。</text>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ROUTES, rememberDiscoveredRoute } from '@/services/route-catalog';
import { searchPublicCatalog, type PublicCatalogSource } from '@/services/catalog-search';
import type { HikingRoute } from '@shared/types/route';

const props = withDefaults(defineProps<{ modelValue?: string; placeholder?: string; disabled?: boolean }>(), {
  modelValue: '', placeholder: '关联路线（可选）', disabled: false,
});
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void; (event: 'selected', value: HikingRoute | null): void }>();
const sources: { id: PublicCatalogSource; name: string }[] = [
  { id: 'osm', name: 'OpenStreetMap' },
  { id: 'usfs', name: '美国国家森林' },
  { id: 'hk', name: '香港官方步道' },
  { id: 'nzdoc', name: '新西兰环保部官方步道' },
  { id: 'parkscanada', name: '加拿大公园管理局' },
  { id: 'nsw-npws', name: '新南威尔士州公园步道' },
  { id: 'england', name: 'Natural England 国家步道' },
  { id: 'wales', name: '威尔士国家步道' },
  { id: 'japan-tokai', name: '日本·东海自然步道' },
  { id: 'scotland-argyll', name: '苏格兰阿盖尔-比特核心步道' },
  { id: 'ni-midulster', name: '北爱尔兰米德阿尔斯特公共通行权' },
  { id: 'norfolk-prow', name: '英格兰诺福克公共通行权' },
  { id: 'cambridgeshire-prow', name: '英格兰剑桥郡公共通行权' },
  { id: 'nps-public-trails', name: '美国国家公园步道（NPS）' },
  { id: 'usgs-trails', name: '美国全国数字步道（USGS）' },
  { id: 'swisstopo-wanderwege', name: '瑞士 swisstopo 官方徒步网络（待核验）' },
  { id: 'victoria-recreation-tracks', name: '澳大利亚·维多利亚州官方步道' },
  { id: 'queensland-qpws-trails', name: '澳大利亚·昆士兰州官方步道' },
  { id: 'taiwan-trails', name: '台湾观光署官方步道（待核验）' },
  { id: 'korea-durunubi-trails', name: '韩国·DuruNubi 韩国环线步道（待核验）' },
];
const sourceNames = sources.map(source => source.name);
const sourceIndex = ref(0), query = ref(''), localQuery = ref(''), onlineMatches = ref<HikingRoute[]>([]), onlineMessage = ref(''), loading = ref(false), searched = ref(false), onlineHasMore = ref(false);
let onlineSnapshot = '', onlineOffset = 0, localTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
const selectedRoute = computed(() => ROUTES.find(route => route.id === props.modelValue));
const localMatches = computed(() => {
  if (localQuery.value !== query.value.trim()) return [];
  const term = localQuery.value.trim().normalize('NFKC').toLocaleLowerCase();
  if (!term) return [];
  const matches: HikingRoute[] = [];
  for (const route of ROUTES) {
    if (`${route.name} ${route.region}`.normalize('NFKC').toLocaleLowerCase().includes(term)) matches.push(route);
    if (matches.length >= 8) break;
  }
  return matches;
});

function clearSearch() { generation++; loading.value = false; onlineMatches.value = []; onlineMessage.value = ''; searched.value = false; onlineHasMore.value = false; onlineSnapshot = ''; onlineOffset = 0; }
function changeSource(event: any) { if (props.disabled || loading.value) return; sourceIndex.value = Math.min(Math.max(Number(event.detail.value) || 0, 0), sources.length - 1); clearSearch(); }
function choose(route: HikingRoute) {
  if (props.disabled) return;
  rememberDiscoveredRoute(route);
  emit('update:modelValue', route.id);
  emit('selected', route);
  query.value = '';
  clearSearch();
}
function clear() { if (props.disabled) return; emit('update:modelValue', ''); emit('selected', null); query.value = ''; clearSearch(); }
watch(query, value => {
  clearSearch();
  if (localTimer) clearTimeout(localTimer);
  localTimer = setTimeout(() => { localQuery.value = value.trim(); }, 160);
});
watch(() => props.disabled, value => {
  if (!value) return;
  clearSearch(); query.value = ''; localQuery.value = '';
  if (localTimer) clearTimeout(localTimer);
});
async function searchOnline(more = false) {
  const term = query.value.trim();
  if (props.disabled || loading.value || term.length < 2 || more && !onlineHasMore.value) return;
  const request = ++generation;
  loading.value = true; searched.value = true; onlineMessage.value = '';
  if (!more) { onlineMatches.value = []; onlineSnapshot = ''; onlineOffset = 0; onlineHasMore.value = false; }
  try {
    const page = await searchPublicCatalog(sources[sourceIndex.value].id, term, more ? onlineOffset : 0, more ? onlineSnapshot : undefined);
    if (request !== generation) return;
    onlineMatches.value = more ? [...onlineMatches.value, ...page.routes] : page.routes;
    onlineSnapshot = page.snapshot; onlineOffset = page.offset + page.routes.length; onlineHasMore.value = page.hasMore;
    onlineMessage.value = `匹配 ${page.total} 条，已读取 ${onlineMatches.value.length} 条。`;
  } catch (error) {
    if (request === generation) onlineMessage.value = error instanceof Error ? error.message : '在线目录暂不可用，请稍后重试。';
  } finally {
    if (request === generation) loading.value = false;
  }
}
onBeforeUnmount(() => { generation++; if (localTimer) clearTimeout(localTimer); });
</script>

<style scoped>
.route-picker{margin:10px 0;padding:12px;background:var(--he-color-surface);border-radius:var(--he-card-radius, 16px)}.selected{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.selected-name{font-weight:600;color:var(--he-color-text)}.selected-region,.selected-placeholder,.label,.message,.notice{color:var(--he-color-muted);font-size:12px}.selected button{margin-left:auto}.search{height:40px;margin-top:8px;padding:0 10px;background:var(--he-color-panel);border-radius: var(--he-input-radius, 13px);color:var(--he-color-text)}.results{height:240px;margin-top:8px}.label{display:block;padding:8px 0}.result{padding:10px 8px;border-top:1px solid var(--he-color-border)}.result-name{display:block;color:var(--he-color-text)}.result-meta{display:block;margin-top:3px;color:var(--he-color-muted);font-size:11px}.online-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0}.source{color:var(--he-color-accent);font-size:13px}.online-tools button{margin:0}.message,.notice{display:block;line-height:1.6;padding:6px 0}.notice{color:var(--he-color-warning)}
</style>
