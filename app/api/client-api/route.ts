import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
const API='https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const LIMIT=6*1024*1024;
function reply(body:unknown,status:number){return NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});}
export async function POST(request:Request){
 const token=request.headers.get('authorization');
 if(token&&!/^Bearer [a-f0-9]{64}$/.test(token))return reply({ok:false,errMsg:'登录凭据格式无效'},400);
 try{
  const reader=request.body?.getReader();if(!reader)return reply({ok:false,errMsg:'请求体为空'},400);
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>LIMIT){await reader.cancel();return reply({ok:false,errMsg:'请求体超过6 MB'},413);}chunks.push(value);}
  const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  let value;try{value=JSON.parse(new TextDecoder().decode(joined));}catch{return reply({ok:false,errMsg:'请求格式无效'},400);}
  if(!value||typeof value!=='object'||!/^[a-z][a-z0-9.-]{1,64}$/.test(value.action||'')||!value.data||typeof value.data!=='object'||Array.isArray(value.data))return reply({ok:false,errMsg:'请求格式无效'},400);
  const response=await fetch(API,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',...(token?{Authorization:token}:{})},body:JSON.stringify({action:value.action,data:value.data}),signal:AbortSignal.timeout(60000)});
  // Never forward credentials to redirects or cache authenticated results.
  if(response.status>=300&&response.status<400)return reply({ok:false,errMsg:'云服务地址异常'},502);
  const body=await response.json();if(!body||typeof body!=='object'||typeof body.ok!=='boolean')return reply({ok:false,errMsg:'云服务响应格式异常'},502);
  return reply(body,response.status);
 }catch{return reply({ok:false,errMsg:'云服务请求未完成，请确认操作结果后重试'},503);}
}
