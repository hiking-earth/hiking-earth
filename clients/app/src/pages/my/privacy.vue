<template>
  <scroll-view scroll-y class="page">
    <view class="intro">
      <text class="title">隐私设置</text>
      <text class="desc">按需开启功能授权。不同账号的授权分开保存，旧版本设备通用设置不会自动授予当前账号。关闭后，应用不会通过对应功能收集或上传数据；iPhone 系统权限仍可在“设置 → 徒步地球”管理。</text>
      <text class="terms-link" @click="openTerms">查看使用规则与户外安全声明 ›</text>
    </view>

    <view class="group">
      <view v-for="item in options" :key="item.key" class="item">
        <view class="copy">
          <text class="name">{{ item.title }}</text>
          <text class="detail">{{ item.description }}</text>
        </view>
        <switch :checked="consents[item.key]" :disabled="consentBusy" :color="HE_PALETTE.accent" @change="toggle(item.key, $event)" />
      </view>
    </view>
    <text v-if="consentMessage" class="consent-message">{{ consentMessage }}</text>

    <view class="footnote">
      <text class="foot-title">自选离线地图申请</text>
      <text>你手动提交地点名称、中心坐标和半径后，CloudBase 会保存账号申请状态，坐标会由 GitHub Actions worker 用于构建；不会读取实时位置。申请记录设有90天到期时间，由队列worker运行时清理；worker未部署、停运或清理失败时，实际删除可能延迟。生成的地图包会发布到公开GitHub Release，其他人可能从包内地图推断覆盖区域；每周清理工作流计划在90天后删除地图包，但遇到工作流失败或Release不可变时可能需要所有者处理。删除账号内的申请记录不会立即撤回已发布的公开地图包。</text>
    </view>

    <view class="footnote">
      <text class="foot-title">地区实景图片</text>
      <text>路线详情中的地区照片默认不加载。你主动点击“查看地区实景”后，应用才会从 Wikimedia Commons 请求照片；该图片服务会收到必要的网络请求信息。照片仅作为拍摄地区参考，不代表路线实况或当前开放状态。图片作者、原始页面和许可会在照片旁提供。</text>
    </view>

    <view class="footnote">
      <text class="foot-title">系统权限说明</text>
      <text>定位只会在你启动导航、轨迹记录或主动开启组队共享时申请。iOS 的定位和相机权限可随时在系统设置中撤回。</text>
      <text>网页、桌面和手机原生端默认在本机识别，照片不上传。你也可以主动切换到云端模式；只有登录账号、开启“装备照片云端分析”并点击开始后，所选照片（最多4 MB）及可选路线名称才会发送至徒步地球云端识别服务。微信小程序当前使用云端模式，也受同一授权控制。服务端优先使用已配置的千问北京地域免费额度；未启用外部模型时使用徒步地球自托管 CPU 候选模型。只有服务端所有者单独启用付费 DeepSeek 后，千问失败时才会转交；否则会停止本次识别。请在授权前知悉外部服务可能收费，外部模型对照片的处理和留存还受供应商条款约束。结果会标明识别来源；照片不写入徒步地球业务数据库。关闭授权会阻止后续新上传；已经发出的请求可能已到达云端，撤回不能召回该请求。轨迹仅在你启用“云端轨迹备份”并手动同步，或另外开启当前账号自动同步后上传。</text>
      <text>关闭“云端轨迹备份”只会停止后续上传，不会删除已备份的云端轨迹。要查看或删除云端副本，请前往“我的 → 恢复与管理云端轨迹”。</text>
      <text>你主动发出 SOS 时，当前坐标、导航说明和账号身份会保存到云端；有队伍时，当前有效队友打开组队页面可查看最近1小时的求助信号。正常情况下，记录在24–30小时内由每六小时运行的清理任务删除；任务异常时可能延迟。不会发送短信、系统推送或联系救援机构；紧急情况请直接联系当地救援服务。</text>
      <text>具备已验证微信身份时，你主动提交的公开日记、路线留言及队聊消息会发送至微信文本安全接口检查；通过后公开日记和留言仍需管理员审核，队聊消息才会对队友可见。没有已验证微信身份的公开内容进入管理员待审；检查拒绝或服务失败时不会提交。管理员可查看待审内容；拒绝的内容仅本人和管理员可见。</text>
      <text>不启用这些选项时，路线浏览和本地轨迹查看仍可使用。</text>
      <text>注销会删除当前账号及已合并历史身份名下的云端个人资料和身份链接，并解散你创建的队伍；注销完成后，为防止同一账号名重新注册，服务器仅保留一个由账号名哈希定位的停用记录，不保留账号名原文或微信身份标识。本机轨迹仍在原身份分区，收藏和行程会转入待确认备份。</text>
      <text>本服务由项目所有者个人运营。隐私咨询、数据删除请求与举报请联系 </text><text selectable>2308582955@qq.com</text><text>；请勿发送密码或验证码。</text>
    </view>

    <view class="footnote">
      <text class="foot-title">路线天气</text>
      <text>打开路线详情，或在装备规划中为今天选择路线时，应用可能请求该路线资料中心点的近期天气；不读取实时定位。手机端先将路线中心坐标保留两位小数，再发送至 CloudBase；CloudBase 使用两位小数坐标查询 MET Norway。天气供应商不会收到徒步地球账号或完整轨迹。预报在设备最多缓存10分钟，服务端缓存仅保存在临时内存并设置有效期。页面按 CC BY 4.0 标注来源。天气不能代替属地预警或现场判断。</text>
    </view>

    <view class="footnote">
      <text class="foot-title">微信手机号关联</text>
      <text>手机号关联的可用状态以账号页向服务端查询的能力为准；只有微信平台资格、服务端开关与安全配置均核实后，才可在你主动点击授权时使用微信一次性凭证核验手机号。完整号码只在服务器内存中短暂处理，持久保存带密钥的映射摘要、掩码号码和验证时间；本项目不发送短信验证码。若启用后核验确认同一手机号或微信身份分别关联了不同账号，系统会启动可续接的云端资料归并：相关账号在迁移期间暂不可用，已处理记录归入统一账号；中断后可再次授权继续。归并不会恢复已撤回的定位共享授权。</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
import { ref } from "vue";
import { onShow,onUnload } from "@dcloudio/uni-app";
import { forcePrivacyConsentOff, getPrivacyConsents, setPrivacyConsent, type PrivacyConsentKey, type PrivacyConsents } from "@/services/privacy";
import { accountRequest, accountSession, onAccountChange } from '@/services/account';

const consents = ref<PrivacyConsents>(getPrivacyConsents());
const consentBusy = ref(false);
const consentMessage = ref('');
const ACCOUNT_CLOUD_CONSENTS = {
  gearImageUpload: 'gear-image-upload-v1',
  trackCloudSync: 'track-cloud-sync-v1',
  teamLocation: 'team-location-v1',
} as const;
type AccountCloudConsentKey = keyof typeof ACCOUNT_CLOUD_CONSENTS;
function pendingRevocationKey(openid: string, key: AccountCloudConsentKey): string {
  return `he_cloud_consent_revoke_pending_v1:${encodeURIComponent(openid)}:${key}`;
}
function hasPendingRevocation(openid: string, key: AccountCloudConsentKey): boolean {
  try {
    const saved = uni.getStorageSync(pendingRevocationKey(openid, key));
    return saved === true || (saved !== false && saved !== '' && saved !== null && saved !== undefined);
  }
  catch { return true; }
}
function setPendingRevocation(openid: string, key: AccountCloudConsentKey, pending: boolean): void {
  const storageKey = pendingRevocationKey(openid, key);
  if (pending) {
    uni.setStorageSync(storageKey, true);
    if (uni.getStorageSync(storageKey) !== true) throw new Error('本机撤回状态未能保存');
  } else {
    uni.removeStorageSync(storageKey);
    const remaining = uni.getStorageSync(storageKey);
    if (remaining !== '' && remaining !== null && remaining !== undefined) throw new Error('本机撤回状态未能清除');
  }
}
const options: { key: PrivacyConsentKey; title: string; description: string }[] = [
  { key: "location", title: "导航与轨迹定位", description: "在使用导航和轨迹记录时读取当前位置；关闭后这些功能不可用。" },
  { key: "backgroundLocation", title: "原生后台轨迹记录", description: "仅手机原生端，开始记录后在锁屏或切换应用时继续读取位置。本地缓存，不自动上传；需要系统后台定位和持续通知权限。" },
  { key: "teamLocation", title: "组队位置共享", description: "仅在队伍中主动开启共享后，向队友发送当前坐标；停止共享或退出队伍后停止发送。" },
  { key: "trackCloudSync", title: "云端轨迹备份", description: "仅控制已完成轨迹的云端备份；收藏和行程由“自动同步”开关单独控制。允许手动备份；同时开启账号自动同步后，可在前台自动备份已完成轨迹。关闭后停止后续轨迹上传，本机轨迹保留；已备份的云端副本需在云端轨迹管理中单独查看或删除。" },
  { key: "gearImageUpload", title: "装备照片云端分析", description: "网页、桌面和手机原生端默认本机识别；云端模式或微信小程序只有在登录、开启此授权并点击开始后，才上传所选照片（最多4 MB）及可选路线名称。未启用外部模型时使用徒步地球自托管 CPU 候选模型；服务端优先使用已配置的千问北京地域免费额度。服务端所有者单独启用付费 DeepSeek 时，千问失败后才会转交；否则停止请求。外部服务可能收费且按供应商条款处理照片。识别来源会显示在结果中；照片不写入徒步地球业务数据库。" },
];
function closeLocalConsent(key: PrivacyConsentKey): void {
  try { consents.value = setPrivacyConsent(key, false); }
  catch {
    forcePrivacyConsentOff(key);
    consents.value = { ...consents.value, [key]: false };
  }
}

function openTerms() { uni.navigateTo({ url: '/pages/my/terms' }); }
async function refreshAccountConsent() {
  consents.value = getPrivacyConsents();
  const session = accountSession();
  if (!session) {
    for (const key of Object.keys(ACCOUNT_CLOUD_CONSENTS) as AccountCloudConsentKey[]) {
      closeLocalConsent(key);
    }
    return;
  }
  const results = await Promise.all((Object.keys(ACCOUNT_CLOUD_CONSENTS) as AccountCloudConsentKey[]).map(async key => {
    const pendingRevocation = hasPendingRevocation(session.openid, key);
    const result = pendingRevocation
      ? await accountRequest<{ enabled: boolean; policyVersion: string | null }>('privacy.consent', {
        key, enabled: false, policyVersion: ACCOUNT_CLOUD_CONSENTS[key],
      })
      : await accountRequest<{ enabled: boolean; policyVersion: string | null }>('privacy.consent', { key });
    return { key, result, pendingRevocation };
  }));
  if (accountSession()?.token !== session.token) return;
  const failed: AccountCloudConsentKey[] = [];
  for (const { key, result, pendingRevocation } of results) {
    if (!result.ok || !result.data) {
      closeLocalConsent(key);
      failed.push(key);
      continue;
    }
    if (pendingRevocation) {
      if (result.data.enabled !== false) {
        closeLocalConsent(key);
        failed.push(key);
        continue;
      }
      try { setPendingRevocation(session.openid, key, false); }
      catch {
        closeLocalConsent(key);
        failed.push(key);
        continue;
      }
    }
    const enabled = result.data.enabled === true && result.data.policyVersion === ACCOUNT_CLOUD_CONSENTS[key];
    try { consents.value = setPrivacyConsent(key, enabled); }
    catch {
      forcePrivacyConsentOff(key);
      consents.value = { ...consents.value, [key]: false };
      failed.push(key);
    }
  }
  consentMessage.value = failed.length
    ? '无法确认部分账号级云端授权状态；相关本机上传与共享已关闭。联网后请重新打开隐私设置同步授权。'
    : '';
}
onShow(() => { void refreshAccountConsent(); });
const unsubscribeAccount=onAccountChange(()=>{void refreshAccountConsent();});
onUnload(unsubscribeAccount);

async function toggle(key: PrivacyConsentKey, event: Event | { detail: { value: boolean } }) {
  const detail = (event as { detail?: { value?: boolean } }).detail;
  if (typeof detail?.value !== "boolean") return;
  if (Object.prototype.hasOwnProperty.call(ACCOUNT_CLOUD_CONSENTS, key)) {
    const cloudKey = key as AccountCloudConsentKey;
    const enabled = detail.value;
    const session = accountSession();
    if (!session) {
      closeLocalConsent(key);
      consentMessage.value = enabled
        ? '请先登录徒步地球账号，才能保存并同步云端授权。'
        : '本机对应的上传或共享入口已关闭；请登录原账号并再次关闭，才能撤回并同步账号级授权。';
      return;
    }
    consentBusy.value = true;
    consentMessage.value = '';
    if (!enabled) {
      try { setPendingRevocation(session.openid, cloudKey, true); }
      catch {
        closeLocalConsent(key);
        let revoked = false;
        try {
          const result = await accountRequest<{ enabled: boolean }>('privacy.consent', {
            key: cloudKey, enabled: false, policyVersion: ACCOUNT_CLOUD_CONSENTS[cloudKey],
          });
          revoked = result.ok && result.data?.enabled === false;
        } catch { /* The local process remains fail-closed. */ }
        if (accountSession()?.token !== session.token) {
          consentBusy.value = false;
          return;
        }
        consentMessage.value = revoked
          ? '服务端已确认撤回，但本机无法保存重试标记；本机功能保持关闭，请重新打开隐私设置核对状态。'
          : '本机上传或共享已关闭，但本机无法保存撤回重试标记，服务端撤回也未确认。请保持当前账号登录，存储恢复后再次关闭此授权。';
        consentBusy.value = false;
        return;
      }
      try { consents.value = setPrivacyConsent(key, false); }
      catch {
        forcePrivacyConsentOff(key);
        consents.value = { ...consents.value, [key]: false };
        consentMessage.value = '本机授权状态未能保存；服务端撤回尚未执行。请保留应用数据，重新打开隐私设置后重试。';
        consentBusy.value = false;
        return;
      }
    }
    try {
      const result = await accountRequest<{ enabled: boolean }>('privacy.consent', {
        key: cloudKey, enabled, policyVersion: ACCOUNT_CLOUD_CONSENTS[cloudKey],
      });
      if (accountSession()?.token !== session.token) return;
      if (!result.ok || result.data?.enabled !== enabled) {
        if (enabled) {
          closeLocalConsent(key);
        }
        consentMessage.value = enabled
          ? '账号授权未能保存，本机相关上传或共享保持关闭。请联网后重试。'
          : '本机相关上传或共享已关闭，但服务端撤回尚未确认；联网并登录同一账号后请再次关闭此授权。';
        return;
      }
      try { setPendingRevocation(session.openid, cloudKey, false); }
      catch {
        closeLocalConsent(key);
        consentMessage.value = enabled
          ? '服务端已保存授权，但本机撤回记录未能清除；本机功能保持关闭。请重新打开隐私设置核对状态。'
          : '服务端已确认撤回，但本机重试标记未能清除；相关本机功能保持关闭。请重新打开隐私设置核对状态。';
        return;
      }
      try { consents.value = setPrivacyConsent(key, enabled); }
      catch {
        forcePrivacyConsentOff(key);
        consents.value = { ...consents.value, [key]: false };
        consentMessage.value = '账号授权已更新，但本机设置无法保存；本机相关功能保持关闭，请重新打开隐私设置核对。';
      }
    } finally {
      consentBusy.value = false;
    }
    return;
  }
  consents.value = setPrivacyConsent(key, detail.value);
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--he-color-background); padding: 18px 14px 28px; box-sizing: border-box; }
.intro { display: flex; flex-direction: column; gap: 7px; padding: 4px 2px 14px; }
.title { color: var(--he-color-text); font-size: 21px; font-weight: 700; }
.desc { color: var(--he-color-muted); font-size: 12px; line-height: 1.7; }
.terms-link { align-self: flex-start; margin-top: 2px; color: var(--he-color-accent); font-size: 12px; }
.group { overflow: hidden; border-radius: 10px; background: var(--he-color-panel); }
.item { display: flex; align-items: center; gap: 10px; padding: 14px 12px; border-bottom: 0.5px solid var(--he-color-surface); }
.item:last-child { border-bottom: 0; }
.copy { display: flex; flex: 1; flex-direction: column; gap: 4px; }
.name { color: var(--he-color-text); font-size: 14px; font-weight: 600; }
.detail { color: var(--he-color-muted); font-size: 11px; line-height: 1.6; }
.consent-message { display: block; margin-top: 8px; color: var(--he-color-warning); font-size: 11px; line-height: 1.6; }
.footnote { display: flex; flex-direction: column; gap: 7px; margin-top: 14px; padding: 13px 12px; border-radius: 10px; background: var(--he-color-panel); color: var(--he-color-muted); font-size: 11px; line-height: 1.7; }
.foot-title { color: var(--he-color-accent); font-size: 12.5px; font-weight: 600; }
</style>
