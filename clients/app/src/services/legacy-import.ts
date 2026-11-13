import {callCloud} from './cloud';import {accountSession} from './account';
export type LegacyNote={id:string;routeId:string;title:string;body:string;checkedIn:boolean};
export function parseLegacyNotes(text:string):LegacyNote[]{
 if(text.length>5*1024*1024)throw new Error('导入文件最多5 MB');const data=JSON.parse(text);
 if(!data||data.product!=='徒步地球'||!Array.isArray(data.diaries)||data.diaries.length>500||!Array.isArray(data.comments)||data.comments.length>500)throw new Error('请选择管理台导出的徒步地球本机资料');
 const rows:LegacyNote[]=[];const add=(item:any,kind:string)=>{if(!item||typeof item.id!=='string'||!item.id||item.id.length>100||typeof item.routeId!=='string'||item.routeId.length>128||typeof item.text!=='string'||!item.text.trim()||item.text.length>4700)throw new Error('旧内容格式无效或过长，尚未上传');rows.push({id:`legacy-${kind}-${item.id}`,routeId:item.routeId,title:String(item.title||'旧路线留言').slice(0,100),body:`从本机资料迁移；原记录时间：${String(item.createdAt||'未提供').slice(0,100)}\n\n${item.text}`,checkedIn:kind==='diary'&&item.checkedIn===true});};
 data.diaries.forEach((item:any)=>add(item,'diary'));data.comments.forEach((item:any)=>add(item,'comment'));if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('旧资料包含重复记录ID，请检查备份，尚未上传');return rows;
}
export async function importLegacyNotes(rows:LegacyNote[],progress:(done:number,total:number)=>void):Promise<void>{
 const owner=accountSession()?.openid;if(!owner)throw new Error('请先登录统一账号');const current=()=>{if(accountSession()?.openid!==owner)throw new Error('账号已变化，迁移停止；已完成记录保留。');};
 const existing=new Set<string>();for(let page=0;page<1000;page++){current();const result=await callCloud<{items:{clientId:string}[];hasMore:boolean}>('social-manage',{action:'diaries.list',page});current();if(!result.ok||!result.data)throw new Error(result.errMsg||'读取已迁移记录失败');if(!Array.isArray(result.data.items)||result.data.items.length>20||typeof result.data.hasMore!=='boolean'||!result.data.items.every(item=>item&&typeof item.clientId==='string'))throw new Error('已迁移记录响应无效，停止迁移');result.data.items.forEach(item=>existing.add(item.clientId));if(!result.data.hasMore)break;if(page===999)throw new Error('记录超过安全读取范围，请分批迁移');}
 let done=0;for(const row of rows){current();if(!existing.has(row.id)){const result=await callCloud('social-manage',{action:'diaries.save',id:row.id,routeId:row.routeId,title:row.title,body:row.body,checkedIn:row.checkedIn,visibility:'private',version:0});current();if(!result.ok)throw new Error(result.errMsg||'上传失败；重新导入会跳过已完成记录');existing.add(row.id);}progress(++done,rows.length);}
}
