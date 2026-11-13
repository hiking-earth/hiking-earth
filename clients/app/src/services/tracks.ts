/**
 * Local-first track storage. Cloud uploads require the per-account track
 * backup consent and are started manually or by that account's auto-sync.
 */
import type { TrackRecord } from "@shared/types/track";
import { validTrackPoint } from "@shared/types/track";
import { accountSession } from "@/services/account-core";
import { hasPrivacyConsent } from "@/services/privacy";
import { callCloud } from "@/services/cloud";

let trackCloudQueue: Promise<void> = Promise.resolve();
let trackCloudOperationActive = false;
let trackCloudOperationWaiting = 0;
function trackCloudLockRelease(unlock: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    trackCloudOperationActive = false;
    unlock();
  };
}
export async function acquireTrackCloudLock(): Promise<() => void> {
  const previous = trackCloudQueue;
  let unlock!: () => void;
  trackCloudQueue = new Promise<void>(resolve => { unlock = resolve; });
  trackCloudOperationWaiting++;
  await previous;
  trackCloudOperationWaiting--;
  trackCloudOperationActive = true;
  return trackCloudLockRelease(unlock);
}
/** Synchronous account migration must defer if any cloud-track operation is active or queued. */
export function tryAcquireTrackCloudLock(): (() => void) | null {
  if (trackCloudOperationActive || trackCloudOperationWaiting > 0) return null;
  let unlock!: () => void;
  trackCloudQueue = new Promise<void>(resolve => { unlock = resolve; });
  trackCloudOperationActive = true;
  return trackCloudLockRelease(unlock);
}

const KEY = "he_tracks_v1";

/** The current account identity used to bind a new local track. */
export function currentTrackOwner(): string {
  const session = accountSession();
  if (session) return session.openid;
  const saved = String(uni.getStorageSync('he_openid') || '');
  return saved && saved !== 'local-mock-user' && !saved.startsWith('account:') ? saved : '';
}

/** Anonymous work stays in its own local partition; authenticated accounts never see it by default. */
export function currentLocalTrackOwner(): string { return currentTrackOwner() || 'anonymous'; }

function parseTrackStore(raw: unknown): TrackRecord[] | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(value)) return null;
    const ids = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return null;
      const track = value[index];
      if (!validRecord(track) || ids.has(track.id)) return null;
      ids.add(track.id);
      for (let point = 0; point < track.points.length; point++)
        if (!Object.prototype.hasOwnProperty.call(track.points, point) || !validTrackPoint(track.points[point])) return null;
    }
    return value;
  } catch { return null; }
}

/** True only when the complete local track store can be read without dropping any record. */
export function trackStorageValid(): boolean {
  try {
    const raw = uni.getStorageSync(KEY);
    return raw === undefined || raw === null || raw === '' || parseTrackStore(raw) !== null;
  } catch { return false; }
}

/** Read-only emergency copy of the original track-store payload; never parses or rewrites it. */
export function rawTrackStoreSnapshot(): { text: string; extension: 'json' | 'txt' } | null {
  try {
    const raw = uni.getStorageSync(KEY);
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw === 'string') {
      try { JSON.parse(raw); return { text: raw, extension: 'json' }; }
      catch { return { text: raw, extension: 'txt' }; }
    }
    const text = JSON.stringify(raw);
    return typeof text === 'string' ? { text, extension: 'json' } : null;
  } catch { return null; }
}

function writeTrackStore(next: TrackRecord[]): void {
  if (!parseTrackStore(next)) throw new Error('本机轨迹列表格式无效，未保存');
  const previousRaw = uni.getStorageSync(KEY);
  const previous = previousRaw === undefined || previousRaw === null || previousRaw === '' ? [] : parseTrackStore(previousRaw);
  if (!previous) throw new Error('本机轨迹资料格式异常，已阻止覆盖；请保留应用数据，待统一修复后处理');
  const serialized = JSON.stringify(next);
  try {
    uni.setStorageSync(KEY, serialized);
    const saved = parseTrackStore(uni.getStorageSync(KEY));
    if (!saved || JSON.stringify(saved) !== serialized) throw new Error('本机轨迹保存回读不一致');
  } catch (error) {
    // A failed storage write must not leave a partially replaced GPS history.
    try {
      if (previousRaw === undefined || previousRaw === null || previousRaw === '') uni.removeStorageSync(KEY);
      else uni.setStorageSync(KEY, previousRaw);
    } catch { /* Keep the original error; the caller will ask the user not to clear app data. */ }
    throw error;
  }
}

export function listTracks(): TrackRecord[] {
  try {
    const raw = uni.getStorageSync(KEY);
    // uni storage may return already-decoded arrays on some adapters; parsing
    // those again throws and makes a valid store look empty to later writers.
    const all = typeof raw === 'string' ? (raw ? JSON.parse(raw) : []) : (raw ?? []);
    return Array.isArray(all) ? all.filter(validRecord) : [];
  } catch {
    return [];
  }
}

/** Reassign local tracks only after the server has verified and completed an account merge. */
export function mergeVerifiedAccountTracks(sourceOwners: string[], targetOwner: string, lockHeld = false): boolean {
  if (!targetOwner || !Array.isArray(sourceOwners) || sourceOwners.length > 100
      || sourceOwners.some(owner => typeof owner !== 'string' || !owner || owner.length > 128)) return false;
  const releaseCloud = lockHeld ? null : tryAcquireTrackCloudLock();
  if (!lockHeld && !releaseCloud) return false;
  try {
    const raw = uni.getStorageSync(KEY);
    const current = raw === undefined || raw === null || raw === '' ? [] : parseTrackStore(raw);
    if (!current) return false;
    const owners = new Set(sourceOwners.filter(owner => owner !== targetOwner));
    const migratedIds = new Set<string>();
    const next = current.map(track => {
      const localOwner = track.localOwner;
      if (typeof localOwner !== 'string' || !owners.has(localOwner)) return track;
      migratedIds.add(track.id);
      return { ...track, localOwner: targetOwner,
        ...(track.cloudOwner && owners.has(track.cloudOwner) ? { cloudOwner: targetOwner } : {}) };
    });
    if (!migratedIds.size) return true;

    // Track sync exclusions are per account and stored separately from the
    // track record. Carry a source opt-out to the verified target identity
    // before changing ownership; never turn private tracks into auto uploads.
    const excluded = new Set<string>(readTrackSyncExclusions(targetOwner));
    for (const owner of owners) {
      for (const id of readTrackSyncExclusions(owner)) if (migratedIds.has(id)) excluded.add(id);
    }
    const nextExcluded = [...excluded];
    if(nextExcluded.length>MAX_TRACK_SYNC_EXCLUSIONS)return false;
    writeTrackSyncExclusions(targetOwner,nextExcluded);
    writeTrackStore(next);
    return true;
  } catch { return false; }
  finally { releaseCloud?.(); }
}

export function getTrack(id: string): TrackRecord | null {
  return listTracks().find((t) => t.id === id) ?? null;
}

export function listCurrentOwnerTracks(): TrackRecord[] {
  const owner=currentLocalTrackOwner();
  return listTracks().filter(track=>track.localOwner===owner);
}

export function getCurrentOwnerTrack(id:string): TrackRecord|null {
  const track=getTrack(id);
  return track?.localOwner===currentLocalTrackOwner()?track:null;
}

/** A local copy needs review if it is unsynced, has unknown ownership, or is tied to another account. */
export function trackNeedsManualBackup(track: TrackRecord, owner = currentTrackOwner()): boolean {
  return !track.synced || track.localOwner !== owner || (track.synced && !track.cloudOwner);
}

export function saveTrack(track: TrackRecord): void {
  if (!validRecord(track)) throw new Error("轨迹格式无效，未保存");
  if (!trackStorageValid()) throw new Error('本机轨迹资料格式异常，已阻止覆盖；请保留应用数据，待统一修复后处理');
  const all = listTracks();
  const idx = all.findIndex((t) => t.id === track.id);
  if (idx >= 0) all[idx] = track;
  else all.unshift(track);
  writeTrackStore(all);
}

export function deleteTrack(id: string): void {
  if (!trackStorageValid()) throw new Error('本机轨迹资料格式异常，已阻止删除或覆盖；请保留应用数据，待统一修复后处理');
  const wasExcluded = trackAutoSyncExcluded(id);
  setTrackAutoSyncExcluded(id, true);
  try { writeTrackStore(listTracks().filter((t) => t.id !== id)); }
  catch (error) { setTrackAutoSyncExcluded(id, wasExcluded); throw error; }
}

const trackUploads = new Set<string>();
export type TrackUploadResult = { ok: true } | { ok: false; errMsg: string };
export async function uploadTrackToCloud(track:TrackRecord,options:{restoreDeleted?:boolean;transferAccount?:boolean;lockHeld?:boolean}={}):Promise<TrackUploadResult>{
  const releaseCloud = options.lockHeld ? undefined : await acquireTrackCloudLock();
  try {
  if(!trackStorageValid())return {ok:false,errMsg:'本机轨迹资料格式异常，云同步已停止以保留原始资料；请勿清理应用数据'};
  if(!hasPrivacyConsent('trackCloudSync'))return {ok:false,errMsg:'未启用轨迹云备份授权'};
  if(track.state!=='finished'||!validRecord(track))return {ok:false,errMsg:'仅可同步格式有效的已完成轨迹'};
  if(trackUploads.has(track.id))return {ok:false,errMsg:'该轨迹正在同步'};
  const session=accountSession();
  if(session?.mergedIdentities?.length)return {ok:false,errMsg:'账号资料仍在安全合并，完成后再同步轨迹'};
  const identity=currentTrackOwner();
  const token=session?.token||'';
  if(!identity)return {ok:false,errMsg:'请先登录统一账号'};
  if(track.localOwner!==identity&&!options.transferAccount)return {ok:false,errMsg:track.localOwner?'该轨迹属于其他本机账号，请确认后手动转存':'该旧版轨迹未记录账号归属，请确认后手动转入当前账号'};
  if(track.cloudOwner&&track.cloudOwner!==identity&&!options.transferAccount)return {ok:false,errMsg:'该轨迹属于其他账号，请在确认转存后手动同步'};
  const expectedVersion=track.cloudOwner&&track.cloudOwner!==identity?0:track.cloudVersion??0;
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)return {ok:false,errMsg:'本机轨迹云端版本无效，请恢复云端副本'};
  if(JSON.stringify(getTrack(track.id))!==JSON.stringify(track))return {ok:false,errMsg:'本机轨迹已变化，请刷新后重试'};
  trackUploads.add(track.id);
  try{
    const response=await callCloud<{synced:boolean;version:number}>('track-sync',{track,expectedVersion,restoreDeleted:options.restoreDeleted===true});
    if(!trackStorageValid())return {ok:false,errMsg:'本机轨迹资料在同步期间发生异常，已保留本机原始资料；云端回执未应用到本机'};
    const latestSession=accountSession();
    const latestIdentity=currentTrackOwner();
    if(latestIdentity!==identity||(token&&latestSession?.token!==token)||!hasPrivacyConsent('trackCloudSync'))return {ok:false,errMsg:'账号或轨迹备份授权已变化，轨迹仍保留在本机'};
    if(!response.ok||response.data?.synced!==true||response.data.version!==expectedVersion+1)
      return {ok:false,errMsg:response.errMsg||'云端版本冲突或未确认；请从云端恢复最新副本后再同步'};
    if(JSON.stringify(getTrack(track.id))!==JSON.stringify(track))return {ok:false,errMsg:'同步期间本机轨迹已变化，云端回执未应用到本机'};
    markSynced(track.id,response.data.version,identity);return {ok:true};
  }catch{return {ok:false,errMsg:'云端未确认轨迹同步，轨迹仍保留待重试'};}finally{trackUploads.delete(track.id);}
  } finally { releaseCloud?.(); }
}

export function markSynced(id: string, cloudVersion:number, cloudOwner:string): void {
  const t = getTrack(id);
  if (t && Number.isSafeInteger(cloudVersion) && cloudVersion>=1 && typeof cloudOwner==='string' && cloudOwner.length>0) {saveTrack({ ...t, synced: true, localOwner:cloudOwner, cloudVersion, cloudOwner });setTrackAutoSyncExcluded(id,false); }
}

// 恢复时只恢复为暂停；不得在启动应用时自动取得定位权限。
const LEGACY_DRAFT_KEY = "he_track_draft_v1";
const draftKey=(owner=currentLocalTrackOwner())=>`he_track_draft_v2:${encodeURIComponent(owner)}`;
function readOwnedDraft(owner=currentLocalTrackOwner(),migrateLegacy=true):any|null{
  const current=uni.getStorageSync(draftKey(owner));if(current)return typeof current==='string'?JSON.parse(current):current;
  const legacy=uni.getStorageSync(LEGACY_DRAFT_KEY);if(!legacy)return null;
  const value=typeof legacy==='string'?JSON.parse(legacy):legacy;
  if(!validRecord(value)||value.localOwner!==owner)return null;
  if(migrateLegacy){uni.setStorageSync(draftKey(owner),JSON.stringify(value));uni.removeStorageSync(LEGACY_DRAFT_KEY);}
  return value;
}
export function saveDraft(track: TrackRecord): void {
  if (!validRecord(track)) throw new Error("轨迹草稿格式无效，未保存");
  const owner=track.localOwner||'anonymous';
  const key=draftKey(owner),previousRaw=uni.getStorageSync(key);
  if(previousRaw!==undefined&&previousRaw!==null&&previousRaw!==''){
    let previous:any;
    try{previous=typeof previousRaw==='string'?JSON.parse(previousRaw):previousRaw;}catch{throw new Error('本机轨迹草稿格式异常，已保留原草稿；请勿清理应用数据');}
    if(!validRecord(previous)||previous.localOwner!==owner||previous.id!==track.id)
      throw new Error('本机已有其他或异常轨迹草稿，已保留原草稿；请先恢复或整理后再记录');
  }
  const serialized=JSON.stringify(track);
  try{
    uni.setStorageSync(key,serialized);
    const saved=uni.getStorageSync(key),parsed=typeof saved==='string'?JSON.parse(saved):saved;
    if(!validRecord(parsed)||JSON.stringify(parsed)!==serialized)throw new Error('本机轨迹草稿保存回读不一致');
  }catch(error){
    try{if(previousRaw===undefined||previousRaw===null||previousRaw==='')uni.removeStorageSync(key);else uni.setStorageSync(key,previousRaw);}catch{}
    throw error;
  }
}
export function loadDraft(): TrackRecord | null {
  try {
    const t=readOwnedDraft();
    if (!validRecord(t)) return null;
    if (t.localOwner!==currentLocalTrackOwner()) return null;
    // A completed local save takes precedence over a stale draft left by cleanup failure.
    if (getTrack(t.id)?.state === "finished") return null;
    return { ...t, state: "paused", synced: false };
  } catch { return null; }
}
/** Legacy drafts without an owner stay hidden until the user explicitly claims them. */
export function hasUnassignedDraft():boolean {
  try{const raw=uni.getStorageSync(LEGACY_DRAFT_KEY);if(!raw)return false;const t=typeof raw==='string'?JSON.parse(raw):raw;return validRecord(t)&&(!t.localOwner||t.localOwner==='anonymous')&&getTrack(t.id)?.state!=='finished';}catch{return false;}
}
export function claimUnassignedDraft(expectedOwner=currentLocalTrackOwner()):boolean {
  if(expectedOwner!==currentLocalTrackOwner())return false;
  try{const raw=uni.getStorageSync(LEGACY_DRAFT_KEY);if(!raw)return false;const t=typeof raw==='string'?JSON.parse(raw):raw;if(!validRecord(t)||(t.localOwner&&t.localOwner!=='anonymous')||getTrack(t.id)?.state==='finished')return false;
    uni.setStorageSync(draftKey(expectedOwner),JSON.stringify({...t,localOwner:expectedOwner,state:'paused',synced:false}));uni.removeStorageSync(LEGACY_DRAFT_KEY);return true;
  }catch{return false;}
}
export function clearDraft(): void {
  const owner=currentLocalTrackOwner();uni.removeStorageSync(draftKey(owner));
  try{const raw=uni.getStorageSync(LEGACY_DRAFT_KEY);const value=typeof raw==='string'?JSON.parse(raw):raw;if(value?.localOwner===owner)uni.removeStorageSync(LEGACY_DRAFT_KEY);}catch{}
}

function validRecord(t: any): t is TrackRecord {
  const validTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8640000000000000;
  return !!t && typeof t.id === "string" && !!t.id.trim() && typeof t.name === "string" && Array.isArray(t.points)
    && validTime(t.startedAt) && (t.endedAt === undefined || (validTime(t.endedAt) && t.endedAt >= t.startedAt))
    && [t.distanceM, t.ascentM, t.descentM].every(value => Number.isFinite(value) && value >= 0)
    && (t.activeDurationMs === undefined || (Number.isFinite(t.activeDurationMs) && t.activeDurationMs >= 0))
    && ['recording', 'paused', 'finished'].includes(t.state) && typeof t.synced === 'boolean'
    && (t.cloudVersion===undefined || (Number.isSafeInteger(t.cloudVersion) && t.cloudVersion>=0))
    && (t.localOwner===undefined || (typeof t.localOwner==='string' && t.localOwner.length>0 && t.localOwner.length<=128))
    && (t.cloudOwner===undefined || (typeof t.cloudOwner==='string' && t.cloudOwner.length>0 && t.cloudOwner.length<=128))
    && (t.routeId === undefined || typeof t.routeId === 'string')
    && t.points.every(validTrackPoint);
}

// A local deletion remains local, including when automatic cloud restore runs.
const MAX_TRACK_SYNC_EXCLUSIONS=100_000;
function readTrackSyncExclusions(owner:string):string[] {
  if(typeof owner!=='string'||owner.length>128)throw new Error('轨迹同步隐私设置账号无效');
  const raw=uni.getStorageSync(`he_track_sync_excluded:${owner}`);
  if(raw===undefined||raw===null||raw==='')return [];
  if(!Array.isArray(raw)||raw.length>MAX_TRACK_SYNC_EXCLUSIONS||Object.keys(raw).length!==raw.length
    ||Array.from({length:raw.length},(_,index)=>Object.prototype.hasOwnProperty.call(raw,index)).some(present=>!present)
    ||raw.some(item=>typeof item!=='string'||!item||item.length>128)||new Set(raw).size!==raw.length)
    throw new Error('轨迹同步隐私设置格式异常，已保留原始记录；请勿清理应用数据');
  return raw;
}
function writeTrackSyncExclusions(owner:string,next:string[]):void {
  if(typeof owner!=='string'||owner.length>128||!Array.isArray(next)||next.length>MAX_TRACK_SYNC_EXCLUSIONS
    ||Object.keys(next).length!==next.length
    ||Array.from({length:next.length},(_,index)=>Object.prototype.hasOwnProperty.call(next,index)).some(present=>!present)
    ||next.some(item=>typeof item!=='string'||!item||item.length>128)||new Set(next).size!==next.length)
    throw new Error('轨迹同步隐私设置无效，未修改本机记录');
  const key=`he_track_sync_excluded:${owner}`;
  const raw=uni.getStorageSync(key);
  readTrackSyncExclusions(owner);
  const previous=raw===undefined||raw===null||raw===''?raw:[...(raw as string[])];
  const desired=[...next];
  try{
    uni.setStorageSync(key,desired);
    const saved=readTrackSyncExclusions(owner);
    if(saved.length!==desired.length||saved.some((item,index)=>item!==desired[index]))
      throw new Error('轨迹同步隐私设置写入回读不一致');
  }catch(error){
    try{if(previous===undefined||previous===null||previous==='')uni.removeStorageSync(key);else uni.setStorageSync(key,previous);}catch{/* Preserve the original failure and never reinterpret it as consent. */}
    throw error;
  }
}
export function trackAutoSyncExcluded(id:string):boolean {
  const owner=currentTrackOwner();
  return readTrackSyncExclusions(owner).includes(id);
}
export function setTrackAutoSyncExcluded(id:string,value:boolean,ownerOverride?:string):void {
  const owner=ownerOverride??currentTrackOwner();
  if(typeof owner!=='string'||owner.length>128||typeof id!=='string'||!id||id.length>128||typeof value!=='boolean')
    throw new Error('轨迹同步隐私设置无效，未修改本机记录');
  const items=readTrackSyncExclusions(owner);
  const nextItems=new Set<string>(items);
  if(value)nextItems.add(id);else nextItems.delete(id);
  const next=[...nextItems];
  if(next.length>MAX_TRACK_SYNC_EXCLUSIONS)throw new Error('轨迹同步隐私设置数量超出安全上限，未修改本机记录');
  writeTrackSyncExclusions(owner,next);
}
export function hasRecordingDraft():boolean {
  try {const track=readOwnedDraft(currentLocalTrackOwner());return validRecord(track)&&track.localOwner===currentLocalTrackOwner()&&track.state==='recording';}catch{return false;}
}
