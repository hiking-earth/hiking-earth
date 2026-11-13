import {sha256} from '@noble/hashes/sha256';
import {Unzip,UnzipInflate,UnzipPassThrough,strFromU8} from 'fflate';
import {validateTerrainManifest,TERRAIN_PACK_MAX_BYTES,type TerrainPackManifest} from '@shared/terrain/terrarium';
import type {CustomMapArchiveReader} from './custom-map-archive';
export const TERRAIN_ARCHIVE_MAX_BYTES=33*1024*1024;
export interface TerrainArchive {manifest:TerrainPackManifest;tiles:Map<string,Uint8Array>;bytes:number;sha256:string}
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
/** Bounded import only: no filesystem writes, network calls or extraction paths. */
export async function readTerrainArchive(source:CustomMapArchiveReader,expected:{bytes:number;sha256:string}):Promise<TerrainArchive>{
 if(!Number.isSafeInteger(source.size)||source.size<22||source.size>TERRAIN_ARCHIVE_MAX_BYTES||expected?.bytes!==source.size||!/^[a-f0-9]{64}$/.test(expected.sha256))throw new Error('地形包大小或SHA无效');
 const files=new Map<string,Uint8Array>(),seen=new Set<string>();let total=0,finished=0,failure:Error|undefined;
 const unzip=new Unzip(file=>{
  try{
   const meta=['manifest.json','ATTRIBUTION.txt'].includes(file.name),tile=/^tiles\/(0|[1-9][0-9]?)\/(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)\.png$/.test(file.name);
   const size=file.originalSize,compressed=file.size;
   if(seen.has(file.name)||seen.size>=258||(!meta&&!tile)||![0,8].includes(file.compression)||!Number.isSafeInteger(size)||size!<1||size!>(meta?256*1024:1024*1024)||!Number.isSafeInteger(compressed)||compressed!<0||size!>Math.max(1024*1024,compressed!)*100)throw new Error('地形压缩包条目无效');
   seen.add(file.name);total+=size!;if(total>TERRAIN_PACK_MAX_BYTES+512*1024)throw new Error('地形解压总量超限');
   const output=new Uint8Array(size!);let offset=0;
   file.ondata=(error,chunk,final)=>{try{if(error)throw error;if(offset+chunk.length>output.length)throw new Error('地形条目超出声明');output.set(chunk,offset);offset+=chunk.length;if(final){if(offset!==output.length)throw new Error('地形条目不完整');files.set(file.name,output);finished++;}}catch(e){failure=e instanceof Error?e:new Error('地形解压失败');}};
   file.start();
  }catch(e){failure=e instanceof Error?e:new Error('地形包结构无效');}
 });unzip.register(UnzipPassThrough);unzip.register(UnzipInflate);const hash=sha256.create();
 for(let offset=0;offset<source.size;offset+=256*1024){if(failure)throw failure;const length=Math.min(256*1024,source.size-offset),chunk=await source.read(offset,length);if(!(chunk instanceof Uint8Array)||chunk.length!==length)throw new Error('地形包读取不完整');hash.update(chunk);unzip.push(chunk,offset+length===source.size);if(failure)throw failure;}
 if(finished!==seen.size||hex(hash.digest())!==expected.sha256)throw new Error('地形归档不完整或SHA不符');
 const metadata=files.get('manifest.json'),notice=files.get('ATTRIBUTION.txt');if(!metadata||!notice)throw new Error('地形包缺少清单与署名');
 let parsed:unknown;try{parsed=JSON.parse(strFromU8(metadata));}catch{throw new Error('地形清单JSON无效');}const manifest=validateTerrainManifest(parsed);
 if(strFromU8(notice)!==manifest.attribution+'\n'+manifest.licenseUrl)throw new Error('地形署名与清单不一致');
 if(files.size!==manifest.tiles.length+2)throw new Error('地形包存在未列出或缺少的瓦片');
 const tiles=new Map<string,Uint8Array>();let bytes=metadata.length+notice.length;
 for(const row of manifest.tiles){const data=files.get(row.path);if(!data||data.length!==row.bytes||hex(sha256(data))!==row.sha256)throw new Error('地形瓦片SHA不符');
  const header=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(data.length<33||header.getUint32(0)!==0x89504e47||header.getUint32(4)!==0x0d0a1a0a||header.getUint32(8)!==13||header.getUint32(12)!==0x49484452||header.getUint32(16)!==256||header.getUint32(20)!==256||data[24]!==8||![2,6].includes(data[25]))throw new Error('地形瓦片不是受支持的256像素RGB PNG');
  tiles.set(row.path,data);bytes+=data.length;
 }return {manifest,tiles,bytes,sha256:expected.sha256};
}
