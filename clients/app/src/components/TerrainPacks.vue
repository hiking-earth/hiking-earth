<template>
 <view class="terrain-card">
  <text class="heading">可选离线高程包</text>
  <text class="hint">只导入你主动选择的Terrarium地形ZIP，不自动下载、不上传。高程多源精度不同，仅作地形参考，不能证明步道开放或现场安全。与详细地图共用192 MiB上限；单包最多33 MiB。</text>
  <button :disabled="busy" @click="choose">选择本机地形ZIP</button>
  <text v-if="message" class="hint">{{message}}</text>
  <view v-for="row in rows" :key="row.id" class="row"><text>{{row.name}} · {{(row.bytes/1048576).toFixed(2)}} MiB</text><button :disabled="busy" @click="inspect(row)">查看离线地形与署名</button><button :disabled="busy" @click="remove(row)">删除地形包</button></view>
  <TerrainPreview v-if="preview" :key="preview.manifest.id+preview.sha256" :archive="preview" />
  <view v-if="info" class="details"><text>{{info}}</text></view>
 </view>
</template>
<script setup lang="ts">
import {ref,onMounted,shallowRef,markRaw} from 'vue';
import TerrainPreview from './TerrainPreview.vue';
import type {TerrainArchive} from '@/services/terrain-archive';
const preview=shallowRef<TerrainArchive|null>(null);
import {listTerrain,importTerrain,deleteTerrain,decodeTerrain,type SavedTerrain} from '@/services/terrain-store';
const rows=ref<SavedTerrain[]>([]),busy=ref(false),message=ref(''),info=ref('');
const emit=defineEmits<{(e:'changed'):void}>();
async function refresh(){try{rows.value=await listTerrain();}catch(e){message.value=e instanceof Error?e.message:'地形目录读取失败';}}
onMounted(refresh);
function choose(){const input=document.createElement('input');input.type='file';input.accept='.zip';input.onchange=async()=>{const file=input.files?.[0];if(!file||busy.value)return;busy.value=true;try{await importTerrain(file);message.value='地形资料已保存在本机；没有上传。';await refresh();emit('changed');}catch(e){message.value=e instanceof Error?e.message:'地形导入失败';}finally{busy.value=false;input.value='';}};input.click();}
async function inspect(row:SavedTerrain){if(busy.value)return;busy.value=true;try{const archive=await decodeTerrain(row.blob,row.sha256);preview.value=markRaw(archive);info.value=`区域 ${archive.manifest.bounds.join(', ')} · 缩放 ${archive.manifest.zoom} · ${archive.manifest.tiles.length} 张高程瓦片\n${archive.manifest.attribution}\n${archive.manifest.licenseUrl}`;}catch(e){message.value=e instanceof Error?e.message:'地形资料读取失败';}finally{busy.value=false;}}
async function remove(row:SavedTerrain){if(busy.value)return;uni.showModal({title:'删除离线地形',content:`仅删除本机的 ${row.name}，不影响轨迹记录。`,success:async result=>{if(!result.confirm||busy.value)return;busy.value=true;try{await deleteTerrain(row.id);info.value='';preview.value=null;await refresh();emit('changed');}catch(e){message.value=e instanceof Error?e.message:'删除失败';}finally{busy.value=false;}}});}
</script>
<style scoped>
.terrain-card{margin:12px 0;padding:14px;border-radius:14px;border:1px solid var(--he-color-border);background:var(--he-color-panel);color:var(--he-color-text)}.heading{display:block;font-size:17px;font-weight:650}.hint{display:block;margin:8px 0;font-size:12px;line-height:1.6;color:var(--he-color-muted)}.row{padding-top:12px;border-top:1px solid var(--he-color-border)}.details{white-space:pre-wrap;font-size:11px;line-height:1.6;overflow-wrap:anywhere;color:var(--he-color-muted)}button{margin-top:8px}
</style>
