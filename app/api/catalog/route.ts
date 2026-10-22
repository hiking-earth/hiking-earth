import {CATALOG_PAGE_SIZE,CATALOG_SOURCE_LIMIT} from '../../../data/catalog-limits';
import {CATALOG_FEED_SOURCES,isCatalogFeedSource} from '../../../data/catalog-sources';
import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
const api=process.env.HIKING_CLIENT_API_URL||'https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
type Source=typeof CATALOG_FEED_SOURCES[number];
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
const safeErrorCodes=new Set(['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','AbortError','TimeoutError','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET']);
function logCatalogFailure(source:Source,page:number,stage:string,upstreamStatus?:number,error?:unknown){
 const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&safeErrorCodes.has(error.code)?error.code:undefined;
 const name=error instanceof Error&&safeErrorCodes.has(error.name)?error.name:undefined;
 console.warn(JSON.stringify({event:'catalog_proxy_failure',source,page,stage,...(upstreamStatus===undefined?{}:{upstreamStatus}),...(code?{errorCode:code}:name?{errorCode:name}:{})}));
}
export async function GET(request:Request){
 const url=new URL(request.url),source=url.searchParams.get('source'),page=Number(url.searchParams.get('page')||0),snapshot=url.searchParams.get('snapshot');
 if(!isCatalogFeedSource(source)||!Number.isInteger(page)||page<0||page>=Math.ceil(CATALOG_SOURCE_LIMIT/CATALOG_PAGE_SIZE)||(snapshot!==null&&!/^[a-f0-9]{64}$/.test(snapshot)))return NextResponse.json({error:'invalid_catalog_request'},{status:400});
 let stage='upstream_fetch';
 try{
  const response=await fetch(api,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catalog-feed',data:{source,page,windowLimit:CATALOG_SOURCE_LIMIT,...(snapshot?{snapshot}:{})}}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){logCatalogFailure(source,page,'upstream_status',response.status);return NextResponse.json({error:'catalog_unavailable'},{status:503});}
  stage='upstream_json';
  const result:unknown=await response.json();
  if(!isRecord(result)||result.ok!==true||!isRecord(result.data)||!Array.isArray(result.data.items)){logCatalogFailure(source,page,'upstream_schema');return NextResponse.json({error:'catalog_unavailable'},{status:503});}
  return NextResponse.json(result.data,{headers:{'cache-control':'public, max-age=300, stale-while-revalidate=1800'}});
 }catch(error){logCatalogFailure(source,page,stage,undefined,error);return NextResponse.json({error:'catalog_unavailable'},{status:503});}
}
