import { accountRequest, accountSession, type AccountSession } from './account';
import { callCloud, callMiniProgramLogin } from './cloud';

type WeChatLoginTicket = { openid: string; ticket: string; expiresAt: number };
type MergeStart = { mergeRequired: true; mergeToken: string; expiresAt: number };
type MergeStep = { complete: false; migrated: number } | { complete: true; session: AccountSession };

type MergeProgress = (migrated: number) => void;

async function continueVerifiedMerge(mergeToken: string, onProgress?: MergeProgress): Promise<AccountSession> {
  if (!/^[a-f0-9]{64}$/.test(mergeToken)) throw new Error('账号关联凭据无效，请重新授权');
  for (;;) {
    const step = await accountRequest<MergeStep>('auth.merge.continue', { mergeToken });
    if (!step.ok || !step.data) throw new Error(step.errMsg || '账号资料迁移未完成；请重新进行微信手机号授权以继续');
    if (step.data.complete === true) return step.data.session;
    if (!Number.isSafeInteger(step.data.migrated) || step.data.migrated < 0) throw new Error('账号关联进度回执无效');
    onProgress?.(step.data.migrated);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

/** Exchange trusted Mini Program identity into the shared cross-platform account. */
export async function exchangeMiniProgramWeChat(phoneCode?: string, onMergeProgress?: MergeProgress): Promise<AccountSession> {
  // #ifndef MP-WEIXIN
  throw new Error('请在徒步地球微信小程序中使用微信一键登录');
  // #endif
  // #ifdef MP-WEIXIN
  return exchangeTrustedMiniProgramIdentity(phoneCode, onMergeProgress);
  // #endif
}

/** Bind a phone only after the Mini Program permission button returns a fresh WeChat code. */
export async function bindMiniProgramPhone(phoneCode: string, sessionToken: string, onMergeProgress?: MergeProgress): Promise<{ phoneMasked: string; phoneVerifiedAt: number; session?: AccountSession }> {
  // #ifndef MP-WEIXIN
  throw new Error('请在微信小程序中授权关联手机号');
  // #endif
  // #ifdef MP-WEIXIN
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(phoneCode) || !/^[a-f0-9]{64}$/.test(sessionToken)) {
    throw new Error('手机号授权已失效，请重新点击授权');
  }
  const issued = await callMiniProgramLogin<{ phoneMasked: string; phoneVerifiedAt: number } | MergeStart>({
    action: 'bindPhone', phoneCode, sessionToken,
  });
  if (!issued.ok || issued.data === undefined) {
    throw new Error(issued.errMsg || '手机号关联未完成');
  }
  const data = issued.data as { phoneMasked: string; phoneVerifiedAt: number } | MergeStart;
  if ('mergeRequired' in data) {
    const mergeData=data as MergeStart;
    if (mergeData.mergeRequired !== true || !Number.isFinite(mergeData.expiresAt)
        || mergeData.expiresAt <= Date.now() || mergeData.expiresAt > Date.now() + 8 * 24 * 60 * 60 * 1000) {
      throw new Error('账号关联任务回执无效，请重新授权');
    }
    const session = await continueVerifiedMerge(mergeData.mergeToken, onMergeProgress);
    const phoneMasked=session.phoneMasked;
    if (typeof phoneMasked !== 'string') throw new Error('账号已迁移，但手机号关联回执无效；请重新登录核对');
    if (!/^\+[0-9]{1,3} \*{4}[0-9]{4}$/.test(String(phoneMasked))) throw new Error('账号已迁移，但手机号关联回执无效；请重新登录核对');
    return { phoneMasked:phoneMasked as string, phoneVerifiedAt: Date.now(), session };
  }
  const phoneData=data as { phoneMasked: string; phoneVerifiedAt: number };
  if (typeof phoneData.phoneMasked !== 'string' || !/^\+[0-9]{1,3} \*{4}[0-9]{4}$/.test(phoneData.phoneMasked)
      || !Number.isFinite(phoneData.phoneVerifiedAt)) throw new Error('手机号关联回执无效');
  return phoneData;
  // #endif
}

/** Read the binding switch from the same function that verifies WeChat phone codes. */
export async function miniProgramPhoneBindingEnabled(): Promise<boolean> {
  // #ifndef MP-WEIXIN
  return false;
  // #endif
  // #ifdef MP-WEIXIN
  const result = await callMiniProgramLogin<{ phoneBindingEnabled: boolean }>({ action: 'capabilities' });
  return result.ok && result.data?.phoneBindingEnabled === true;
  // #endif
}

// #ifdef MP-WEIXIN
async function exchangeTrustedMiniProgramIdentity(phoneCode?: string, onMergeProgress?: MergeProgress): Promise<AccountSession> {
  if (accountSession()) throw new Error('当前已有账号登录，请先退出再切换身份');
  if (phoneCode !== undefined && !/^[A-Za-z0-9_-]{8,512}$/.test(phoneCode)) {
    throw new Error('微信手机号授权已失效，请重新点击授权');
  }
  const issued = await callCloud<WeChatLoginTicket | MergeStart>('login', phoneCode ? { action: 'loginWithPhone', phoneCode } : {});
  if (!issued.ok || !issued.data) throw new Error(issued.errMsg || '微信身份确认失败');
  const value = issued.data;
  if ('mergeRequired' in value) {
    if (value.mergeRequired !== true || typeof value.mergeToken !== 'string' || !/^[a-f0-9]{64}$/.test(value.mergeToken)
        || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 8 * 24 * 60 * 60 * 1000) {
      throw new Error('账号关联任务回执无效，请重新进行微信手机号授权');
    }
    return continueVerifiedMerge(value.mergeToken, onMergeProgress);
  }
  const now = Date.now();
  if (typeof value.openid !== 'string' || !value.openid || value.openid.length > 128
      || typeof value.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(value.ticket)
      || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 120_000) {
    throw new Error('微信登录凭据无效或已过期');
  }
  const exchanged = await accountRequest<AccountSession>('auth.wechat.exchange', { ticket: value.ticket });
  if (!exchanged.ok || !exchanged.data) throw new Error(exchanged.errMsg || '微信账号登录未完成');
  if (accountSession()) throw new Error('账号已改变，请确认当前账号后重试');
  const validUsername = typeof exchanged.data.username === 'string'
    && exchanged.data.username.length <= 32
    && (phoneCode ? /^[a-z0-9][a-z0-9_.-]{3,31}$/.test(exchanged.data.username) : exchanged.data.username.startsWith('wx_'));
  if (exchanged.data.openid !== value.openid || !validUsername
      || typeof exchanged.data.nickname !== 'string' || exchanged.data.nickname.length > 24
      || !/^[a-f0-9]{64}$/.test(exchanged.data.token)
      || !Number.isFinite(exchanged.data.expiresAt) || exchanged.data.expiresAt <= Date.now()) {
    throw new Error('微信登录身份映射不一致');
  }
  return exchanged.data;
}
// #endif
