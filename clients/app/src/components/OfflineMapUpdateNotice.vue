<template>
 <view v-if="update" class="update-notice">
  <text>目录有同地区较新日期的地图：{{update.label}} · {{(update.bytes/1048576).toFixed(2)}} MiB</text>
  <text class="hint">日期用于区分地图包，不代表数据实时性或步道开放许可。请核对下载目录中的覆盖地区与来源。新版单独保存，旧版保留；空间不足时请自行选择要删除的包。</text>
  <button class="he-primary" :disabled="disabled" @click="download">下载新版并保留旧版</button>
 </view>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import {findNewerMapPack,type MapCatalogPack} from '@/services/basemap-catalog';
const props=defineProps<{name:string;catalog:MapCatalogPack[];saved:{name:string}[];disabled:boolean}>();
const emit=defineEmits<{(event:'download',pack:MapCatalogPack):void}>();
const update=computed(()=>findNewerMapPack(props.name,props.catalog,props.saved.map(row=>row.name)));
function download(){if(!props.disabled&&update.value)emit('download',update.value);}
</script>
<style scoped>
.update-notice{margin:10px 0;padding:10px;border:1px solid var(--he-color-accent);border-radius:var(--he-card-radius,16px)}
text{display:block;line-height:1.6}.hint{font-size:12px;color:var(--he-color-muted);margin:6px 0}button{margin-top:8px}
</style>
