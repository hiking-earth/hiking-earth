import {sha256} from '@noble/hashes/sha256';
import {openBasemapDatabase,basemapStorageBytes,terrainStorageBytes,BASEMAP_BUDGET} from './basemap-store';
import {readTerrainArchive,TERRAIN_ARCHIVE_MAX_BYTES,type TerrainArchive} from './terrain-archive';
export interface SavedTerrain {id:string;name:string;bytes:number;savedAt:number;sha256:string;blob:Blob}
const hex=(v:Uint8Array)=>Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
export async function listTerrain():Promise<SavedTerrain[]>{
 const db=await openBasemapDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('terrain','readonly'),q=tx.objectStore('terrain').getAll();tx.oncomplete=()=>{try{terrainStorageBytes(q.result);resolve(q.result);}catch(e){reject(e);}};tx.onerror=tx.onabort=()=>reject(new Error('地形目录读取失败'));});
}
export async function decodeTerrain(blob:Blob,digest:string):Promise<TerrainArchive>{return readTerrainArchive({size:blob.size,read:async(o,n)=>new Uint8Array(await blob.slice(o,o+n).arrayBuffer())},{bytes:blob.size,sha256:digest});}
export async function importTerrain(file:File):Promise<SavedTerrain>{
 if(file.size<22||file.size>TERRAIN_ARCHIVE_MAX_BYTES)throw new Error('地形ZIP最多33 MiB');
 const hash=sha256.create();for(let o=0;o<file.size;o+=256*1024)hash.update(new Uint8Array(await file.slice(o,o+256*1024).arrayBuffer()));
 const digest=hex(hash.digest()),archive=await decodeTerrain(file,digest);
 const row:SavedTerrain={id:crypto.randomUUID(),name:archive.manifest.id,bytes:file.size,savedAt:Date.now(),sha256:digest,blob:file};
 const db=await openBasemapDatabase();await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(['maps','terrain'],'readwrite'),store=tx.objectStore('terrain'),a=store.getAll(),b=tx.objectStore('maps').getAll();let pending=2,message='地形保存失败，原资料已保留';
  const ready=()=>{if(--pending)return;try{if(a.result.length>=128||terrainStorageBytes(a.result)+basemapStorageBytes(b.result)+row.bytes>BASEMAP_BUDGET)throw new Error('地图与地形总量超过192 MiB或数量上限，请先删除不使用的包');store.add(row);}catch(e){message=e instanceof Error?e.message:message;tx.abort();}};
  a.onsuccess=b.onsuccess=ready;tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error(message));
 });return row;
}
export async function deleteTerrain(id:string):Promise<void>{const db=await openBasemapDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('terrain','readwrite');tx.objectStore('terrain').delete(id);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('地形删除失败'));});}
