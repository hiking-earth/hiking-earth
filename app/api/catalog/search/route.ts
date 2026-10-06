import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
const api=process.env.HIKING_CLIENT_API_URL||'https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,source=params.get('source'),query=params.get('q')?.trim()||'',offset=Number(params.get('offset')||0),snapshot=params.get('snapshot');
 if(!['osm','usfs','hk'].includes(source||'')||query.length<2||query.length>100||!Number.isInteger(offset)||offset<0||offset>250000||snapshot!==null&&!/^[a-f0-9]{64}$/.test(snapshot))return NextResponse.json({error:'invalid_search_request'},{status:400});
 try{
  const response=await fetch(api,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catalog-feed',data:{action:'search',source,query,offset,...(snapshot?{snapshot}:{})}}),signal:AbortSignal.timeout(50000)});
  const result=await response.json() as {ok?:boolean;data?:{items?:unknown[]}};if(!response.ok||result?.ok!==true||!Array.isArray(result.data?.items))throw new Error('search unavailable');
  return NextResponse.json(result.data,{headers:{'cache-control':'public, max-age=60'}});
 }catch{return NextResponse.json({error:'catalog_search_unavailable'},{status:503});}
}
