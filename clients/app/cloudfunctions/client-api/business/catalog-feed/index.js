// Public records only: fixed upstream paths and bounded, hash-checked pages.
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const BASE='https://raw.githubusercontent.com/hiking-earth/clients/main/shared/';
const catalogs=new Set(['osm','usfs','hk','nzdoc','parkscanada','nsw-npws','england','wales','japan-tokai','scotland-argyll','ni-midulster','norfolk-prow','cambridgeshire-prow','nps-public-trails','usgs-trails','swisstopo-wanderwege','victoria-recreation-tracks','queensland-qpws-trails','taiwan-trails','korea-durunubi-trails','news']);
const directPaths={release:'releases/stable.json','offline-hk':'data/offline/hk-afcd.json'};
const PAGE_SIZE=400,MAX_RECORDS=250000,HEX=/^[a-f0-9]{64}$/;
const manifests=new Map(),pages=new Map(),indexes=new Map(),directCache=new Map(),pending=new Map();
const USGS_SERVICE='https://partnerships.nationalmap.gov/arcgis/rest/services/USGSTrails/MapServer';
const USGS_LAYER=USGS_SERVICE+'/0',USGS_QUERY=USGS_LAYER+'/query';
const USGS_BASE_WHERE="trailtype = 'Terra Trail' AND hikerpedestrian = 'Y' AND name IS NOT NULL AND name <> '' AND shape IS NOT NULL";
const usgsCache=new Map();
let usgsCacheBytes=0;
let pageBytes=0,indexBytes=0;
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const SAFE_ERROR_CODES=new Set(['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ENOENT','EACCES','AbortError','TimeoutError','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET']);
async function single(key,job){
 if(pending.has(key))return pending.get(key);
 const task=job();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
async function download(relative,budget){
 const response=await fetch(BASE+relative,{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Upstream unavailable');
 const length=Number(response.headers.get('content-length'));if(length>budget)throw new Error('Response exceeds size budget');
 let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>budget)throw new Error('Response exceeds size budget');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
function validateManifest(value,source,version){
 const key=source==='news'?'items':'routes';
 if(value?.schemaVersion!==1||value.key!==key||value.pageSize!==PAGE_SIZE||!HEX.test(value.snapshot)||version&&value.snapshot!==version||!Number.isInteger(value.total)||value.total<0||value.total>MAX_RECORDS||!Array.isArray(value.pages)||value.pages.length!==Math.max(1,Math.ceil(value.total/PAGE_SIZE))||!HEX.test(value.indexHash)||!value.pages.every(item=>typeof item==='string'&&HEX.test(item))||value.metadata?.schemaVersion!==1||!Number.isFinite(Date.parse(value.metadata?.generatedAt)))throw new Error('Manifest invalid');
 return value;
}
async function manifest(source,version){
 const cacheKey=source+':'+(version||'current'),cached=manifests.get(cacheKey);
 if(cached&&Date.now()-cached.checkedAt<3600000)return cached;
 return single('manifest:'+cacheKey,async()=>{
  const relative=source+'/'+(version?version+'/':'')+'manifest.json';
  let local;try{local=validateManifest(JSON.parse(fs.readFileSync(path.join(__dirname,'snapshots',relative),'utf8')),source,version);}catch{}
  let data=cached?.data||local,upstreamAvailable=false;
  try{
   const incoming=validateManifest(JSON.parse((await download('public-catalog/'+relative,1024*1024)).toString('utf8')),source,version);
   if(!data||version||Date.parse(incoming.metadata.generatedAt)>=Date.parse(data.metadata.generatedAt)){data=incoming;upstreamAvailable=true;}
  }catch{}
  if(!data)throw new Error('Catalog manifest unavailable');
  const result={data,upstreamAvailable,checkedAt:Date.now()};manifests.delete(cacheKey);manifests.set(cacheKey,result);
  // Keep manifest memory bounded even with arbitrary valid-looking versions.
  while(manifests.size>16)manifests.delete(manifests.keys().next().value);
  return result;
 });
}
async function pageRows(source,manifestResult,page){
 const data=manifestResult.data,cacheKey=source+':'+data.snapshot+':'+page;
 if(pages.has(cacheKey)){const cached=pages.get(cacheKey);pages.delete(cacheKey);pages.set(cacheKey,cached);return cached;}
 return single('page:'+cacheKey,async()=>{
  const relative=source+'/'+data.snapshot+'/page-'+String(page).padStart(5,'0')+'.json.gz';
  let compressed,upstreamAvailable=false;
  try{compressed=await download('public-catalog/'+relative,2*1024*1024);upstreamAvailable=true;}catch{compressed=fs.readFileSync(path.join(__dirname,'snapshots',relative));}
  const payload=zlib.gunzipSync(compressed,{maxOutputLength:4*1024*1024});
  if(hash(payload)!==data.pages[page])throw new Error('Catalog page integrity mismatch');
  const rows=JSON.parse(payload.toString('utf8'));
  const expected=Math.max(0,Math.min(PAGE_SIZE,data.total-page*PAGE_SIZE));
  if(!Array.isArray(rows)||rows.length!==expected)throw new Error('Catalog page length invalid');
  const result={rows,upstreamAvailable,bytes:payload.length};pages.set(cacheKey,result);pageBytes+=result.bytes;
  while(pages.size>32||pageBytes>16*1024*1024){const oldest=pages.keys().next().value;pageBytes-=pages.get(oldest).bytes;pages.delete(oldest);}
  return result;
 });
}
function normalize(value){return value.normalize('NFKC').toLowerCase().trim();}
async function searchRows(source,result,query,offset){
 const data=result.data,cacheKey=source+':'+data.snapshot;
 let index=indexes.get(cacheKey);
 if(!index)index=await single('index:'+cacheKey,async()=>{
  const relative=source+'/'+data.snapshot+'/index.json.gz';let compressed;
  try{compressed=await download('public-catalog/'+relative,8*1024*1024);}catch{compressed=fs.readFileSync(path.join(__dirname,'snapshots',relative));}
  const payload=zlib.gunzipSync(compressed,{maxOutputLength:32*1024*1024});
  if(hash(payload)!==data.indexHash)throw new Error('Search index integrity mismatch');
  const rows=JSON.parse(payload.toString('utf8'));
  if(!Array.isArray(rows)||rows.length!==data.total||!rows.every(row=>Array.isArray(row)&&row.length===4&&typeof row[0]==='string'&&typeof row[1]==='string'&&Number.isInteger(row[2])&&Number.isInteger(row[3])&&row[2]>=0&&row[2]<data.pages.length&&row[3]>=0&&row[3]<PAGE_SIZE))throw new Error('Search index invalid');
  const value={rows,bytes:payload.length};indexes.set(cacheKey,value);indexBytes+=value.bytes;
  while(indexes.size>3||indexBytes>16*1024*1024){const oldest=indexes.keys().next().value;indexBytes-=indexes.get(oldest).bytes;indexes.delete(oldest);}
  return value;
 });
 const terms=normalize(query).split(/\s+/);const matches=[];let total=0;
 for(const row of index.rows){const hay=normalize(row[0]+' '+row[1]);if(terms.every(term=>hay.includes(term))){if(total>=offset&&matches.length<20)matches.push(row);total++;}}
 const found=new Map(),needed=[...new Set(matches.map(row=>row[2]))];for(let start=0;start<needed.length;start+=4){const batch=needed.slice(start,start+4);const values=await Promise.all(batch.map(page=>pageRows(source,result,page)));for(let i=0;i<batch.length;i++)found.set(batch[i],values[i].rows);}
 return {snapshot:data.snapshot,key:data.key,metadata:data.metadata,items:matches.map(row=>found.get(row[2])[row[3]]),total,offset,hasMore:offset+matches.length<total};
}
async function directSnapshot(source){
 const cached=directCache.get(source);if(cached&&Date.now()-cached.checkedAt<3600000)return cached;
 return single('direct:'+source,async()=>{
  let data=cached?.data||JSON.parse(fs.readFileSync(path.join(__dirname,'snapshots',source+'.json'),'utf8')),upstreamAvailable=false;
  try{
   const incoming=JSON.parse((await download(directPaths[source],16*1024*1024)).toString('utf8'));
   if(source==='release'){if(incoming.schemaVersion!==1||typeof incoming.ready!=='boolean')throw new Error('Release format invalid');}
   else if(incoming.format!=='hiking-earth-offline-v1'||!Array.isArray(incoming.geometry?.features))throw new Error('Offline format invalid');
   data=incoming;upstreamAvailable=true;
  }catch{}
  const result={data,snapshot:hash(JSON.stringify(data)),checkedAt:Date.now(),upstreamAvailable};directCache.set(source,result);return result;
 });
}
function cacheValue(key){const item=usgsCache.get(key);if(!item)return undefined;if(item.expiresAt<=Date.now()){usgsCache.delete(key);usgsCacheBytes-=item.bytes;return undefined;}usgsCache.delete(key);usgsCache.set(key,item);return item.value;}
function cacheUsgs(key,value,ttl){
 const previous=usgsCache.get(key);if(previous)usgsCacheBytes-=previous.bytes;usgsCache.delete(key);
 const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>4*1024*1024)return value;
 const item={value,expiresAt:Date.now()+ttl,bytes};usgsCache.set(key,item);usgsCacheBytes+=bytes;
 while(usgsCache.size>64||usgsCacheBytes>8*1024*1024){const oldest=usgsCache.keys().next().value,removed=usgsCache.get(oldest);usgsCache.delete(oldest);usgsCacheBytes-=removed.bytes;}
 return value;
}
async function usgsJson(params,budget=8*1024*1024){
 const response=await fetch(USGS_QUERY,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,f:'json'}).toString(),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('USGS upstream unavailable');
 const length=Number(response.headers.get('content-length'));if(length>budget)throw new Error('USGS response exceeds size budget');
 const value=await boundedJson(response,budget);if(value?.error||value?.status==='error')throw new Error('USGS query failed');return value;
}
async function boundedJson(response,budget){
 const length=Number(response.headers.get('content-length'));if(length>budget)throw new Error('USGS response exceeds size budget');
 let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>budget)throw new Error('USGS response exceeds size budget');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function usgsServiceInfo(){
 const key='usgs-service-info',cached=cacheValue(key);if(cached)return cached;
 const response=await fetch(USGS_SERVICE+'?f=json',{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('USGS service metadata unavailable');
 const value=await boundedJson(response,256*1024),layer=value?.layers?.find(item=>item?.id===0);
 if(!layer||!String(value.capabilities||'').split(',').includes('Query')||!Number.isInteger(value.maxRecordCount)||value.maxRecordCount<20)throw new Error('USGS service metadata invalid');
 const version=typeof value.copyrightText==='string'&&/\bv\d{8}\.\d+\b/.test(value.copyrightText)?value.copyrightText.match(/\bv\d{8}\.\d+\b/)[0]:'service-'+String(value.currentVersion||'unknown');
 return cacheUsgs(key,{version},5*60*1000);
}
async function usgsCount(where,version){
 const key='usgs-count:'+hash(version+'\n'+where),cached=cacheValue(key);if(cached!==undefined)return cached;
 const result=await usgsJson({where,returnCountOnly:'true',returnGeometry:'false'} ,128*1024);
 if(!Number.isInteger(result.count)||result.count<0||result.count>150000)throw new Error('USGS result count outside supported limit');
 return cacheUsgs(key,result.count,5*60*1000);
}
function usgsSqlLiteral(value){return "'"+value.replace(/'/g,"''")+"'";}
function usgsSearchWhere(query){
 if(/[%_\u0000-\u001f\u007f]/.test(query))throw new Error('USGS search wildcard/control character rejected');
 const terms=query.normalize('NFKC').trim().toUpperCase().split(/\s+/);
 return USGS_BASE_WHERE+' AND '+terms.map(term=>{const literal=usgsSqlLiteral('%'+term+'%');return `(UPPER(name) LIKE ${literal} OR UPPER(namealternate) LIKE ${literal} OR UPPER(sourceoriginator) LIKE ${literal})`;}).join(' AND ');
}
function usgsText(value){if(value===null||value===undefined)return null;const text=String(value);return text.length<=300?text:text.slice(0,300);}
function usgsPath(path){
 if(!Array.isArray(path)||path.length<2)throw new Error('USGS line geometry invalid');
 const points=path.map(point=>{if(!Array.isArray(point)||point.length<2||!Number.isFinite(point[0])||!Number.isFinite(point[1])||Math.abs(point[0])>180||Math.abs(point[1])>90)throw new Error('USGS coordinate invalid');return [point[0],point[1]];});
 if(points.length<=151)return points;
 return Array.from({length:151},(_,index)=>points[Math.round(index*(points.length-1)/150)]);
}
function usgsRoute(feature,fetchedAt){
 const attributes=feature?.attributes,id=attributes?.objectid,paths=feature?.geometry?.paths;
 if(!Number.isSafeInteger(id)||id<=0||!Array.isArray(paths)||paths.length<1||paths.length>50)throw new Error('USGS route shape invalid');
 const referencePaths=paths.map(usgsPath),points=referencePaths.flat(),xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
 const sourceTags={sourceOriginator:usgsText(attributes.sourceoriginator),sourceObjectId:String(id),sourcePermanentIdentifier:usgsText(attributes.permanentidentifier),trailType:usgsText(attributes.trailtype),hikerPedestrian:usgsText(attributes.hikerpedestrian),nationalTrailDesignation:usgsText(attributes.nationaltraildesignation),lengthMiles:usgsText(attributes.lengthmiles),seasonOpen:usgsText(attributes.seasonopen),sourcePublishedAt:usgsText(attributes.publisheddate),sourceEditedAt:usgsText(attributes.sourceeditdate),routeType:usgsText(attributes.routetype)};
 if(sourceTags.trailType!=='Terra Trail'||sourceTags.hikerPedestrian!=='Y')throw new Error('USGS feature outside hiking filter');
 const name=String(attributes.name||attributes.namealternate||'').trim();if(!name||name.length>500)throw new Error('USGS route name invalid');
 return {id:`usgs-trail-${id}`,name,region:'美国·美国及属地',center:[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2],referencePaths,sourceUrl:USGS_LAYER,fetchedAt,status:'待核验',sourceTags};
}
async function usgsSearch(query,offset,snapshot){
 const where=usgsSearchWhere(query),service=await usgsServiceInfo(),baseCount=await usgsCount(USGS_BASE_WHERE,service.version),total=await usgsCount(where,service.version);
 if(baseCount<1||offset>baseCount||total>baseCount)throw new Error('USGS catalog counts invalid');
 const snapshotId=hash(['usgs-trails',service.version,baseCount,total,where].join('\n'));
 if(snapshot!==undefined&&snapshot!==snapshotId)return {errMsg:'USGS目录已更新或搜索页已过期，请重新搜索'};
 const cacheKey=`usgs-page:${snapshotId}:${offset}`,cached=cacheValue(cacheKey);if(cached)return cached;
 const result=await usgsJson({where,outFields:'objectid,permanentidentifier,name,namealternate,sourceoriginator,trailtype,hikerpedestrian,nationaltraildesignation,lengthmiles,seasonopen,publisheddate,sourceeditdate,routetype',returnGeometry:'true',outSR:'4326',maxAllowableOffset:'0.0001',orderByFields:'objectid ASC',resultOffset:String(offset),resultRecordCount:'20'});
 if(result.exceededTransferLimit===true||!Array.isArray(result.features))throw new Error('USGS feature page invalid');
 const expected=Math.max(0,Math.min(20,total-offset));if(result.features.length!==expected)throw new Error('USGS page count changed');
 const fetchedAt=new Date().toISOString(),items=result.features.map(feature=>usgsRoute(feature,fetchedAt));
 const metadata={schemaVersion:1,license:'USGS public-domain aggregate; source originator retained',attribution:'U.S. Geological Survey National Digital Trails. USGS public-domain aggregate; the original source originator is retained for each record.',licenseUrl:'https://www.usgs.gov/national-digital-trails/how-access-or-view-usgs-trails-dataset',sourceUrl:USGS_LAYER,routeStatusPolicy:'This is an on-demand search of the USGS National Digital Trails layer, filtered to Terra Trail records marked for hiking. Source records may be stale or incomplete. Pagination tokens bind the published service version and result counts, but do not freeze an immutable upstream snapshot. All results remain 待核验; verify local access, closures, permission, and field conditions with the original source before travel. Simplified reference lines are not navigation tracks.',generatedAt:fetchedAt,sourceFeatureCount:baseCount,catalogRouteCount:baseCount,withheldRecords:0,withheldReasons:{}};
 return cacheUsgs(cacheKey,{snapshot:snapshotId,checkedAt:Date.now(),upstreamAvailable:true,metadata,key:'routes',items,total,offset,hasMore:offset+items.length<total},60*1000);
}
exports.main=async event=>{
 let stage='manifest';
 if(!event||!catalogs.has(event.source)&&!Object.hasOwn(directPaths,event.source))return {errMsg:'资料源无效'};
 try{
  if(Object.hasOwn(directPaths,event.source)){stage='direct';return await directSnapshot(event.source);}
  if(event.action==='search'){
   if(event.source==='news'||typeof event.query!=='string'||event.query.trim().length<2||event.query.length>100||!Number.isInteger(event.offset??0)||(event.offset??0)<0||(event.offset??0)>MAX_RECORDS)return {errMsg:'搜索词需2至100个字符，分页位置须有效'};
   if(event.snapshot!==undefined&&(typeof event.snapshot!=='string'||!HEX.test(event.snapshot)))return {errMsg:'资料版本无效'};
   if(event.source==='usgs-trails'){stage='usgs-live-search';return await usgsSearch(event.query.trim(),event.offset??0,event.snapshot);}
   const result=await manifest(event.source,event.snapshot);stage='search-index';
   return await searchRows(event.source,result,event.query,event.offset??0);
  }
  const page=event.page===undefined?0:event.page;
  if(!Number.isInteger(page)||page<0||page>=MAX_RECORDS/PAGE_SIZE)return {errMsg:'资料页码无效'};
  if(event.snapshot!==undefined&&(typeof event.snapshot!=='string'||!HEX.test(event.snapshot)))return {errMsg:'资料版本无效'};
  let result=await manifest(event.source,event.snapshot),data=result.data;
  const limit=event.windowLimit===undefined?MAX_RECORDS:event.windowLimit;
  if(!Number.isInteger(limit)||limit<400||limit>MAX_RECORDS||limit%PAGE_SIZE!==0)return {errMsg:'目录窗口无效'};
  const total=Math.min(data.total,limit);
  if(page>=Math.max(1,Math.ceil(total/PAGE_SIZE)))return {errMsg:'资料页不存在'};
  stage='page';let content;
  try{content=await pageRows(event.source,result,page);}catch(error){
   // Only the first unpinned request may select a bundled version. Later
   // requests must retain their exact snapshot and cannot mix page versions.
   if(event.snapshot!==undefined||page!==0||error?.code!=='ENOENT')throw error;
   const bundled=validateManifest(JSON.parse(fs.readFileSync(path.join(__dirname,'snapshots',event.source,'manifest.json'),'utf8')),event.source);
   if(bundled.snapshot===data.snapshot)throw error;
   result={data:bundled,upstreamAvailable:false,checkedAt:Date.now()};data=bundled;
   content=await pageRows(event.source,result,0);
  }
  const responseTotal=Math.min(data.total,limit);
  return {snapshot:data.snapshot,checkedAt:result.checkedAt,upstreamAvailable:result.upstreamAvailable&&content.upstreamAvailable,metadata:{...data.metadata,sourceTotal:data.total,loadedTotal:responseTotal,complete:responseTotal===data.total},key:data.key,items:content.rows,total:responseTotal,page,hasMore:(page+1)*PAGE_SIZE<responseTotal};
 }catch(error){
  const diagnostic={event:'catalog-read-failed',source:event.source,stage};
  if(SAFE_ERROR_CODES.has(error?.code))diagnostic.errorCode=error.code;
  else if(SAFE_ERROR_CODES.has(error?.name))diagnostic.errorCode=error.name;
  console.warn(JSON.stringify(diagnostic));
  return {errMsg:'资料暂时不可用，请保留上次成功同步的数据并稍后重试'};
 }
};
