// No storage, cookies, logging or arbitrary URLs. Only our production parent.
const parentOrigin='https://hiking-earth.nanyu20050927.chatgpt.site';
const api='https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
let active=0;
window.addEventListener('message',async event=>{
 if(event.source!==parent||event.origin!==parentOrigin)return;
 const input=event.data;
 if(!input||input.type!=='hiking-relay-request-v1'||!/^[a-f0-9]{32}$/.test(input.id||'')
  ||!/^[a-z][a-z0-9.-]{1,64}$/.test(input.action||'')||!input.data||typeof input.data!=='object'||Array.isArray(input.data)
  ||(input.token!==undefined&&!/^[a-f0-9]{64}$/.test(input.token)))return;
 const reply=value=>parent.postMessage({type:'hiking-relay-response-v1',id:input.id,...value},parentOrigin);
 let body;try{body=JSON.stringify({action:input.action,data:input.data});}catch{return;}
 if(new TextEncoder().encode(body).length>6*1024*1024||active>=8){reply({error:'request_limit'});return;}
 active++;
 try{
  const response=await fetch(api,{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',...(input.token?{Authorization:`Bearer ${input.token}`}:{})},body,signal:AbortSignal.timeout(60000)});
  const text=await response.text();if(text.length>12*1024*1024)throw new Error('response_limit');
  reply({status:response.status,body:JSON.parse(text)});
 }catch{reply({error:'network_unavailable'});}finally{active--;}
});
