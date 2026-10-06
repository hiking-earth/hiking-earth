import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
const api=process.env.HIKING_CLIENT_API_URL||'https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const sources=['osm','usfs','hk','news'] as const;
function validSource(value:string|null):value is typeof sources[number]{return sources.includes(value as any);}
export async function GET(request:Request){
 const url=new URL(request.url),source=url.searchParams.get('source'),page=Number(url.searchParams.get('page')||0),snapshot=url.searchParams.get('snapshot');
 if(!validSource(source)||!Number.isInteger(page)||page<0||page>99||(snapshot!==null&&!/^[a-f0-9]{64}$/.test(snapshot)))return NextResponse.json({error:'invalid_catalog_request'},{status:400});
 try{
  const response=await fetch(api,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catalog-feed',data:{source,page,windowLimit:40000,...(snapshot?{snapshot}:{})}}),signal:AbortSignal.timeout(15000)});
  const result=await response.json() as any;if(!response.ok||result?.ok!==true||!Array.isArray(result.data?.items))return NextResponse.json({error:'catalog_unavailable'},{status:503});
  return NextResponse.json(result.data,{headers:{'cache-control':'public, max-age=300, stale-while-revalidate=1800'}});
 }catch{return NextResponse.json({error:'catalog_unavailable'},{status:503});}
}
