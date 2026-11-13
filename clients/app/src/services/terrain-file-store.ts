import {sha256} from '@noble/hashes/sha256';
import {createWechatMapStore,type SavedMapApi} from './wechat-basemap-store';
import {readTerrainArchive,TERRAIN_ARCHIVE_MAX_BYTES,type TerrainArchive} from './terrain-archive';
import type {CustomMapArchiveReader} from './custom-map-archive';
export interface TerrainFileReader extends CustomMapArchiveReader {}
const hex=(v:Uint8Array)=>Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
/** Shares the vector-map platform queue and quota; does not download or extract files. */
export function createTerrainFileStore(api:SavedMapApi,read:(path:string,bytes:number)=>TerrainFileReader,platform:'wechat'|'native'){
 async function inspect(path:string,bytes:number):Promise<TerrainArchive>{
  if(!Number.isSafeInteger(bytes)||bytes<127||bytes>TERRAIN_ARCHIVE_MAX_BYTES)throw new Error('地形ZIP无效或超过33 MiB');
  const source=read(path,bytes);if(source.size!==bytes)throw new Error('地形文件大小不符');const hash=sha256.create();
  for(let o=0;o<bytes;o+=256*1024){const length=Math.min(256*1024,bytes-o),chunk=await source.read(o,length);if(!(chunk instanceof Uint8Array)||chunk.length!==length)throw new Error('地形文件读取不完整');hash.update(chunk);}
  return readTerrainArchive(source,{bytes,sha256:hex(hash.digest())});
 }
 const store=createWechatMapStore(api,inspect,platform,'terrain');
 return {...store,inspect,async import(path:string,bytes:number){const archive=await inspect(path,bytes);return store.save(path,bytes,archive.manifest.id);}};
}
