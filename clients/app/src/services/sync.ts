import { reactive } from 'vue';
import { accountSession, onAccountChange } from './account';
import { onPrivacyChange, hasPrivacyConsent } from './privacy';
import { callCloud } from './cloud';
import { acquireLibraryCloudLock, currentLibraryStorageValid, readLibrary, writeLibrary, librarySnapshot, libraryVersion, setLibraryVersion, validCloudLibrary, type Library } from './library';
import { acquireTrackCloudLock, listTracks, getTrack, saveTrack, setTrackAutoSyncExcluded, trackAutoSyncExcluded, trackStorageValid, uploadTrackToCloud } from './tracks';
import type { TrackRecord } from '@shared/types/track';
export const syncState=reactive({running:false,lastSuccess:0,error:'',conflict:false,continuing:false});
let active=true;let started=false;let timer:ReturnType<typeof setInterval>|undefined;let lastAttempt=0;let rerunAfterCurrent=false;
const owner=()=>accountSession()?.openid || '';
const key=()=>`he_auto_sync:${owner()}`;
function persistTrackSyncCursor(identity:string,cursor:string):void {
  if(typeof identity!=='string'||!identity||identity.length>128||typeof cursor!=='string'||cursor.length>128)throw new Error('轨迹同步进度无效');
  const cursorKey=`he_auto_sync_cursor:${identity}`;
  uni.setStorageSync(cursorKey,cursor);
  if(uni.getStorageSync(cursorKey)!==cursor)throw new Error('轨迹同步进度保存未确认，将在后续安全重试');
}
export function autoSyncEnabled():boolean {
  const session=accountSession();
  return !!session?.openid&&!session.mergedIdentities?.length&&uni.getStorageSync(key())===true;
}
export function setAutoSync(enabled:boolean):void {
  const session=accountSession();
  if(!session?.openid)throw new Error('请先登录统一账号');
  if(enabled&&session.mergedIdentities?.length)throw new Error('账号资料仍在安全合并，完成后再开启自动同步');
  const storageKey=key();
  uni.setStorageSync(storageKey,enabled);
  if(uni.getStorageSync(storageKey)!==enabled)throw new Error('自动同步设置未能保存确认；当前设置已保留，请重试');
  if(enabled)void syncNow(true);else syncState.continuing=false;
}
function allowed(identity:string):boolean {
  const session=accountSession();
  return active&&session?.openid===identity&&!session.mergedIdentities?.length&&autoSyncEnabled();
}
export async function syncNow(force=false):Promise<void> {
  const identity=owner();if(syncState.running){if(force)rerunAfterCurrent=true;return;}if(!allowed(identity) || (!force && Date.now()-lastAttempt<60000))return;
  lastAttempt=Date.now();syncState.running=true;syncState.error='';syncState.conflict=false;syncState.continuing=false;
  let releaseLibraryCloud: (() => void) | undefined;
  let releaseTrackCloud: (() => void) | undefined;
  try {
    const savedCursor=uni.getStorageSync(`he_auto_sync_cursor:${identity}`);
    syncState.continuing=hasPrivacyConsent('trackCloudSync')&&typeof savedCursor==='string'&&savedCursor.length>0&&savedCursor.length<=128;
    if(!currentLibraryStorageValid())throw new Error('本机收藏或行程资料格式异常，自动同步已停止以免上传不完整资料；请保留应用数据，待统一修复后处理');
    releaseLibraryCloud=await acquireLibraryCloudLock();
    if(!allowed(identity))return;
    if(!currentLibraryStorageValid())throw new Error('本机收藏或行程资料格式异常，自动同步已停止以免上传不完整资料；请保留应用数据，待统一修复后处理');
    const remote=await callCloud<Library & {version:number}>('library-manage',{action:'get'});
    if(!allowed(identity))return;
    if(!remote.ok || !remote.data)throw new Error(remote.errMsg || '读取云资料失败');
    if(!validCloudLibrary(remote.data))throw new Error('云端收藏或行程格式无效，本机资料未覆盖');
    // Storage can change while the cloud read is pending (for example, another
    // page or a platform callback writes the same key). Revalidate before the
    // permissive reader is allowed to produce a sync snapshot.
    if(!currentLibraryStorageValid())throw new Error('本机收藏或行程资料格式异常，自动同步已停止以免上传不完整资料；请保留应用数据，待统一修复后处理');
    const local=readLibrary();const localSnapshot=librarySnapshot(local);const baseline=uni.getStorageSync(`he_library_baseline:${identity}`);
    const localVersion=libraryVersion();
    if(!Number.isSafeInteger(localVersion)||localVersion<0){syncState.conflict=true;throw new Error('本机云资料版本异常，自动同步已停止以避免覆盖；请先核对当前账号的云端资料');}
    let baselineValid=false,baselineSnapshot='';
    if(typeof baseline==='string'&&baseline){try{baselineSnapshot=librarySnapshot(JSON.parse(baseline));baselineValid=true;}catch{}}
    const remoteLibrary={favorites:remote.data.favorites,plans:remote.data.plans};
    const remoteSnapshot=librarySnapshot(remoteLibrary);
    if(remote.data.version<localVersion){syncState.conflict=true;throw new Error('云端资料版本低于本机已确认版本，未覆盖本机资料；请先核对云端资料');}
    let changed:boolean;
    if(localSnapshot===remoteSnapshot&&remote.data.version>=localVersion){
      // A verified account merge can advance the cloud snapshot while the
      // device still has the pre-merge version/baseline. Exact content equality
      // proves there is nothing to overwrite, so safely accept the new version.
      if(!baselineValid||baselineSnapshot!==localSnapshot){
        const baselineKey=`he_library_baseline:${identity}`;
        uni.setStorageSync(baselineKey,localSnapshot);
        if(uni.getStorageSync(baselineKey)!==localSnapshot)throw new Error('同步基线保存回读不一致，本机资料未覆盖');
        baselineValid=true;
      }
      if(remote.data.version!==localVersion){
        const versionKey=`he_library_version:${identity}`;
        uni.setStorageSync(versionKey,remote.data.version);
        if(Number(uni.getStorageSync(versionKey))!==remote.data.version)throw new Error('云端资料版本保存回读不一致，本机资料未覆盖');
      }
      changed=false;
    }else{
      if(baselineValid&&remote.data.version===localVersion&&remoteSnapshot!==baselineSnapshot){syncState.conflict=true;throw new Error('云端资料内容在版本号未变化时发生变化，自动同步已停止以避免覆盖');}
      if(baselineValid){changed=localSnapshot!==baselineSnapshot;}
      else if(local.favorites.length===0&&local.plans.length===0){changed=false;}
      else if(remote.data.version===0&&remote.data.favorites.length===0&&remote.data.plans.length===0){changed=true;}
      else {syncState.conflict=true;throw new Error('本机与云端均有收藏或行程，但缺少可核对的同步基线；为避免覆盖数据，请到收藏与行程页面手动对比后保存或恢复');}
    }
    if(changed && remote.data.version!==localVersion){syncState.conflict=true;throw new Error('收藏或行程在另一端有修改，请到收藏与行程页面处理；本机资料未覆盖');}
    if(changed){
      const result=await callCloud<{version:number}>('library-manage',{action:'save',...local,version:localVersion});
      if(!allowed(identity))return;
      if(!result.ok || !result.data)throw new Error(result.errMsg || '保存资料失败');
      if(!Number.isSafeInteger(result.data.version)||result.data.version!==remote.data.version+1)throw new Error('云端资料版本响应无效，请重新同步');
      // Do not mark edits made during the request as synchronized.
      const versionKey=`he_library_version:${identity}`,baselineKey=`he_library_baseline:${identity}`;
      uni.setStorageSync(baselineKey,localSnapshot);
      // Write the version last so it acts as a commit marker if local storage
      // fails between the baseline and version writes.
      uni.setStorageSync(versionKey,result.data.version);
      if(Number(uni.getStorageSync(versionKey))!==result.data.version
          ||uni.getStorageSync(baselineKey)!==localSnapshot)throw new Error('云端已保存，但本机同步进度未能回读确认；本机资料已保留，请重试并核对');
    }else if(remote.data.version!==libraryVersion() || !baselineValid){
      if(JSON.stringify(readLibrary())!==JSON.stringify(local))throw new Error('本机资料刚刚改变，将在下一轮同步');
      writeLibrary({favorites:remote.data.favorites,plans:remote.data.plans});setLibraryVersion(remote.data.version);
    }
    releaseLibraryCloud();releaseLibraryCloud=undefined;
    if(hasPrivacyConsent('trackCloudSync')) {
      releaseTrackCloud=await acquireTrackCloudLock();
      if(!allowed(identity)||!hasPrivacyConsent('trackCloudSync'))return;
      if(!trackStorageValid())throw new Error('本机轨迹资料格式异常，云端轨迹同步已停止以保留原始记录；请勿清理应用数据');
      for(const track of listTracks().filter(t=>t.state==='finished'&&!t.synced&&t.localOwner===identity&&(!t.cloudOwner||t.cloudOwner===identity)&&!trackAutoSyncExcluded(t.id)).slice(0,10)){
        if(!allowed(identity)||!hasPrivacyConsent('trackCloudSync'))return;
        const uploaded=await uploadTrackToCloud(track,{lockHeld:true});if(!uploaded.ok)throw new Error(uploaded.errMsg);
      }
      let cursor=typeof savedCursor==='string'&&savedCursor.length<=128?savedCursor:'';
      for(let batch=0;batch<5;batch++){
        const listing=await callCloud<{tracks:{trackId:string;version:number;deleted:boolean}[];hasMore:boolean;nextCursor:string|null}>('track-manage',{action:'list',afterCursor:cursor});
        if(!allowed(identity)||!hasPrivacyConsent('trackCloudSync'))return;
        if(!listing.ok || !listing.data)throw new Error(listing.errMsg || '读取云轨迹失败');
        if(!Array.isArray(listing.data.tracks)||listing.data.tracks.length>20||typeof listing.data.hasMore!=='boolean'
          ||!listing.data.tracks.every(item=>item&&typeof item.trackId==='string'&&item.trackId.length>0&&item.trackId.length<=128&&Number.isSafeInteger(item.version)&&item.version>=(item.deleted===true?1:0)&&typeof item.deleted==='boolean')
          ||new Set(listing.data.tracks.map(item=>item.trackId)).size!==listing.data.tracks.length
          ||(listing.data.nextCursor!==null&&(typeof listing.data.nextCursor!=='string'||listing.data.nextCursor.length===0||listing.data.nextCursor.length>128||listing.data.nextCursor<=cursor))
          ||(listing.data.hasMore&&typeof listing.data.nextCursor!=='string')
          ||(listing.data.tracks.length>0&&typeof listing.data.nextCursor!=='string'))throw new Error('云端轨迹目录格式无效');
        for(const item of listing.data.tracks){
          const baseline=getTrack(item.trackId);
          if(item.deleted){
            if(!baseline||baseline.localOwner!==identity||(baseline.cloudOwner&&baseline.cloudOwner!==identity))continue;
            if(baseline.cloudVersion!==undefined&&baseline.cloudVersion>item.version)throw new Error(`轨迹 ${item.trackId} 云端版本回退，未覆盖本机资料`);
            const alreadyMarked=!baseline.synced&&baseline.cloudVersion===item.version&&baseline.cloudOwner===identity&&trackAutoSyncExcluded(item.trackId);
            if(!alreadyMarked){
              setTrackAutoSyncExcluded(item.trackId,true,identity);
              if(!trackAutoSyncExcluded(item.trackId))throw new Error('云端删除保护未保存；自动同步已停止以免重新上传该轨迹');
              saveTrack({...baseline,synced:false,cloudVersion:item.version,cloudOwner:identity});
            }
            continue;
          }
          if(trackAutoSyncExcluded(item.trackId))continue;
          if(baseline?.synced&&!baseline.cloudOwner)throw new Error(`轨迹 ${item.trackId} 的旧云端归属无法确认，请在云端轨迹页面核对后恢复`);
          if(baseline?.cloudOwner&&baseline.cloudOwner!==identity)throw new Error(`轨迹 ${item.trackId} 属于其他账号，请在当前账号手动恢复`);
          if(baseline&&!baseline.synced)throw new Error(`轨迹 ${item.trackId} 本机有未同步改动，请处理云端版本冲突`);
          if(baseline&&baseline.cloudVersion===item.version)continue;
          if(baseline&&baseline.cloudVersion!==undefined&&baseline.cloudVersion>item.version)
            throw new Error(`轨迹 ${item.trackId} 云端版本回退，未覆盖本机资料`);
          const fetched=await callCloud<{track:TrackRecord}>('track-manage',{action:'get',trackId:item.trackId});
          if(!allowed(identity)||!hasPrivacyConsent('trackCloudSync'))return;
          if(!fetched.ok||!fetched.data)throw new Error(fetched.errMsg || '恢复轨迹失败');
          if(!fetched.data.track||fetched.data.track.id!==item.trackId||fetched.data.track.state!=='finished'||fetched.data.track.synced!==true
            ||!Number.isSafeInteger(fetched.data.track.cloudVersion)||fetched.data.track.cloudVersion!==item.version)throw new Error('云端轨迹与请求不一致，本机资料未覆盖');
          if(JSON.stringify(getTrack(item.trackId))!==JSON.stringify(baseline))throw new Error('恢复期间本机轨迹已变化，本机资料未覆盖');
          saveTrack({...fetched.data.track,localOwner:identity,cloudOwner:identity});
        }
        cursor=listing.data.hasMore?(listing.data.nextCursor??''):'';
        persistTrackSyncCursor(identity,cursor);
        syncState.continuing=!!cursor;
        if(!listing.data.hasMore)break;
      }
      const remoteDeletedTracks=listTracks().filter(t=>t.state==='finished'&&t.localOwner===identity&&!t.synced&&t.cloudOwner===identity
        &&Number.isSafeInteger(t.cloudVersion)&&t.cloudVersion!>0&&trackAutoSyncExcluded(t.id));
      if(remoteDeletedTracks.length)syncState.error=`有 ${remoteDeletedTracks.length} 条轨迹已在另一设备从云端删除；本机副本已保留并暂停自动上传。可在“我的 → 云同步全部轨迹”确认重新备份，或单独删除本机副本`;
      const needsOwnershipReview=listTracks().filter(t=>t.state==='finished'&&(t.localOwner!==identity||(t.synced&&!t.cloudOwner)));
      if(needsOwnershipReview.length){const warning=`有 ${needsOwnershipReview.length} 条轨迹归属不属于当前账号或未知，自动同步已跳过；请在“我的 → 云同步全部轨迹”确认是否转入当前账号`;syncState.error=syncState.error?`${syncState.error}；${warning}`:warning;}
    }
    const syncSucceededAt=Date.now(),successKey=`he_auto_sync_last:${identity}`;
    uni.setStorageSync(successKey,syncSucceededAt);
    if(Number(uni.getStorageSync(successKey))!==syncSucceededAt)throw new Error('同步成功时间保存未确认；请重新同步并核对当前账号资料');
    syncState.lastSuccess=syncSucceededAt;
  }catch(e:any){if(owner()===identity)syncState.error=e.message || '同步失败，将在下次前台同步时重试';}finally{releaseTrackCloud?.();releaseLibraryCloud?.();syncState.running=false;if(rerunAfterCurrent){rerunAfterCurrent=false;void syncNow(true);}}
}
export function startSync():void {
  active=true;if(started)return;started=true;
  onAccountChange(()=>{syncState.error='';syncState.conflict=false;syncState.continuing=false;syncState.lastSuccess=Number(uni.getStorageSync(`he_auto_sync_last:${owner()}`)||0);void syncNow(true);});
  onPrivacyChange(()=>{if(!hasPrivacyConsent('trackCloudSync'))syncState.continuing=false;void syncNow();});
  timer=setInterval(()=>{void syncNow();},60000);void syncNow();
}
export function setSyncForeground(value:boolean):void {active=value;if(value){startSync();void syncNow();}}
