<template>
 <view class="page"><text class="title">确认设备登录</text>
 <text class="hint">{{ message }}</text>
 <view v-if="device"><text>设备：{{ device }}</text><text class="hint">确认后，此设备将使用你的账号访问云端资料。只确认你本人刚生成的二维码。</text>
 <button :disabled="busy || completed" @click="confirm">确认登录此设备</button></view>
 <button :disabled="busy" @click="scan">扫描登录二维码</button>
 <button v-if="!signedIn" @click="login">先登录微信账号</button>
 </view>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { accountRequest, accountSession, saveAccount, onAccountChange } from '@/services/account';
import { exchangeMiniProgramWeChat } from '@/services/wechat-login';
const challenge=ref(''),device=ref(''),message=ref('打开网页或桌面的登录二维码，然后在这里扫描。'),busy=ref(false),completed=ref(false);
const signedIn=ref(!!accountSession());
let generation=0,disposed=false;
function resetIdentity(){generation++;signedIn.value=!!accountSession();challenge.value='';device.value='';completed.value=false;message.value='账号已改变，请重新扫描';}
const stopAccount=onAccountChange(resetIdentity);
onShow(()=>{signedIn.value=!!accountSession();});
onUnload(()=>{disposed=true;generation++;stopAccount();});
onLoad(options=>{const scanned=typeof options?.scene==='string'?options.scene:typeof options?.challenge==='string'?options.challenge:'';if(/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(scanned)){challenge.value=scanned;void inspect();}});
async function inspect(){const session=accountSession(),expected=challenge.value,epoch=++generation;device.value='';completed.value=false;if(!session){message.value='请先登录微信账号，再扫描或确认。';return;}
 try{const result=await accountRequest<{deviceLabel:string;status:string}>('auth.qr.inspect',{challenge:expected});
  if(disposed||generation!==epoch||challenge.value!==expected||accountSession()?.token!==session.token)return;
  if(result.ok&&result.data?.status==='pending'){device.value=result.data.deviceLabel;message.value='请核对发起设备。';}else message.value=result.errMsg||'二维码已处理，请重新生成。';
 }catch(error){if(!disposed&&generation===epoch&&challenge.value===expected&&accountSession()?.token===session.token)message.value=error instanceof Error?error.message:'无法核对登录二维码，请检查网络后重试。';}}
function scan(){
 if(busy.value||disposed)return;generation++;challenge.value='';device.value='';completed.value=false;
 const epoch=generation;
 // #ifdef MP-WEIXIN
  uni.scanCode({onlyFromCamera:true,success:r=>{if(disposed||epoch!==generation)return;const match=/^hiking-earth-login:([a-f0-9]{32}|[a-f0-9]{64})$/.exec(r.result||'');if(!match){message.value='这不是徒步地球登录二维码';return;}challenge.value=match[1];void inspect();},fail:()=>{if(disposed||epoch!==generation)return;message.value='扫描取消或失败，可重试';}});
 // #endif
 // #ifndef MP-WEIXIN
 message.value='请在微信小程序内扫描设备登录二维码';
 // #endif
}
async function login(){if(busy.value||disposed)return;const epoch=generation,token=accountSession()?.token;busy.value=true;try{
 // #ifdef MP-WEIXIN
 const result=await exchangeMiniProgramWeChat();
 if(disposed||generation!==epoch||accountSession()?.token!==token)return;
 const scanned=challenge.value,localReady=saveAccount(result);signedIn.value=!!accountSession();challenge.value=scanned;if(challenge.value)await inspect();else message.value=localReady?'已登录，请扫描二维码':'已登录；部分本机旧资料仍在安全合并，应用会保留提示并重试';
 // #endif
 // #ifndef MP-WEIXIN
 message.value='请在微信小程序内登录';
 // #endif
 }catch(error){if(!disposed&&generation===epoch)message.value=error instanceof Error?error.message:'登录失败';}finally{busy.value=false;}}
async function confirm(){if(busy.value||completed.value||disposed||!device.value||!challenge.value)return;const session=accountSession();if(!session){message.value='请先登录';return;}const epoch=generation,expected=challenge.value;busy.value=true;try{
 const result=await accountRequest('auth.qr.confirm',{challenge:expected,confirmed:true});
 if(disposed||generation!==epoch||challenge.value!==expected)return;
 if(accountSession()?.token!==session.token){message.value='账号已改变，请重新扫描';return;}
 if(result.ok){completed.value=true;message.value='已确认，请返回网页或桌面。';}else message.value=result.errMsg||'确认未完成';
 }catch(error){if(!disposed&&generation===epoch&&challenge.value===expected&&accountSession()?.token===session.token)message.value=error instanceof Error?error.message:'确认未完成，请检查网络后重试。';}finally{busy.value=false;}}
</script>
<style scoped>.page{padding:24px;background:var(--he-color-background);color:var(--he-color-text);min-height:100vh}.title,.hint{display:block;margin:16px 0}.title{font-size:24px}.hint{line-height:1.7;color:var(--he-color-muted)}button{margin-top:16px}</style>
