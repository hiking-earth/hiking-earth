<template>
  <scroll-view scroll-y class="page">
    <text class="title">收藏与行程</text><text class="hint">资料保存在本机。登录后开启“自动同步”，收藏和行程会同步到当前账号的其他设备；未开启时可在本页手动保存或恢复。行程不会改变路线的开放状态。</text>
    <text v-if="!libraryValid" class="warning">本机收藏或行程资料格式异常。为避免丢失，修改、云同步和恢复操作已停用；原始资料仍保留，请勿清理应用数据。</text>
    <text class="heading">收藏路线</text>
    <view v-for="id in library.favorites" :key="id" class="card"><text @click="detail(id)">{{ routeName(id) }}</text><button size="mini" :disabled="!libraryValid" @click="unfavorite(id)">取消收藏</button></view>
    <text v-if="!library.favorites.length" class="hint">在路线详情中收藏路线。</text>
    <text class="heading">创建行程</text>
    <RouteSearchPicker v-model="selected" placeholder="搜索或选择行程路线（可选）" />
    <input v-model="date" class="input date-input" placeholder="出发日期 YYYY-MM-DD" />
    <textarea v-model="notes" maxlength="2000" class="input" placeholder="集合点、交通、住宿和装备备忘" />
    <button :disabled="!libraryValid" @click="addPlan">保存行程</button>
    <view v-for="plan in library.plans" :key="plan.id" class="card">
      <text class="heading" @click="detail(plan.routeId)">{{ routeName(plan.routeId) }} · {{ plan.date }}</text>
      <textarea v-model="plan.notes" :disabled="!libraryValid" maxlength="2000" class="input" @blur="persist" />
      <button size="mini" :disabled="!libraryValid" @click="plan.packed = !plan.packed; persist()">{{ plan.packed ? '✓ 装备已检查' : '标记装备已检查' }}</button>
      <button size="mini" :disabled="!libraryValid" @click="removePlan(plan.id)">删除行程</button>
    </view>
    <view v-if="legacy" class="card"><text class="hint">发现旧版本未绑定账号的本机资料（{{ legacy.favorites.length }} 条收藏、{{ legacy.plans.length }} 个行程）。这些资料不会自动并入账号或上传。</text><button :disabled="busy || !libraryValid" @click="confirmLegacyImport">合并到当前本机资料</button></view>
    <view v-if="legacyInvalid" class="card"><text class="hint">发现格式异常的旧版本收藏或行程备份。为避免静默丢资料，备份未自动导入或删除；请勿清理应用数据。</text></view>
    <text v-if="deletedArchives.length" class="heading">已注销账号的待恢复备份</text>
    <view v-for="archive in deletedArchives" :key="archive.id" class="card">
      <text class="hint">备份编号 {{ archive.id.slice(-6) }} · </text>
      <text v-if="archive.valid" class="hint">{{ archive.favorites }} 条收藏、{{ archive.plans }} 个行程。编号不包含账号身份，请只恢复你能确认属于自己的资料。</text>
      <text v-else class="hint">格式异常，暂不能安全恢复；原始备份仍保留，请勿清理应用数据。</text>
      <button :disabled="busy || !libraryValid || !archive.valid" @click="confirmDeletedArchiveImport(archive)">合并到当前本机资料</button>
    </view>
    <text class="heading">云端资料</text><button :disabled="busy || !owner || !libraryValid || accountMergePending" @click="push">保存收藏与行程到当前账号</button><button :disabled="busy || !owner || !libraryValid || accountMergePending" @click="pull">恢复当前账号的收藏与行程</button><text v-if="accountMergePending" class="hint">账号资料仍在安全合并；完成后即可使用云端保存与恢复。</text><text v-else-if="!owner" class="hint">登录后可使用云端资料。</text><text class="hint">{{ message }}</text>
  </scroll-view>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { syncState } from '@/services/sync';
import { onShow, onUnload } from '@dcloudio/uni-app';
import { ROUTES } from '@/services/route-catalog';
import RouteSearchPicker from '@/components/RouteSearchPicker.vue';
import { acquireLibraryCloudLock, currentLibraryStorageValid, readLibrary, writeLibrary, toggleFavorite, libraryVersion, setLibraryVersion, validCloudLibrary, libraryOwner, legacyLibraryBackupStatus, importLegacyLibrary, listDeletedLibraryArchives, importDeletedLibraryArchive } from '@/services/library';
import type { DeletedLibraryArchive, Library } from '@/services/library';
import { accountSession, onAccountChange } from '@/services/account';
import { callCloud } from '@/services/cloud';
const library = ref(readLibrary()), selected = ref(''), date = ref(''), notes = ref(''), message = ref(''), busy = ref(false);
const initialLegacy = legacyLibraryBackupStatus();
const owner = ref(libraryOwner()), libraryValid = ref(currentLibraryStorageValid()), legacy = ref(initialLegacy.library), legacyInvalid = ref(initialLegacy.invalid), deletedArchives = ref(listDeletedLibraryArchives());
const accountMergePending = ref(!!accountSession()?.mergedIdentities?.length);
let loadedOwner = owner.value;
function refreshLibrary() { owner.value = libraryOwner(); loadedOwner = owner.value; accountMergePending.value=!!accountSession()?.mergedIdentities?.length; libraryValid.value = currentLibraryStorageValid(); library.value = readLibrary(); const legacyState = legacyLibraryBackupStatus(); legacy.value = legacyState.library; legacyInvalid.value = legacyState.invalid; deletedArchives.value = listDeletedLibraryArchives(); }
onShow(refreshLibrary);
// A foreground sync may finish after this page has already read its local copy.
watch(() => syncState.lastSuccess, refreshLibrary);
const unsubscribeAccount = onAccountChange(refreshLibrary);
onUnload(unsubscribeAccount);
function routeName(id: string) { return ROUTES.find(r => r.id === id)?.name || '路线资料暂不可用'; }
function detail(id: string) { uni.navigateTo({ url: `/pages/route/detail?id=${encodeURIComponent(id)}` }); }
function sameOwner(): boolean { if (loadedOwner === libraryOwner()) return true; refreshLibrary(); message.value = '账号已切换，已载入该账号独立保存的资料'; return false; }
function persist(): boolean { if (!sameOwner() || !libraryValid.value) return false; try { writeLibrary(library.value); return true; } catch (e: any) { libraryValid.value = currentLibraryStorageValid(); message.value = e?.message || '本机保存失败，请检查存储空间'; return false; } }
function unfavorite(id: string) { if (!sameOwner() || !libraryValid.value) return; try { toggleFavorite(id); library.value = readLibrary(); } catch (e: any) { libraryValid.value = currentLibraryStorageValid(); message.value = e?.message || '本机保存失败'; } }
function addPlan() {
  if (!sameOwner() || !libraryValid.value) return;
  if (!selected.value || !/^\d{4}-\d{2}-\d{2}$/.test(date.value) || Number.isNaN(Date.parse(date.value)) || new Date(date.value).toISOString().slice(0,10) !== date.value) { message.value = '请选择路线并填写有效日期'; return; }
  if (library.value.plans.length >= 100) { message.value = '最多保存100个行程'; return; }
  library.value.plans.unshift({ id: `plan-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, routeId: selected.value, date: date.value, notes: notes.value, packed: false }); if (persist()) notes.value = '';
}
function removePlan(id: string) { if (!libraryValid.value) return; uni.showModal({ title: '删除行程', content: '确认删除该行程？', success: r => { if (r.confirm && sameOwner() && libraryValid.value) { library.value.plans = library.value.plans.filter(p => p.id !== id); persist(); } } }); }
function confirmLegacyImport() {
  if (busy.value || !libraryValid.value) return;
  const target = libraryOwner();
  const destination = target ? '当前登录账号的本机资料' : '本机匿名资料';
  uni.showModal({ title: '导入旧版本机资料', content: `将旧版本中未绑定账号的收藏和行程合并到${destination}，不会直接上传云端。继续前请确认这些资料属于你。`, success: result => {
    if (!result.confirm || target !== libraryOwner()) return;
    try { const imported = importLegacyLibrary(); refreshLibrary(); message.value = `已合并旧资料：${imported.favorites} 条收藏、${imported.plans} 个行程`; }
    catch (e: any) { message.value = e?.message || '合并失败，旧资料仍保留'; }
  } });
}
function confirmDeletedArchiveImport(archive: DeletedLibraryArchive) {
  if (busy.value || !libraryValid.value || !archive.valid) return;
  const target = libraryOwner();
  const destination = target ? '当前登录账号的本机资料' : '本机匿名资料';
  uni.showModal({ title: '恢复已注销账号的本机资料', content: `将备份编号 ${archive.id.slice(-6)} 中的收藏和行程合并到${destination}，不会直接上传云端。备份编号不显示账号身份，请只在确认资料属于你时继续。`, success: result => {
    if (!result.confirm || target !== libraryOwner() || !sameOwner()) return;
    try {
      const imported = importDeletedLibraryArchive(archive.id);
      refreshLibrary();
      message.value = `已合并注销账号备份：${imported.favorites} 条收藏、${imported.plans} 个行程`;
    } catch (e: any) { message.value = e?.message || '恢复失败，原备份仍保留'; }
  } });
}
async function push() {
  if (busy.value || !libraryValid.value) return; busy.value = true;
  if(accountSession()?.mergedIdentities?.length){accountMergePending.value=true;busy.value=false;message.value='账号资料仍在安全合并，完成后再保存云端资料';return;}
  const requestOwner = libraryOwner();
  if (!requestOwner) { busy.value = false; message.value = '请先登录统一账号'; return; }
  if (!sameOwner()) { busy.value = false; return; }
  if (!currentLibraryStorageValid()) { libraryValid.value = false; busy.value = false; message.value = '本机收藏或行程资料格式异常，已停止云端保存以免上传不完整资料'; return; }
  let releaseCloud: (() => void) | undefined;
  try {
    releaseCloud = await acquireLibraryCloudLock();
    if (requestOwner !== libraryOwner() || !sameOwner()) return;
    if(accountSession()?.mergedIdentities?.length){accountMergePending.value=true;message.value='账号资料仍在安全合并，未保存云端资料';return;}
    if (!currentLibraryStorageValid()) { libraryValid.value = false; message.value = '本机收藏或行程资料格式异常，已停止云端保存以免上传不完整资料'; return; }
    const snapshot=JSON.parse(JSON.stringify(readLibrary())) as Library;
    const version=libraryVersion();
    const result = await callCloud<{ version: number }>('library-manage', { action: 'save', ...snapshot, version });
    if (requestOwner !== libraryOwner()) return;
    if (result.ok && result.data) { if(!Number.isSafeInteger(result.data.version)||result.data.version!==version+1){message.value='云端版本响应无效，请重新同步';return;} setLibraryVersion(result.data.version,snapshot); message.value = !currentLibraryStorageValid() ? '云端已保存提交时的资料；本机资料随后异常，已停止覆盖，请保留应用数据' : JSON.stringify(readLibrary())===JSON.stringify(snapshot) ? '云端资料已保存' : '云端已保存提交时的资料；本机随后有新改动，请再次保存'; } else message.value = result.errMsg || '保存失败';
  } catch (e: any) { if(requestOwner===libraryOwner())message.value=e?.message || '云端保存未完成，请稍后重试'; } finally { releaseCloud?.(); busy.value = false; }
}
function pull() {
  if (!libraryValid.value) return;
  uni.showModal({ title: '恢复云端资料', content: '用当前账号的云端收藏与行程替换本机资料。', success: async choice => {
    if (!choice.confirm || busy.value) return; busy.value = true;
    if(accountSession()?.mergedIdentities?.length){accountMergePending.value=true;busy.value=false;message.value='账号资料仍在安全合并，完成后再恢复云端资料';return;}
    const requestOwner = libraryOwner();
    if (!requestOwner) { busy.value = false; message.value = '请先登录统一账号'; return; }
    if (!sameOwner()) { busy.value = false; return; }
    let releaseCloud: (() => void) | undefined;
    try {
      releaseCloud = await acquireLibraryCloudLock();
      if (requestOwner !== libraryOwner() || !sameOwner()) return;
      if(accountSession()?.mergedIdentities?.length){accountMergePending.value=true;message.value='账号资料仍在安全合并，未恢复云端资料';return;}
      if (!currentLibraryStorageValid()) { libraryValid.value = false; message.value = '本机收藏或行程资料格式异常，已停止恢复以保留原始资料'; return; }
      const original=JSON.stringify(readLibrary());
      const result = await callCloud<Library & { version: number }>('library-manage', { action: 'get' });
      if (requestOwner !== libraryOwner()) return;
      if(JSON.stringify(readLibrary())!==original){message.value='本机资料已变化，请重新确认恢复';return;}
      if (result.ok && result.data) { if(!validCloudLibrary(result.data)){message.value='云端资料格式无效，本机资料未覆盖';return;} writeLibrary({ favorites: result.data.favorites, plans: result.data.plans }); setLibraryVersion(result.data.version); library.value = readLibrary(); message.value = '已恢复'; }
      else message.value = result.errMsg || '恢复失败';
    } catch (e: any) { if(requestOwner===libraryOwner())message.value = e?.message || '本机保存失败'; } finally { releaseCloud?.(); busy.value = false; }
  } });
}
</script>
<style scoped>
.page{height:100vh;box-sizing:border-box;padding:24px 20px;background:var(--he-color-background);color:var(--he-color-text)}.title{display:block;font-size:24px;font-weight:700}.hint{display:block;margin:12px 0;color:var(--he-color-muted);font-size:13px;line-height:1.7}.heading{display:block;font-weight:600;margin:20px 0 12px}.card{background:var(--he-color-panel);padding:16px;border-radius: var(--he-card-radius, 16px);margin-bottom:12px}.input{background:var(--he-color-surface);padding:12px;box-sizing:border-box;width:100%;margin:12px 0;border-radius: var(--he-input-radius, 13px);}.date-input{height:44px;min-height:44px}.date-input :deep(.uni-input-input){height:44px;min-height:44px}button{font-size:14px;margin:10px 0;background:var(--he-color-accent);color:var(--he-color-on-accent)}
</style>
