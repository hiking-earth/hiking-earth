import {verifyBasemapDigest} from './basemap-digest';
import type {SavedBasemap} from './basemap-store';
import type {BasemapDownload} from './basemap-download';
/** A matching filename or byte count is not proof that the local version is current. */
export async function findVerifiedSavedBasemap(rows:SavedBasemap[],pack:Pick<BasemapDownload,'name'|'bytes'|'sha256'>):Promise<SavedBasemap|null>{
 if(!/^[a-z0-9-]{1,80}\.pmtiles$/.test(pack.name)||!Number.isSafeInteger(pack.bytes)||pack.bytes<127||pack.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(pack.sha256))throw new Error('地图版本信息无效');
 if(!Array.isArray(rows)||rows.length>4096)throw new Error('地图目录无效，请保留原包');
 for(const row of rows){
  if(row.name!==pack.name||row.bytes!==pack.bytes||!(row.blob instanceof Blob)||row.blob.size!==pack.bytes)continue;
  try{await verifyBasemapDigest((offset,length)=>row.blob.slice(offset,offset+length).arrayBuffer(),row.bytes,pack.sha256);return row;}catch{
   // Keep mismatched or unreadable local copies; a new download may still be valid.
  }
 }
 return null;
}
