type Source='osm'|'usfs'|'hk'|'news';
const PAGE_SIZE=400,WINDOW_LIMIT=40000,MAX_RECORDS=250000;
const HEX=/^[a-f0-9]{64}$/;
export type StaticManifest={schemaVersion:1;snapshot:string;key:'routes'|'items';total:number;pageSize:400;pages:string[];indexHash:string;metadata:Record<string,any>};
export type StaticPage={snapshot:string;key:string;metadata:Record<string,any>;total:number;page:number;hasMore:boolean;items:any[]};

function object(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('catalog metadata invalid');return value as Record<string,any>;}
async function responseBytes(response:Response,limit:number):Promise<Uint8Array>{
 if(!response.ok||!response.body)throw new Error('static catalog unavailable');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('static catalog exceeds byte budget');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
function join(chunks:Uint8Array[],length:number):Uint8Array{const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;}
async function streamBytes(stream:ReadableStream<Uint8Array>,limit:number):Promise<Uint8Array>{
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('decompressed catalog exceeds byte budget');}chunks.push(value);}}
 finally{reader.releaseLock();}
 return join(chunks,length);
}
function isGzip(bytes:Uint8Array){return bytes.length>2&&bytes[0]===0x1f&&bytes[1]===0x8b;}
async function unpack(bytes:Uint8Array,limit:number){
 if(!isGzip(bytes))return bytes;
 if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot read the compressed route catalog');
 return streamBytes(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip')),limit);
}
async function sha256(bytes:Uint8Array){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return [...digest].map(value=>value.toString(16).padStart(2,'0')).join('');}
function validateManifest(value:unknown,source:Source):StaticManifest{
 const data=object(value),key=source==='news'?'items':'routes';
 if(data.schemaVersion!==1||data.key!==key||data.pageSize!==PAGE_SIZE||!HEX.test(data.snapshot)||!Number.isInteger(data.total)||data.total<0||data.total>MAX_RECORDS||!Array.isArray(data.pages)||data.pages.length!==Math.max(1,Math.ceil(data.total/PAGE_SIZE))||!data.pages.every((hash:any)=>typeof hash==='string'&&HEX.test(hash))||!HEX.test(data.indexHash)||data.metadata?.schemaVersion!==1||!Number.isFinite(Date.parse(data.metadata?.generatedAt)))throw new Error('static catalog manifest invalid');
 return data as StaticManifest;
}
export async function staticManifest(source:Source):Promise<StaticManifest>{
 const response=await fetch(`/route-catalog/${source}/manifest.json`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 return validateManifest(await response.json(),source);
}
async function page(manifest:StaticManifest,source:Source,pageNumber:number):Promise<any[]>{
 const path=`/route-catalog/${source}/${manifest.snapshot}/page-${String(pageNumber).padStart(5,'0')}.json.gz`;
 const response=await fetch(path,{cache:'force-cache',signal:AbortSignal.timeout(20000)}),compressed=await responseBytes(response,2*1024*1024);
 const payload=await unpack(compressed,4*1024*1024);
 if(await sha256(payload)!==manifest.pages[pageNumber])throw new Error('static catalog page hash mismatch');
 const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
 const expected=Math.max(0,Math.min(PAGE_SIZE,manifest.total-pageNumber*PAGE_SIZE));
 if(!Array.isArray(rows)||rows.length!==expected)throw new Error('static catalog page length mismatch');
 return rows;
}
async function pages(manifest:StaticManifest,source:Source,count:number):Promise<any[]>{
 const all:any[]=[],pageCount=Math.max(1,Math.ceil(count/PAGE_SIZE));
 for(let start=0;start<pageCount;start+=8){
  const numbers=Array.from({length:Math.min(8,pageCount-start)},(_,index)=>start+index);
  const batches=await Promise.all(numbers.map(number=>page(manifest,source,number)));
  for(const rows of batches)all.push(...rows);
 }
 if(all.length!==count)throw new Error('static catalog incomplete');return all;
}
export async function loadStaticPages(source:Source,knownManifest?:StaticManifest):Promise<StaticPage>{
 const manifest=knownManifest||await staticManifest(source),total=Math.min(manifest.total,WINDOW_LIMIT),items=await pages(manifest,source,total);
 return {snapshot:manifest.snapshot,key:manifest.key,metadata:{...manifest.metadata,sourceTotal:manifest.total,loadedTotal:total,complete:total===manifest.total},total,page:0,hasMore:total>PAGE_SIZE,items};
}
export async function searchStatic(source:Exclude<Source,'news'>,query:string,offset:number,expectedSnapshot?:string):Promise<{snapshot:string;key:string;metadata:Record<string,any>;items:any[];total:number;offset:number;hasMore:boolean}>{
 const manifest=await staticManifest(source);if(expectedSnapshot&&expectedSnapshot!==manifest.snapshot)throw new Error('static catalog changed during search');
 const indexResponse=await fetch(`/route-catalog/${source}/${manifest.snapshot}/index.json.gz`,{cache:'force-cache',signal:AbortSignal.timeout(30000)}),packed=await responseBytes(indexResponse,8*1024*1024),payload=await unpack(packed,32*1024*1024);
 if(await sha256(payload)!==manifest.indexHash)throw new Error('static catalog index hash mismatch');
 const index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
 if(!Array.isArray(index)||index.length!==manifest.total||!index.every((row:any)=>Array.isArray(row)&&row.length===4&&typeof row[0]==='string'&&typeof row[1]==='string'&&Number.isInteger(row[2])&&row[2]>=0&&row[2]<manifest.pages.length&&Number.isInteger(row[3])&&row[3]>=0&&row[3]<PAGE_SIZE))throw new Error('static catalog index invalid');
 const terms=query.normalize('NFKC').toLowerCase().trim().split(/\s+/),matches:any[]=[];let total=0;
 for(const row of index){const text=(row[0]+' '+row[1]).normalize('NFKC').toLowerCase();if(terms.every(term=>text.includes(term))){if(total>=offset&&matches.length<20)matches.push(row);total++;}}
 const needed=[...new Set(matches.map(row=>row[2]))],loaded=new Map<number,any[]>();
 for(let start=0;start<needed.length;start+=4){const batch=needed.slice(start,start+4),rows=await Promise.all(batch.map(number=>page(manifest,source,number)));for(let index=0;index<batch.length;index++)loaded.set(batch[index],rows[index]);}
 const items=matches.map(row=>loaded.get(row[2])![row[3]]);
 return {snapshot:manifest.snapshot,key:manifest.key,metadata:manifest.metadata,items,total,offset,hasMore:offset+items.length<total};
}
