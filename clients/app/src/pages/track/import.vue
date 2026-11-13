<template>
  <view class="page">
    <text class="title">导入 GPX 轨迹</text>
    <text class="hint">轨迹保存在本机。最多 5 MB、20000 个点；保留分段，不会自动上传。</text>
    <text v-if="!storeValid" class="error">本机轨迹列表格式异常，已停用导入保存以保留原始资料。请勿清理应用数据。</text>
    <!-- #ifdef APP-PLUS --><button @click="chooseNative">从系统文件选择</button><!-- #endif -->
    <!-- #ifdef H5 -->
    <button @click="chooseFile">选择 GPX 文件</button>
    <!-- #endif -->
    <!-- #ifdef MP-WEIXIN -->
    <button @click="chooseWechatFile">从聊天文件选择 GPX</button>
    <!-- #endif -->
    <textarea v-model="source" :maxlength="5242880" class="source" placeholder="也可以粘贴 GPX 文件内容（以 <gpx 开始的 XML）" />
    <text v-if="error" class="error">{{ error }}</text>
    <button :disabled="!storeValid" @click="save">导入并保存</button>
  </view>
</template>
<script setup lang="ts">
import { chooseNativeText } from '@/services/files';
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { isDesktop, chooseDesktopGpx } from '@/services/desktop';
import { importGpx } from '@/services/gpx';
import { saveTrack, currentTrackOwner, trackStorageValid } from '@/services/tracks';
const source = ref('');
const error = ref('');
const storeValid = ref(trackStorageValid());
onShow(()=>{storeValid.value=trackStorageValid();});
function save() {
  try { const track = importGpx(source.value); track.localOwner = currentTrackOwner() || 'anonymous'; saveTrack(track); uni.redirectTo({ url: `/pages/track/detail?id=${track.id}` }); }
  catch (e) { error.value = e instanceof Error ? e.message : '导入失败，文件未保存'; }
}
async function chooseNative() { try { const text = await chooseNativeText(); if (text !== null) source.value = text; } catch (e) { error.value = e instanceof Error ? e.message : '文件读取失败'; } }
// #ifdef H5
async function chooseFile() {
  if (isDesktop()) {
    try { const text = await chooseDesktopGpx(); if (text !== null) { source.value = text; error.value = ''; } }
    catch (e) { error.value = String(e); }
    return;
  }
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.gpx,application/gpx+xml';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { error.value = '文件超过 5 MB'; return; }
    try { source.value = await file.text(); error.value = ''; } catch { error.value = '文件读取失败'; }
  };
  input.click();
}
// #endif
// #ifdef MP-WEIXIN
function chooseWechatFile() {
  uni.chooseMessageFile({ count: 1, type: 'file', extension: ['gpx'], success: (r) => {
    if (r.tempFiles[0].size > 5 * 1024 * 1024) { error.value = '文件超过 5 MB'; return; }
    uni.getFileSystemManager().readFile({ filePath: r.tempFiles[0].path, encoding: 'utf8', success: r => { source.value = String(r.data); error.value = ''; }, fail: () => { error.value = '文件读取失败'; } });
  } });
}
// #endif
</script>
<style scoped>
.page { padding: 16px; color: var(--he-color-text); background: var(--he-color-background); min-height: 100vh; }
.title { display: block; font-size: 18px; }
.hint { display: block; color: var(--he-color-muted); margin: 12px 0; }
.source { background: var(--he-color-panel); padding: 12px; box-sizing: border-box; width: 100%; height: 225px; margin: 12px 0; }
.error { display: block; color: var(--he-color-danger); margin: 8px 0; }
button { background: var(--he-color-accent); color: var(--he-color-on-accent); }
</style>
