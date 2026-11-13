<template>
  <scroll-view scroll-y class="page">
    <text class="title">{{ session ? '账号管理' : '徒步地球账号' }}</text>
    <text class="intro">同一账号可在手机、网页和桌面使用云端轨迹、组队与社区。</text>
    <!-- #ifdef H5 -->
    <view v-if="!session" class="card">
      <text class="subtitle">微信扫码登录</text>
      <image v-if="qrImage" :src="qrImage" style="width:280px;height:280px" />
      <text class="hint">{{ qrScanMode === 'wechat-mini-program' ? '用微信扫一扫即可直达小程序确认页；核对设备名称后再确认登录。' : '当前未能生成可直达小程序的码；请先打开徒步地球小程序，进入“扫码登录网页或桌面”后手动扫描。' }} 二维码3分钟有效。</text>
      <button :disabled="qrStarting" @click="startQr">{{ qrStarting ? '正在生成…' : '生成 / 刷新登录二维码' }}</button>
      <button v-if="qrImage" @click="stopQr()">取消扫码登录</button>
    </view>
    <!-- #endif -->
    <view v-if="!session" class="card">
      <!-- #ifdef MP-WEIXIN -->
      <view class="wechat-login">
        <text class="subtitle">微信一键登录</text>
        <text class="hint">使用微信身份创建或登录后，可在网页和桌面通过二维码确认使用同一账号。{{ phoneBindingEnabled ? '服务端手机号关联入口已开放；实际使用仍需微信平台资格和用户主动授权。' : '手机号关联当前未确认可用（服务端配置、微信平台资格或接口权限可能未满足）。' }}跨端也可使用账号和密码登录。</text>
        <button class="primary he-primary" :disabled="busy" @click="loginWithWeChat">{{ busy ? '正在确认微信身份…' : '微信一键登录' }}</button>
        <button class="primary he-primary" :disabled="busy || !phoneBindingEnabled" open-type="getPhoneNumber" @getphonenumber="loginWithPhone">{{ phoneBindingEnabled ? '微信 + 手机号关联登录' : '手机号关联暂不可用' }}</button>
        <text v-if="!phoneBindingEnabled" class="hint">手机号验证码登录也未接入。不会用手动填写或测试号码代替微信验证；当前继续使用微信登录、网页/桌面扫码确认或账号密码登录。</text>
      </view>
      <!-- #endif -->
      <view class="tabs">
        <button v-for="item in modes" :key="item.value" :class="{ active: mode === item.value }" @click="mode = item.value">{{ item.label }}</button>
      </view>
      <input v-model="username" maxlength="32" :placeholder="mode === 'sign-in' ? (phoneBindingEnabled ? '账号或已关联手机号（含国家区号）' : '账号') : '账号：4–32位字母或数字'" />
      <text v-if="mode === 'sign-in' && phoneBindingEnabled" class="hint">手机号登录使用已关联手机号和账号密码，不需要短信验证码。先在小程序内完成微信手机号授权关联。</text>
      <text v-if="mode === 'sign-in' && !phoneBindingEnabled" class="hint">当前使用账号和密码登录；手机号关联尚未确认可用，本项目不发送短信验证码。</text>
      <input v-if="mode === 'register'" v-model="nickname" maxlength="24" placeholder="昵称" />
      <input v-if="mode === 'recover'" v-model="code" maxlength="64" placeholder="注册时保存的恢复码" />
      <input v-model="password" password maxlength="128" :placeholder="mode === 'recover' ? '新密码（至少10个字符）' : '密码（至少10个字符）'" />
      <text v-if="mode === 'register'" class="hint">注册后会提供一次性恢复码。请妥善保存，忘记密码时可用它重置密码。</text>
      <button class="primary he-primary" :disabled="busy || !configured" @click="submit">{{ busy ? '正在提交…' : modes.find(item => item.value === mode)?.label }}</button>
    </view>
    <view v-else class="card">
      <text class="subtitle">{{ session.username }}</text>
      <text class="hint">统一账号 ID（用于核对管理员归属）</text>
      <text selectable class="account-id">{{ session.openid }}</text>
      <button :disabled="busy" @click="copyAccountId">复制账号 ID</button>
      <view v-if="session.mergedIdentities?.length" class="merge-pending">
        <text class="subtitle">本机资料归并尚未完成</text>
        <text class="hint">云端账号已统一；原账号下的本机收藏、行程或轨迹仍保留在原身份分区，不会因登录而删除。释放本机存储空间后可重试安全归并。</text>
        <button :disabled="busy" @click="retryLocalMerge">重试本机资料归并</button>
      </view>
      <view v-if="libraryArchivesLoading || libraryArchivesError" class="merge-archives">
        <text class="hint">{{ libraryArchivesLoading ? '正在检查账号归并资料归档…' : libraryArchivesError }}</text>
        <button v-if="libraryArchivesError" :disabled="busy" @click="refreshLibraryArchives">重试检查归档</button>
      </view>
      <view v-if="libraryArchives.length" class="merge-archives">
        <text class="subtitle">合并时保留的收藏与行程</text>
        <text class="hint">这些来源资料因当前账号容量上限已安全归档。恢复前需留出足够容量；失败时归档仍会保留。</text>
        <view v-for="archive in libraryArchives" :key="archive.id" class="archive-row">
          <text class="hint">{{ archive.favorites }} 条收藏 · {{ archive.plans }} 个行程</text>
          <button :disabled="busy" @click="restoreLibraryArchive(archive)">{{ busy ? '正在恢复…' : '恢复到当前云端账号' }}</button>
        </view>
      </view>
      <!-- #ifdef MP-WEIXIN -->
      <view v-if="phoneBindingEnabled" class="phone-link">
        <text class="subtitle">微信与手机号关联</text>
        <text v-if="session.phoneMasked" class="hint">已关联 {{ session.phoneMasked }}。手机号本身不保存在客户端；再次验证同一微信手机号时，会把分开的账号资料安全迁移到同一账号。</text>
        <view v-else-if="phoneBindingEnabled">
          <text class="hint">在小程序登录现有账号后，点击并由微信弹窗确认，可将当前微信身份和手机号关联到该账号；网页和桌面之后扫码进入同一账号。手机号+账号密码也可登录；不会发送短信验证码。若微信和手机号分别属于旧账号，系统会在验证后迁移两边的云端资料。</text>
          <button class="primary he-primary" :disabled="busy" open-type="getPhoneNumber" @getphonenumber="bindPhone">{{ busy ? '正在安全关联…' : '微信授权并关联手机号' }}</button>
          <text class="hint">若该手机号已经属于另一个账号，系统将合并两边的云端资料；迁移期间两边账号暂时不可用，完成后用同一账号登录。</text>
        </view>
      </view>
      <!-- #endif -->
      <input v-model="nickname" maxlength="24" placeholder="昵称" />
      <button :disabled="busy" @click="updateNickname">保存昵称</button>
      <button @click="openModeration">社区管理（授权管理员）</button>
      <view v-if="!wechatAccount"><text class="subtitle">修改密码</text>
      <input v-model="password" password maxlength="128" placeholder="当前密码" />
      <input v-model="newPassword" password maxlength="128" placeholder="新密码（至少10个字符）" />
      <button :disabled="busy" @click="updatePassword">更新密码并退出其他设备</button></view>
      <view v-else-if="session.phoneMasked"><text class="subtitle">设置或更新账号密码</text>
      <input v-model="newPassword" password maxlength="128" placeholder="新密码（至少10个字符）" />
      <button :disabled="busy" @click="updatePassword">保存密码并退出其他设备</button></view>
      <button :disabled="busy" @click="logout(false)">退出当前设备</button>
      <button :disabled="busy" @click="logout(true)">退出所有设备</button>
      <text class="hint">注销会删除当前账号及已合并历史身份名下的云端个人资料，包括轨迹、收藏与行程云副本、队伍、约伴与报名、求助、日记留言、通知、地图申请和合并归档，并解散你创建的队伍。本机轨迹仍保留在原身份分区；本机收藏与行程会移入待确认备份。</text>
      <button :disabled="busy" @click="deleteAccount">注销账号 / 继续注销</button>
    </view>
    <view v-if="recoveryCode" class="card recovery">
      <text class="subtitle">请保存新的恢复码</text>
      <text selectable class="code">{{ recoveryCode }}</text>
      <text class="hint">仅本次显示。重置密码后，旧恢复码失效。不要把恢复码发给其他人。</text>
      <button @click="copyRecovery">复制恢复码</button>
      <button @click="recoveryCode = ''">我已保存</button>
    </view>
    <text v-if="message" class="message">{{ message }}</text>
    <text v-if="!configured" class="hint">账号服务正在接入，当前尚不能提交。</text>
    <text class="hint">微信登录后可通过小程序扫码确认，让网页和桌面使用同一账号。{{ phoneBindingEnabled ? '已关联手机号可配合账号密码登录；实际授权仍以微信平台结果为准；本项目不发送短信验证码。' : '手机号关联尚未确认可用；请使用账号和密码登录。' }}</text>
  </scroll-view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { accountApiConfigured, accountRequest, accountSession, clearAccount, clearDeletedAccountRequests, saveAccount, onAccountChange } from '@/services/account';
import { beginDeviceLogin, claimDeviceLogin, cancelDeviceLogin, QrLoginError, type DeviceChallenge } from '@/services/qr-login';
import { isDesktop } from '@/services/desktop';
import { bindMiniProgramPhone, exchangeMiniProgramWeChat, miniProgramPhoneBindingEnabled } from '@/services/wechat-login';
import { archiveDeletedAccountLibrary } from '@/services/library';
import type { AccountSession, AccountProfile } from '@/services/account';
const modes = [{ value: 'sign-in', label: '登录' }, { value: 'register', label: '注册' }, { value: 'recover', label: '恢复密码' }] as const;
const mode = ref<string>('sign-in'), username = ref(''), nickname = ref(''), password = ref(''), code = ref(''), newPassword = ref('');
const recoveryCode = ref(''), message = ref(''), busy = ref(false), session = ref<AccountSession | null>(null);
const configured = accountApiConfigured();
const wechatAccount = computed(() => session.value?.username.startsWith('wx_') === true);
const phoneBindingEnabled = ref(false);
type LibraryMergeArchive = { id: string; favorites: number; plans: number; createdAt: number };
const libraryArchives = ref<LibraryMergeArchive[]>([]);
const libraryArchivesLoading = ref(false), libraryArchivesError = ref('');
declare const wx: any;
function refreshSession(){session.value=accountSession();nickname.value=session.value?.nickname||'';}
function returnAfterRequiredLogin(){
  // #ifdef H5
  const pages=getCurrentPages(),current=pages[pages.length-1] as any;
  if(current?.route==='pages/account/account'&&current?.options?.loginRequired==='1'&&accountSession()){
    setTimeout(()=>uni.reLaunch({url:'/pages/index/index'}),0);
  }
  // #endif
}
watch(session,(next,previous)=>{if(next&&!previous)returnAfterRequiredLogin();});
function retryLocalMerge(){
  const original=accountSession();
  if(!original?.mergedIdentities?.length||busy.value)return;
  busy.value=true;
  try{
    saveAccount({...original});
    refreshSession();
    const stillPending=!!session.value?.mergedIdentities?.length;
    message.value=stillPending?'本机资料仍未全部归并；原资料已保留，请确认设备有足够空间后重试':'本机旧账号资料已安全归并到当前账号';
  }catch(error){
    message.value=error instanceof Error?error.message:'本机资料归并未完成；原资料已保留，请稍后重试';
  }finally{busy.value=false;}
}
async function refreshLibraryArchives(){
  const original=accountSession();
  if(!original){libraryArchives.value=[];libraryArchivesLoading.value=false;libraryArchivesError.value='';return;}
  libraryArchives.value=[];
  libraryArchivesLoading.value=true;libraryArchivesError.value='';
  try{
    const result=await accountRequest<{archives:LibraryMergeArchive[]}>('library.merge-archives.list');
    if(!sameSession(original))return;
    if(!result.ok){libraryArchivesError.value=result.errMsg||'归档状态暂时无法读取';return;}
    const data=result.data;
    if(!data||!Array.isArray(data.archives)){libraryArchivesError.value='归档状态暂时无法读取';return;}
    libraryArchives.value=data.archives;
  }catch(error){if(sameSession(original))libraryArchivesError.value=error instanceof Error?error.message:'归档状态暂时无法读取';}
  finally{if(sameSession(original))libraryArchivesLoading.value=false;}
}
let capabilitiesGeneration=0;
async function refreshAuthCapabilities(){
  const generation=++capabilitiesGeneration;
  // #ifdef MP-WEIXIN
  const enabled=await miniProgramPhoneBindingEnabled();
  if(generation===capabilitiesGeneration)phoneBindingEnabled.value=enabled;
  return;
  // #endif
  // #ifndef MP-WEIXIN
  const result=await accountRequest<{phoneBindingEnabled:boolean}>('auth.capabilities');
  if(generation===capabilitiesGeneration)phoneBindingEnabled.value=result.ok&&result.data?.phoneBindingEnabled===true;
  // #endif
}
const unsubscribeAccount=onAccountChange(()=>{refreshSession();void refreshLibraryArchives();recoveryCode.value='';password.value='';newPassword.value='';code.value='';});
onShow(()=>{refreshSession();returnAfterRequiredLogin();void refreshAuthCapabilities();void refreshLibraryArchives();});
onUnload(()=>{capabilitiesGeneration++;unsubscribeAccount();stopQr();});
const qrImage=ref(''),qrStarting=ref(false),qrScanMode=ref<'wechat-mini-program'|'manual'>('manual');let qrChallenge:DeviceChallenge|null=null,qrTimer:ReturnType<typeof setTimeout>|undefined,qrGeneration=0;
function stopQr(clearMessage=true){qrGeneration++;if(qrTimer)clearTimeout(qrTimer);qrTimer=undefined;const prior=qrChallenge;qrChallenge=null;qrImage.value='';qrScanMode.value='manual';if(prior&&clearMessage)message.value='已取消扫码登录';if(prior)void cancelDeviceLogin(prior);}
async function startQr(){if(qrStarting.value)return;stopQr();const generation=qrGeneration;qrStarting.value=true;try{
 const value=await beginDeviceLogin(isDesktop()?'徒步地球桌面端':'徒步地球网页版');if(generation!==qrGeneration||accountSession()){void cancelDeviceLogin(value.challenge);return;}qrChallenge=value.challenge;qrImage.value=value.image;qrScanMode.value=value.scanMode;message.value=value.scanMode==='wechat-mini-program'?'请用微信扫一扫并在小程序内确认登录':'请在小程序内手动扫描并确认登录';
 let qrPollFailures=0;
 const poll=async()=>{if(generation!==qrGeneration||!qrChallenge)return;try{
 if(Date.now()>=value.challenge.expiresAt)throw new Error('二维码已过期，请刷新');
 const done=await claimDeviceLogin(value.challenge,()=>generation===qrGeneration);if(generation!==qrGeneration)return;
 if(done){qrChallenge=null;qrImage.value='';refreshSession();message.value=session.value?.mergedIdentities?.length?'微信扫码登录成功；部分本机旧资料仍在安全合并，应用会保留提示并重试':'微信扫码登录成功';return;}
 qrPollFailures=0;
 qrTimer=setTimeout(poll,2500);
 }catch(error){if(generation!==qrGeneration)return;if(error instanceof QrLoginError&&['NETWORK_OFFLINE','REQUEST_FAILED'].includes(error.code||'')&&Date.now()<value.challenge.expiresAt){qrPollFailures=Math.min(qrPollFailures+1,4);message.value='网络暂不可用，正在自动重试扫码状态…';qrTimer=setTimeout(poll,Math.min(10000,2500*2**(qrPollFailures-1)));return;}message.value=error instanceof Error?error.message:'扫码登录失败';stopQr(false);}};qrTimer=setTimeout(poll,2500);
 }catch(error){message.value=error instanceof Error?error.message:'生成失败';}finally{qrStarting.value=false;}}
onHide(()=>stopQr(false));

function sameSession(expected:AccountSession|null){const current=accountSession();return current?.openid===expected?.openid&&current?.token===expected?.token;}
async function loginWithWeChat(){
  if(busy.value)return;
  const original=accountSession();if(original){session.value=original;message.value='当前已有账号登录，请先退出后再切换微信身份';return;}
  busy.value=true;message.value='';
  try{
    const result=await exchangeMiniProgramWeChat();
    if(!sameSession(original))return;
    saveAccount(result);refreshSession();password.value='';code.value='';message.value=session.value?.mergedIdentities?.length?'云端账号已登录；本机旧账号资料已保留，正在等待本机存储可安全合并后重试':'微信账号已登录，可在网页和桌面扫码使用';
  }catch(error){if(sameSession(original))message.value=error instanceof Error?error.message:'微信登录未完成';}
  finally{busy.value=false;}
}
async function loginWithPhone(event:any){
  if(session.value||busy.value)return;
  const phoneCode=String(event?.detail?.code||'');
  if(!phoneCode){message.value='你未授权手机号；账号没有变化';return;}
  const original=accountSession();
  busy.value=true;message.value='';
  try{
    const result=await exchangeMiniProgramWeChat(phoneCode,(migrated)=>{if(sameSession(original))message.value=`正在安全归并账号资料，已处理 ${migrated} 条；请保持页面打开，中断后重新授权可继续`;});
    if(!sameSession(original))return;
    const hasPendingLocalMerge=!!result.mergedIdentities?.length;
    saveAccount(result);refreshSession();password.value='';code.value='';message.value=hasPendingLocalMerge?'云端账号已统一；本机旧账号资料已保留，正在等待本机存储可安全合并后重试':result.phoneMasked?'微信与手机号已关联，已登录统一账号':'微信登录完成';
  }catch(error){if(sameSession(original))message.value=error instanceof Error?error.message:'微信手机号关联登录未完成';}
  finally{busy.value=false;}
}
async function bindPhone(event:any){
  const original=accountSession();
  if(!original||busy.value)return;
  const phoneCode=String(event?.detail?.code||'');
  if(!phoneCode){message.value='你未授权手机号；账号没有变化';return;}
  busy.value=true;message.value='';
  try{
    const linked=await bindMiniProgramPhone(phoneCode,original.token,(migrated)=>{if(sameSession(original))message.value=`正在安全归并账号资料，已处理 ${migrated} 条；请保持页面打开，中断后重新授权可继续`;});
    if(!sameSession(original))return;
    if(linked.session){const hasPendingLocalMerge=!!linked.session.mergedIdentities?.length;saveAccount(linked.session);refreshSession();message.value=hasPendingLocalMerge?'云端资料已关联；本机旧账号资料已保留，正在等待本机存储可安全合并后重试':'已将同一手机号关联的账号资料迁移到统一账号';return;}
    const updated={...original,phoneMasked:linked.phoneMasked};
    saveAccount(updated);session.value=updated;message.value='手机号已与当前微信账号安全关联';
  }catch(error){if(sameSession(original))message.value=error instanceof Error?error.message:'手机号关联未完成';}
  finally{busy.value=false;}
}
async function submit() {
  if (busy.value) return;
  const original=accountSession();
  busy.value = true; message.value = '';
  try {
    const result = await accountRequest<AccountSession & { recoveryCode?: string }>(`auth.${mode.value}`, {
      username: username.value.trim(), nickname: nickname.value, password: password.value, recoveryCode: code.value.trim(),
    });
    if(!sameSession(original))return;
    if (!result.ok || !result.data) { message.value = result.errMsg || '操作未完成'; return; }
    const newRecoveryCode=result.data.recoveryCode || '';
    // Recovery codes are displayed separately, never persisted with the session.
    const { token, expiresAt, openid, nickname: displayName, username: accountName } = result.data;
    saveAccount({ token, expiresAt, openid, nickname: displayName, username: accountName });
    recoveryCode.value=newRecoveryCode;session.value = accountSession(); nickname.value = displayName;
    message.value = session.value?.mergedIdentities?.length?'云端账号已登录；本机旧账号资料尚未完全归并，已保留在原身份分区，可在账号管理中重试':'已登录，可返回使用云端功能';
  } catch { message.value = '本机无法保存登录状态，请检查存储空间后重新登录'; }
  finally { busy.value = false; password.value = ''; code.value = ''; }
}
async function updateNickname() {
  if (!session.value || busy.value) return;
  const original=accountSession();if(!original)return;
  busy.value = true;
  try {
    const result = await accountRequest<AccountProfile>('auth.nickname', { nickname: nickname.value });
    if(!sameSession(original))return;
    if (result.ok && result.data) { if(result.data.openid!==original.openid)throw new Error('账号响应不一致');saveAccount({ ...original, ...result.data }); session.value = accountSession(); message.value = '昵称已更新'; }
    else message.value = result.errMsg || '更新未完成';
  } catch { if(sameSession(original))message.value = '本机保存失败'; } finally { busy.value = false; }
}
async function updatePassword() {
  if (busy.value) return;
  const original=accountSession();if(!original)return;
  busy.value = true;
  try {
    const result = await accountRequest<AccountSession>('auth.password', { password: password.value, newPassword: newPassword.value });
    if(!sameSession(original))return;
    if (result.ok && result.data) { if(result.data.openid!==original.openid)throw new Error('账号响应不一致');saveAccount(result.data); session.value = accountSession(); message.value = '密码已更新，其他设备需重新登录'; }
    else message.value = result.errMsg || '更新未完成';
  } catch { if(sameSession(original))message.value = '本机保存失败，请用新密码重新登录'; }
  finally { busy.value = false; password.value = ''; newPassword.value = ''; }
}
function logout(all: boolean) {
  const original=accountSession();if(!original)return;
  uni.showModal({ title: all ? '退出所有设备' : '退出账号', content: '保留本机轨迹，停止位置共享。', success: async choice => {
    if (!choice.confirm || busy.value || !sameSession(original)) return;
    busy.value = true;
    try {
      const result = await accountRequest(all?'auth.sign-out-all':'auth.sign-out');
      if(!sameSession(original))return;
      if (result.ok) { const cleared=clearAccount(); session.value = null; message.value = cleared?'已退出':'云端已退出，但本机登录状态或定位清理未完全确认；请重试清理并暂勿共用此设备'; }
      else message.value = result.errMsg || '退出未完成，请联网重试';
    } finally { busy.value = false; }
  } });
}
function deleteAccount() {
  const original=accountSession();if(!original)return;
  if (!wechatAccount.value && !password.value) { message.value = '请先填写当前密码'; return; }
  uni.showModal({ title: '永久注销账号', content: '将删除当前账号及已合并历史身份名下的云端个人资料，并解散你创建的队伍；云端删除后无法恢复。清理期间账号不能使用业务功能。本机收藏与行程转入待确认备份，轨迹仍留在原身份分区。确认开始注销？', success: async choice => {
    if (!choice.confirm || busy.value || !sameSession(original)) return;
    busy.value = true;
    try {
      let wechatTicket = '';
      if (wechatAccount.value) {
        // #ifdef MP-WEIXIN
        const reauth = await wx.cloud.callFunction({ name: 'login', data: { action: 'reauth' } });
        if (!reauth.result?.ticket) throw new Error(reauth.result?.errMsg || '微信身份确认失败');
        wechatTicket = reauth.result.ticket;
        // #endif
        // #ifndef MP-WEIXIN
        message.value = '请在微信小程序的账号管理中确认注销'; return;
        // #endif
      }
      if (!sameSession(original)) return;
      const result = await accountRequest<{ complete: boolean }>('auth.delete', { password: password.value, wechatTicket });
      if(!sameSession(original))return;
      if (!result.ok) { message.value = result.errMsg || '注销未完成，请保留登录状态重试'; return; }
      if (result.data?.complete===true) {
        const archived=archiveDeletedAccountLibrary(original.openid);
        const cleaned=clearDeletedAccountRequests(original.openid);const localCleared=clearAccount(); session.value = null; password.value = '';
        message.value=!localCleared
          ?'云端账号已注销，但本机登录状态或定位清理未完全确认；请重试清理并暂勿共用此设备'
          :archived.status==='failed'
          ?'云端账号已注销；本机收藏与行程仍保留在旧分区，待确认备份状态未完全确认（可能已有副本），请勿清理应用数据'
          :!cleaned?'账号和云数据已注销，本机待创建请求清理失败'
          :!archived.metadataCleaned?`本机收藏与行程已移入待确认备份，但旧同步元数据未能完整清理`
          :archived.status==='archived'?`账号和云数据已注销；${archived.favorites}条收藏、${archived.plans}个行程已移入待确认备份`:'账号和云数据已注销';
      }
      else if(result.data?.complete===false) message.value = '账号已进入注销，部分数据已清理。请再次点击“继续注销”完成剩余清理。';
      else message.value='注销回执格式无效，请保留登录状态重试确认';
    } catch(error) { message.value = error instanceof Error ? error.message : '注销未完成，请重试'; } finally { busy.value = false; }
  } });
}
function openModeration() { uni.navigateTo({ url: '/pages/moderation/moderation' }); }
async function restoreLibraryArchive(archive:LibraryMergeArchive){
  const original=accountSession();if(!original||busy.value)return;
  busy.value=true;message.value='';
  try{
    const result=await accountRequest<{restored:boolean;favorites:number;plans:number}>('library.merge-archives.restore',{archiveId:archive.id});
    if(!sameSession(original))return;
    if(!result.ok||!result.data||result.data.restored!==true){message.value=result.errMsg||'归档仍保留，恢复未完成';return;}
    message.value=`已将 ${result.data.favorites} 条收藏、${result.data.plans} 个行程恢复到当前云端账号`;
    await refreshLibraryArchives();
  }catch(error){if(sameSession(original))message.value=error instanceof Error?error.message:'归档仍保留，恢复未完成';}
  finally{busy.value=false;}
}
function copyRecovery() { uni.setClipboardData({ data: recoveryCode.value }); }
function copyAccountId() {
  const current=accountSession();
  if(!current||current.openid!==session.value?.openid||current.token!==session.value?.token)return;
  uni.setClipboardData({data:current.openid,success:()=>{if(sameSession(current))message.value='账号 ID 已复制；此操作不会授予管理员权限';},fail:()=>{if(sameSession(current))message.value='复制未完成，可长按上方账号 ID 手动复制';}});
}
</script>

<style scoped>
.page{min-height:100vh;box-sizing:border-box;padding:24px 20px;background:var(--he-color-background);color:var(--he-color-text)}.title{display:block;font-size:24px;font-weight:700}.intro,.hint,.message{display:block;font-size:13px;line-height:1.7;margin:12px 0;color:var(--he-color-muted)}.card{margin:20px 0;padding:20px;background:var(--he-color-panel);border-radius: var(--he-card-radius, 16px);}.tabs{display:flex;gap:8px}.tabs button{flex:1;padding:0;font-size:14px}.tabs .active,.primary{background:var(--he-color-accent);color:var(--he-color-on-accent)}.card input{height:44px;margin:14px 0;padding:0 12px;background:var(--he-color-surface);border-radius: var(--he-input-radius, 13px);color:var(--he-color-text)}.card button{margin-top:12px;font-size:14px}.subtitle{display:block;font-size:16px;margin-top:12px}.code{display:block;word-break:break-all;font-family:monospace;margin:16px 0;color:var(--he-color-accent)}
.message{color:var(--he-color-muted)}
.account-id{display:block;word-break:break-all;font-family:monospace;font-size:13px;line-height:1.7;color:var(--he-color-muted)}
.merge-archives,.merge-pending{margin:18px 0;padding:14px;background:var(--he-color-surface);border:1px solid var(--he-color-border);border-radius:12px}.merge-pending{border-color:rgba(var(--he-color-warning-rgb),.42)}.archive-row{padding-top:8px;border-top:1px solid var(--he-color-border)}
</style>
