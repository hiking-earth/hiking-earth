import { reactive } from 'vue';
import {publicSnapshot} from './public-data';
import { isDesktop, checkDesktopUpdate, installDesktopUpdate, restartDesktop } from './desktop';
import { hasRecordingDraft } from './tracks';
import { APP_VERSION, APP_VERSION_CODE } from './version';
export { APP_VERSION };
export const updateState=reactive({checking:false,installing:false,available:false,version:'',notes:'',message:'',progress:0});
const MANIFEST=import.meta.env.VITE_RELEASE_MANIFEST_URL;
type Artifact={url:string;sha256:string;size:number};
type Release={schemaVersion:1;ready:boolean;version:string;versionCode:number;notes:string;android:Artifact|null;ios:{url:string}|null};
let release:Release|null=null;let nextCheckAt=0;let failures=0;let miniManagerBound=false;
function checkedSuccessfully(){failures=0;nextCheckAt=Date.now()+6*60*60*1000;}
function checkFailed(){release=null;updateState.available=false;updateState.version='';updateState.notes='';failures++;nextCheckAt=Date.now()+Math.min(6*60*60*1000,15*60*1000*2**Math.min(failures-1,5));}
function versionParts(value:unknown):[number,number,number]|null{
  if(typeof value!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))return null;
  const parts=value.split('.').map(Number);
  return parts.length===3&&parts.every(Number.isSafeInteger)?parts as [number,number,number]:null;
}
function newer(version:string,current:string):boolean {const a=versionParts(version),b=versionParts(current);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
function artifactUrl(url:string):boolean {return /^https:\/\/github\.com\/hiking-earth\/clients\/releases\/download\/[^/]+\/[^?#]+$/.test(url);}
function platformArtifactAvailable(candidate:Release):boolean {
  // #ifdef APP-PLUS
  return plus.os.name==='iOS'?!!candidate.ios:!!candidate.android;
  // #endif
  // #ifdef H5
  // The page refresh is separate from an installable native release.
  return false;
  // #endif
  return false;
}
function nativeVersion():string {
  // #ifdef APP-PLUS
  const runtimeVersion=plus.runtime.version;
  return typeof runtimeVersion==='string'&&versionParts(runtimeVersion)?runtimeVersion:APP_VERSION;
  // #endif
  return APP_VERSION;
}
function nativeVersionCode():number {
  // #ifdef APP-PLUS
  const runtimeCode=Number(plus.runtime.versionCode);
  return Number.isSafeInteger(runtimeCode)&&runtimeCode>0?runtimeCode:APP_VERSION_CODE;
  // #endif
  return APP_VERSION_CODE;
}
export async function checkForUpdate(force=false):Promise<void> {
  if(updateState.checking || updateState.installing || (!force && Date.now()<nextCheckAt))return;
  updateState.checking=true;updateState.message='';
  try {
    if(isDesktop()) {const info=await checkDesktopUpdate();updateState.available=!!info;updateState.version=info?.version||'';updateState.notes=info?.notes||'';updateState.message=info?'新版本已准备好，请保存当前工作后更新':'当前为最新已发布版本';checkedSuccessfully();return;}
    // #ifdef MP-WEIXIN
    if(miniManagerBound){updateState.message=updateState.available?'微信已下载更新，保存当前工作后可重启':'微信在下次小程序启动时继续检查更新';return;}
    const manager=uni.getUpdateManager();
    manager.onCheckForUpdate(result=>{checkedSuccessfully();updateState.message=result.hasUpdate?'微信正在准备更新':'当前小程序为最新版本';});
    manager.onUpdateReady(()=>{updateState.available=true;updateState.notes='微信已下载新版本，完成当前操作后可重启更新';});
    manager.onUpdateFailed(()=>{checkFailed();updateState.available=false;updateState.message='微信更新下载失败，请稍后重新打开';});
    miniManagerBound=true;
    return;
    // #endif
    // #ifdef H5
    // Web releases are installed by the site Service Worker, not the native
    // Android/iOS artifact manifest. Avoid reporting a false failure when that
    // native-only manifest is unavailable or still marked not ready.
    updateState.available=false;updateState.version='';updateState.notes='';
    updateState.message='网页会自动获取新版；新版准备好后会提示刷新，请先保存当前操作';
    checkedSuccessfully();
    return;
    // #endif
    const data=MANIFEST?await new Promise<unknown>((resolve,reject)=>uni.request({url:MANIFEST,timeout:15000,success:r=>r.statusCode===200?resolve(r.data):reject(new Error('发布清单暂不可用')),fail:()=>reject(new Error('无法连接更新服务'))})):await publicSnapshot('release');
    const r=data as Release;
    if(r?.schemaVersion!==1 || typeof r.ready!=='boolean' || !versionParts(r.version) || !Number.isSafeInteger(r.versionCode) || r.versionCode<=0 || typeof r.notes!=='string' || r.notes.length>12000)throw new Error('发布清单无效');
    const android=r.android;const ios=r.ios;
    if(android && (!artifactUrl(android!.url) || !/^[a-f0-9]{64}$/.test(android!.sha256) || !Number.isSafeInteger(android!.size) || android!.size<=0 || android!.size>200*1024*1024))throw new Error('安装包信息无效');
    if(ios && !/^https:\/\/(apps\.apple\.com|testflight\.apple\.com)\//.test(ios!.url))throw new Error('iOS更新入口无效');
    const currentVersion=nativeVersion(),currentVersionCode=nativeVersionCode();
    if(r.ready&&newer(r.version,currentVersion)&&r.versionCode<=currentVersionCode)throw new Error('新版本版本号未递增，已停止更新以避免安装失败');
    release=r;const versionCanAdvance=r.version===currentVersion||newer(r.version,currentVersion);const hasNewVersion=r.ready&&versionCanAdvance&&r.versionCode>currentVersionCode;const hasArtifact=platformArtifactAvailable(r);updateState.available=hasNewVersion && hasArtifact;updateState.version=r.version;updateState.notes=r.notes;
    checkedSuccessfully();
    if(!updateState.available)updateState.message=!r.ready?'新版本仍在准备，尚未正式发布':hasNewVersion&&!hasArtifact?'当前平台的新版本安装入口尚未发布':'当前为最新版本';
    // #ifdef H5
    updateState.message='网页功能随服务发布更新，请完成当前操作后重新打开页面';
    // #endif
  } catch(e:any){checkFailed();updateState.message=e.message || '检查更新失败';}finally{updateState.checking=false;}
}
export async function applyUpdate():Promise<void> {
  if(updateState.installing || !updateState.available)return;
  if(hasRecordingDraft()){updateState.message='请先暂停并保存正在记录的轨迹，再更新';return;}
  updateState.installing=true;updateState.message='';updateState.progress=0;
  try {
    if(isDesktop()){await installDesktopUpdate(updateState.version);await restartDesktop();return;}
    // #ifdef MP-WEIXIN
    uni.getUpdateManager().applyUpdate();return;
    // #endif
    // #ifdef APP-PLUS
    const currentRelease=release;const iosArtifact=currentRelease?.ios;const artifact=currentRelease?.android;
    if(plus.os.name==='iOS'){if(!iosArtifact)throw new Error('iOS签名版本尚未发布');plus.runtime.openURL(iosArtifact!.url);return;}
    if(!artifact)throw new Error('Android新版安装包尚未发布');
    const filename=await new Promise<string>((resolve,reject)=>{
      const task=uni.downloadFile({url:artifact!.url,timeout:180000,success:r=>r.statusCode===200?resolve(r.tempFilePath):reject(new Error('安装包下载失败')),fail:()=>reject(new Error('安装包下载中断'))});
      task.onProgressUpdate(p=>{updateState.progress=p.progress;});
    });
    const { verifyDownloadedApk }=await import('./files');
    await verifyDownloadedApk(filename,artifact!.sha256,artifact!.size);
    // Android's installer additionally validates APK signature and upgrade identity.
    await new Promise<void>((resolve,reject)=>plus.runtime.install(filename,{force:false},()=>resolve(),()=>reject(new Error('安装未完成，请检查系统安装授权'))));
    return;
    // #endif
    // #ifdef H5
    updateState.message='网页功能随服务发布更新，请完成当前操作后重新打开页面';
    // #endif
  }catch(e:any){updateState.message=e.message || '更新未完成';}finally{updateState.installing=false;}
}
