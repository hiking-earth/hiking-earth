/** Public account entry: initializes local migration once, without cyclic core imports. */
import {registerAccountLocalActions, type AccountSession} from './account-core';
import {listTracks, mergeVerifiedAccountTracks, saveTrack, setTrackAutoSyncExcluded, trackStorageValid, tryAcquireTrackCloudLock} from './tracks';
import {mergeVerifiedAccountLibraries, tryAcquireLibraryCloudLock} from './library';
import {stopBackgroundRecording} from './background';
import {stopCompass, stopLocationUpdates} from './location';
export * from './account-core';

function migrateLocalPartitions(session: AccountSession, aliases: string[]): boolean {
  let releaseLibrary: (() => void) | null = null;
  let releaseTracks: (() => void) | null = null;
  try {
    // Hold both cloud-operation queues before changing either local account
    // partition. If either queue is busy, leave aliases pending for a retry.
    releaseLibrary = tryAcquireLibraryCloudLock();
    if (!releaseLibrary) return false;
    releaseTracks = tryAcquireTrackCloudLock();
    if (!releaseTracks) return false;
    // Storage migration helpers share the server's 100-owner validation cap.
    // Keep the bounded batches explicit so a future cap change cannot silently
    // truncate verified aliases or leave local records outside the migration.
    let complete = true;
    for (let offset = 0; offset < aliases.length; offset += 100) {
      const batch = aliases.slice(offset, offset + 100);
      // Tracks and libraries have independent storage constraints. A full
      // library must not prevent safe track reassignment for the same owners.
      if (!mergeVerifiedAccountLibraries(batch, session.openid, true)) complete = false;
      if (!mergeVerifiedAccountTracks(batch, session.openid, true)) complete = false;
    }
    // The server rekeys merged cloud tracks to the target identity. Rewind its
    // _id cursor so records whose new IDs sort before the prior cursor are not
    // skipped forever on this device.
    try {
      const cursorKey = `he_auto_sync_cursor:${session.openid}`;
      uni.setStorageSync(cursorKey, '');
      if (uni.getStorageSync(cursorKey) !== '') complete = false;
    } catch { complete = false; }
    return complete;
  } finally { releaseTracks?.(); releaseLibrary?.(); }
}

function prepareLocalIdentity(nextOwner:string):boolean {
  const previous=String(uni.getStorageSync('he_openid')||'');
  if(previous===nextOwner)return false;
  try{stopLocationUpdates();}catch{}try{stopCompass();}catch{}try{stopBackgroundRecording();}catch{}
  try{uni.removeStorageSync('he_team');}catch{try{uni.setStorageSync('he_team','');}catch{}}
  // A successful sync to another account is not a sync to this account.
  const canRewriteTrackStore=trackStorageValid();
  listTracks().filter(track=>track.cloudOwner&&track.cloudOwner!==nextOwner).forEach(track=>{
    if(track.synced&&canRewriteTrackStore){try{saveTrack({...track,synced:false});}catch{/* Keep the track and continue the identity change safely. */}}
    try{setTrackAutoSyncExcluded(track.id,true,nextOwner);}catch{/* Per-account exclusion is best-effort; never block login. */}
  });
  return true;
}

registerAccountLocalActions({migrate:migrateLocalPartitions,changeOwner:prepareLocalIdentity});
