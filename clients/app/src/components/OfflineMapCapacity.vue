<template>
  <view class="capacity-card">
    <view class="capacity-heading">
      <text class="capacity-label">本机地图目录容量</text>
      <text class="capacity-value">{{ capacityValid ? usedMiB + ' / ' + limitMiB + ' MiB' : '容量暂不可用' }}</text>
    </view>
    <view class="capacity-track"><view class="capacity-fill" :style="{ width: (capacityValid ? percentage : 0) + '%' }" /></view>
    <text class="capacity-hint">{{ capacityValid ? '剩余 ' + remainingMiB + ' MiB · 单个地图包最多 64 MiB' : '无法确认本机已保存地图容量，请保留地图包并重新读取目录。' }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { OFFLINE_MAP_STORAGE_BUDGET_BYTES } from '@/services/offline-map-limits';

const props = defineProps<{ bytes: number | null }>();
const budget = OFFLINE_MAP_STORAGE_BUDGET_BYTES;
const capacityValid = computed(() => Number.isSafeInteger(props.bytes) && (props.bytes ?? -1) >= 0);
const used = computed(() => capacityValid.value ? props.bytes as number : 0);
const percentage = computed(() => Math.min(100, used.value / budget * 100));
const usedMiB = computed(() => (used.value / 1048576).toFixed(2));
const remainingMiB = computed(() => (Math.max(0, budget - used.value) / 1048576).toFixed(2));
const limitMiB = budget / 1048576;
</script>

<style scoped>
.capacity-card{margin:10px 0;padding:12px 14px;border:1px solid var(--he-color-border);border-radius:14px;background:var(--he-color-panel)}
.capacity-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}
.capacity-label{font-size:13px;color:var(--he-color-text)}
.capacity-value{font-size:12px;font-variant-numeric:tabular-nums;color:var(--he-color-accent)}
.capacity-track{height:7px;margin-top:10px;overflow:hidden;border-radius:999px;background:var(--he-color-surface)}
.capacity-fill{height:100%;border-radius:inherit;background:var(--he-color-accent);box-shadow:0 0 8px rgba(var(--he-color-accent-rgb),.28);transition:width .2s ease}
.capacity-hint{display:block;margin-top:7px;font-size:11px;line-height:1.5;color:var(--he-color-muted)}
</style>
