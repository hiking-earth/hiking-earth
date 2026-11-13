// Real photo inference via the authenticated HTTP gateway. Never prints credentials.
import crypto from 'node:crypto';
import fs from 'node:fs';
const fixture=process.argv[2];
if(!fixture)throw new Error('Provide the public coffee JPEG fixture path');
const image=fs.readFileSync(fixture);
if(image.length>4*1024*1024)throw new Error('Fixture exceeds image limit');
const api='https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const checks=[];
let account,password,failure='',inference;
async function request(action,data={},token){
 const response=await fetch(api,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(60000)});
 return {status:response.status,body:await response.json()};
}
function check(name,ok){checks.push({name,passed:!!ok});if(!ok)throw new Error(name+' failed');}
try{
 const denied=await request('gear-scan',{image:image.toString('base64')});
 check('Unauthenticated photo inference denied',denied.status===401&&!denied.body.ok);
 password=crypto.randomBytes(24).toString('hex');
 const registered=await request('auth.register',{username:'gear-accept-'+crypto.randomBytes(8).toString('hex'),password,nickname:'识别隔离验收账号'});
 check('Isolated account registered',registered.body.ok&&typeof registered.body.data?.token==='string');
 account=registered.body.data;
 const started=Date.now();
 const result=await request('gear-scan',{image:image.toString('base64'),routeName:'公开杯子照片验收'},account.token);
 inference={status:result.status,ok:result.body.ok,code:result.body.code,errMsg:result.body.errMsg,itemCount:result.body.data?.items?.length};
 check('Authenticated real photo inference returns cup candidate',result.status===200&&result.body.ok&&result.body.data?.items?.some(item=>item.category==='饮食'&&item.name.startsWith('杯子')));
 checks.push({name:'Gateway inference elapsed time',passed:true,durationMs:Date.now()-started});
}catch(error){failure=error.message;}finally{
 if(account){try{
  let complete=false;
  for(let i=0;i<10&&!complete;i++){
   const deletion=await request('auth.delete',{password},account.token);
   if(!deletion.body.ok)break;
   complete=deletion.body.data?.complete===true;
  }
  checks.push({name:'Isolated account removed',passed:complete});
 }catch{checks.push({name:'Isolated account removed',passed:false});}}
 const report={checkedAt:new Date().toISOString(),scope:'CloudBase authenticated HTTP gateway with public coffee JPEG; excludes device UI, phone verification and class accuracy',fixtureSha256:crypto.createHash('sha256').update(image).digest('hex'),passed:!failure&&checks.every(row=>row.passed),failure,inference,checks};
 fs.writeFileSync('docs/release/deployed-gear-acceptance-2026-10-07.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
}
