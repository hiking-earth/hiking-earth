import { accountRequest, accountSession, saveAccount, type AccountSession } from './account';
// #ifdef H5
import QRCode from 'qrcode';
// #endif
export type DeviceChallenge = {challenge:string;claimSecret:string;expiresAt:number};
export class QrLoginError extends Error {
 constructor(message:string,readonly code?:string){super(message);this.name='QrLoginError';}
}
export async function beginDeviceLogin(deviceLabel='徒步地球网页端'):Promise<{challenge:DeviceChallenge;image:string;scanMode:'wechat-mini-program'|'manual'}> {
 const result=await accountRequest<DeviceChallenge&{miniProgramCode?:string}>('auth.qr.start',{deviceLabel});
 const value=result.data;
 if(!result.ok||!value||!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(value.challenge)||!/^[a-f0-9]{64}$/.test(value.claimSecret)||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now())throw new Error(result.errMsg||'登录二维码生成失败');
 const challenge:DeviceChallenge={challenge:value.challenge,claimSecret:value.claimSecret,expiresAt:value.expiresAt};
 let image='',scanMode:'wechat-mini-program'|'manual'='manual';
 // #ifdef H5
 if(typeof value.miniProgramCode==='string'&&value.miniProgramCode.length<=1_400_000&&value.miniProgramCode.startsWith('iVBORw0KGgo')&&/^[A-Za-z0-9+/]+={0,2}$/.test(value.miniProgramCode)){
  image=`data:image/png;base64,${value.miniProgramCode}`;scanMode='wechat-mini-program';
 }else image=await QRCode.toDataURL(`hiking-earth-login:${value.challenge}`,{width:280,margin:2,errorCorrectionLevel:'M'});
 // #endif
 return {challenge,image,scanMode};
}
export async function claimDeviceLogin(value:DeviceChallenge,isCurrent:()=>boolean=()=>true):Promise<boolean> {
 if(accountSession())throw new Error('当前已登录，请先退出再扫码切换');
 const result=await accountRequest<{status:string;session?:AccountSession}>('auth.qr.claim',value);
 if(!result.ok||!result.data)throw new QrLoginError(result.errMsg||'登录确认未完成',result.code);
 if(result.data.status==='pending')return false;
 if(result.data.status!=='signed-in'||!result.data.session)throw new Error('登录回执无效');
 // Do not overwrite a session chosen while this request was in flight.
 if(!isCurrent()||accountSession())throw new Error('扫码请求已取消或账号已改变，请重新登录');
 saveAccount(result.data.session);return true;
}
export async function cancelDeviceLogin(value:DeviceChallenge){
 const result=await accountRequest<{cancelled:boolean;sessionRevoked?:boolean}>('auth.qr.cancel',value);
 if(result.ok&&result.data?.cancelled&&result.data.sessionRevoked===false){
  // Session removal can briefly fail after the challenge is already cancelled;
  // its hash remains until the short TTL so this exact cleanup is retryable.
  return accountRequest('auth.qr.cancel',value);
 }
 return result;
}
