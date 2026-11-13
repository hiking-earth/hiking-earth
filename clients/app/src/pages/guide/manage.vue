<template><scroll-view scroll-y class="page">
<text class="title">导购资料管理</text><text>仅已授权管理员可维护。未发布草稿不会公开；发布前必须确认真实使用授权并记录依据。</text><text>{{error}}</text>
<view class="card"><text>淘宝官方 API 搜索候选</text><text class="hint">仅使用官方淘宝联盟接口。新结果默认未发布且未确认授权；请人工核实商品、链接、使用范围和有效期后再决定是否发布。</text><input v-model="taobaoKeyword" :disabled="busy" maxlength="80" placeholder="搜索装备关键词，例如：徒步登山杖"/><picker :range="categories" :disabled="busy" @change="taobaoCategory=categories[Number($event.detail.value)]"><text>候选分类：{{taobaoCategory}}</text></picker><button :disabled="busy||!taobaoKeyword.trim()" @click="searchTaobao">{{busy?'正在处理':'搜索淘宝联盟候选'}}</button><text v-if="taobaoStatus" class="hint">{{taobaoStatus}}</text></view>
<view class="card"><text>京东联盟官方 API 搜索候选</text><text class="hint">需要京东联盟商品查询与推广链接权限，以及网站/媒体 ID 和推广位。每次最多生成3条推广候选并进入未发布队列；你作为唯一管理员负责核对商品、推广权利、链接和有效期，再决定是否发布。</text><input v-model="jdKeyword" :disabled="busy" maxlength="80" placeholder="搜索装备关键词，例如：登山杖"/><picker :range="categories" :disabled="busy" @change="jdCategory=categories[Number($event.detail.value)]"><text>候选分类：{{jdCategory}}</text></picker><button :disabled="busy||!jdKeyword.trim()" @click="searchJd">{{busy?'正在处理':'搜索京东联盟候选'}}</button><text v-if="jdStatus" class="hint">{{jdStatus}}</text></view>
<view class="card source-pending"><text>拼多多 / 多多进宝 · 尚未接通</text><text class="hint">已查到官方历史资料中的商品查询、goods_sign 与推广转链流程，但当前接口参数及本应用授权权限仍待确认，因此暂不发送请求或生成平台候选。你可以先用“新建条目”录入已获授权的商品，保存为未发布；确认来源、推广权利和有效期后，由你人工决定是否发布。</text></view>
<view class="card source-pending"><text>闲鱼 · 尚未接通通用商品搜索</text><text class="hint">已核实的闲鱼小程序接入文档要求定向邀请和企业主体；该文档不证明具备通用联盟商品搜索权限。没有对应合作资格前不抓取、不调用非公开接口。若你有获授权的合作商品，可通过“新建条目”人工登记并核验后发布。</text></view>
<button :disabled="busy" @click="load(false)">刷新条目</button><button :disabled="busy" @click="create">新建条目</button>
<view v-for="row in rows" :key="row._id" class="card"><text>{{row.title}} · {{row.legacyCategory?'需核对分类':''}} · {{row.candidateStatus==='expired'?(row.expiredPublished?'已过期并自动撤下':'候选已过期，需重新核验'):row.published&&expired(row.expiresAt)?'已过期（公众端自动隐藏）':row.published?'已发布':row.rightsConfirmed?'未发布（已确认授权）':'待核验授权'}} · {{platformName(row.sourcePlatform)}} · 版本{{row.version||0}}</text><text v-if="row.expiresAt" class="hint">有效至 {{formatExpiry(row.expiresAt)}}</text><button :disabled="busy" @click="edit(row)">编辑</button><button v-if="row.published" :disabled="busy" @click="unpublish(row)">撤下</button></view>
<button v-if="hasMore" :disabled="busy" @click="load(true)">加载更多</button>
<view v-if="form" class="card"><input v-model="form.id" :disabled="busy||existing" placeholder="条目ID（字母、数字、下划线或短横线）"/><input v-model="form.title" :disabled="busy" maxlength="200" placeholder="标题"/>
<picker :range="categories" :disabled="busy" @change="form.category=categories[Number($event.detail.value)]"><text>分类：{{form.category}}</text></picker>
<textarea v-model="form.summary" :disabled="busy" maxlength="2000" placeholder="商品说明"/><input v-model="form.link" :disabled="busy" maxlength="2048" placeholder="HTTPS 商品链接"/><picker :range="platformLabels" :value="platformIndex" :disabled="busy" @change="form.sourcePlatform=sourcePlatforms[Number($event.detail.value)].id"><text>来源平台：{{platformName(form.sourcePlatform)}}</text></picker><picker mode="date" :value="expiryDate" :disabled="busy" @change="setExpiry($event.detail.value)"><text>有效期：{{expiryDate||'未设置'}}</text></picker><text class="hint">公开商品必须设置90天内到期日；到期后公开列表自动隐藏，管理员刷新时会自动撤下。</text><button v-if="form.expiresAt" :disabled="busy" @click="form.expiresAt=null;expiryDate=''">清除有效期</button><input v-model="form.priceHint" :disabled="busy" maxlength="100" placeholder="价格说明（可留空，需有依据）"/>
<input v-model="form.sourceUrl" :disabled="busy" maxlength="2048" placeholder="HTTPS 归属来源"/><textarea v-model="form.rightsNote" :disabled="busy" maxlength="1000" placeholder="链接使用权及来源说明"/>
<text>已确认真实使用授权 <switch :color="HE_PALETTE.accent" :checked="form.rightsConfirmed" :disabled="busy" @change="setSwitch('rightsConfirmed', $event)"/></text>
<text>公开发布 <switch :color="HE_PALETTE.accent" :checked="form.published" :disabled="busy" @change="setSwitch('published', $event)"/></text>
<button :disabled="busy" @click="save">保存{{form.published?'并发布':'为未发布'}}</button><button :disabled="busy" @click="form=null">取消编辑</button></view>
</scroll-view></template>
<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
import {computed,ref} from 'vue';
import {onShow,onHide,onUnload} from '@dcloudio/uni-app';
import {accountSession,onAccountChange} from '@/services/account';
import {callCloud} from '@/services/cloud';
type Form={id:string;title:string;summary:string;category:string;link:string;priceHint:string;sourceUrl:string;sourcePlatform:string;expiresAt:number|null;rightsNote:string;rightsConfirmed:boolean;published:boolean;version:number};
type Row=Omit<Form,'id'>&{_id:string;legacyCategory:boolean;candidateStatus?:string;expiredPublished?:boolean};
const categories=['鞋靴','背包','服装','露营','导航','应急','其他'];
const sourcePlatforms=[{id:'unknown',name:'待标记'},{id:'taobao',name:'淘宝/淘宝联盟'},{id:'jd',name:'京东/京东联盟'},{id:'pdd',name:'拼多多/多多进宝'},{id:'xianyu',name:'闲鱼合作方'},{id:'other',name:'其他授权来源'}];
const taobaoKeyword=ref(''),taobaoCategory=ref('其他'),taobaoStatus=ref('');
const jdKeyword=ref(''),jdCategory=ref('其他'),jdStatus=ref('');
const platformLabels=sourcePlatforms.map(item=>item.name),expiryDate=ref('');
const rows=ref<Row[]>([]),form=ref<Form|null>(null),busy=ref(false),error=ref(''),hasMore=ref(false),existing=ref(false);
const platformIndex=computed(()=>Math.max(0,sourcePlatforms.findIndex(item=>item.id===form.value?.sourcePlatform)));
let page=0,epoch=0,visible=false;
function invalidate(){epoch++;busy.value=false;rows.value=[];form.value=null;hasMore.value=false;page=0;taobaoStatus.value='';taobaoKeyword.value='';jdStatus.value='';jdKeyword.value='';}
const unsubscribe=onAccountChange(()=>{invalidate();if(visible)void load(false);});
onShow(()=>{visible=true;void load(false);});onHide(()=>{visible=false;invalidate();});onUnload(()=>{visible=false;invalidate();unsubscribe();});
function context(){const session=accountSession();return session?{epoch,token:session.token,owner:session.openid}:null;}
function current(ctx:NonNullable<ReturnType<typeof context>>){const session=accountSession();return visible&&epoch===ctx.epoch&&session?.token===ctx.token&&session.openid===ctx.owner;}
function valid(row:Row){return !!row&&typeof row._id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(row._id)&&typeof row.title==='string'&&row.title.length<=200&&typeof row.summary==='string'&&row.summary.length<=2000&&categories.includes(row.category)&&typeof row.link==='string'&&typeof row.priceHint==='string'&&typeof row.sourceUrl==='string'&&typeof row.sourcePlatform==='string'&&(row.expiresAt===null||Number.isSafeInteger(row.expiresAt))&&(row.expiredPublished===undefined||typeof row.expiredPublished==='boolean')&&typeof row.rightsNote==='string'&&typeof row.published==='boolean'&&typeof row.rightsConfirmed==='boolean'&&Number.isInteger(row.version)&&row.version>=0;}
async function load(more:boolean){
 if(busy.value)return;const ctx=context();if(!ctx){error.value='请先登录管理员账号';return;}
 busy.value=true;error.value='';const target=more?page+1:0;
 try{const res=await callCloud<{items:Row[];hasMore:boolean}>('social-manage',{action:'guides.list',page:target});if(!current(ctx))return;
  if(!res.ok||!res.data)throw new Error(res.errMsg||'加载失败');
  const data=res.data;if(!Array.isArray(data.items)||data.items.length>20||!data.items.every(valid)||typeof data.hasMore!=='boolean'||new Set(data.items.map(row=>row._id)).size!==data.items.length)throw new Error('管理资料格式无效');
  if(more&&data.items.some(row=>rows.value.some(old=>old._id===row._id)))throw new Error('列表已变化，请刷新');
  rows.value=more?[...rows.value,...data.items]:data.items;hasMore.value=data.hasMore;page=target;
 }catch(e){if(current(ctx))error.value=e instanceof Error?e.message:'加载失败';}finally{if(current(ctx))busy.value=false;}
}
function setSwitch(key:'rightsConfirmed'|'published',event:Event|{detail:{value:boolean}}){const value=(event as {detail?:{value?:boolean}}).detail?.value;if(form.value&&typeof value==='boolean')form.value[key]=value;}
function create(){if(busy.value)return;existing.value=false;expiryDate.value='';form.value={id:'',title:'',summary:'',category:'其他',link:'',priceHint:'',sourceUrl:'',sourcePlatform:'unknown',expiresAt:null,rightsNote:'',rightsConfirmed:false,published:false,version:0};}
function edit(row:Row){if(busy.value)return;existing.value=true;expiryDate.value=row.expiresAt?localDate(row.expiresAt):'';form.value={id:row._id,title:row.title,summary:row.summary,category:row.legacyCategory?'其他':row.category,link:row.link,priceHint:row.priceHint,sourceUrl:row.sourceUrl,sourcePlatform:sourcePlatforms.some(item=>item.id===row.sourcePlatform)?row.sourcePlatform:'unknown',expiresAt:row.expiresAt,rightsNote:row.rightsNote,rightsConfirmed:row.rightsConfirmed,published:row.published,version:row.version};}
function localDate(value:number){const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function setExpiry(value:string){expiryDate.value=value;if(!form.value)return;if(!value){form.value.expiresAt=null;return;}const [year,month,day]=value.split('-').map(Number);form.value.expiresAt=new Date(year,month-1,day+1).getTime()-1;}
function expired(value:number|null){return value!==null&&value<=Date.now();}
function formatExpiry(value:number){return new Date(value).toLocaleDateString();}
function platformName(value:string){return sourcePlatforms.find(item=>item.id===value)?.name||'待标记';}
async function searchTaobao(){
 if(busy.value)return;const ctx=context();if(!ctx){error.value='请先登录管理员账号';return;}
 const keyword=taobaoKeyword.value.trim();if(!keyword||keyword.length>80||!categories.includes(taobaoCategory.value)){error.value='请填写不超过80字的搜索词并选择分类';return;}
 busy.value=true;error.value='';taobaoStatus.value='';
 try{const res=await callCloud<{searched:number;created:number;skipped:number;rightsConfirmed:false;published:false}>('social-manage',{action:'guides.taobao.search',keyword,category:taobaoCategory.value});if(!current(ctx))return;
  if(!res.ok||!res.data||![res.data.searched,res.data.created,res.data.skipped].every(value=>Number.isInteger(value)&&value>=0)||res.data.created+res.data.skipped!==res.data.searched||res.data.rightsConfirmed!==false||res.data.published!==false)throw new Error(res.errMsg||'搜索候选未能安全保存');
  taobaoStatus.value=`官方接口返回 ${res.data.searched} 条；新增未发布候选 ${res.data.created} 条，重复跳过 ${res.data.skipped} 条。请人工核验后再发布。`;
  busy.value=false;
  await load(false);
 }catch(e){if(current(ctx))error.value=e instanceof Error?e.message:'淘宝联盟搜索失败';}finally{if(current(ctx))busy.value=false;}
}
async function searchJd(){
 if(busy.value)return;const ctx=context();if(!ctx){error.value='请先登录管理员账号';return;}
 const keyword=jdKeyword.value.trim();if(!keyword||keyword.length>80||!categories.includes(jdCategory.value)){error.value='请填写不超过80字的搜索词并选择分类';return;}
 busy.value=true;error.value='';jdStatus.value='';
 try{const res=await callCloud<{searched:number;created:number;skipped:number;rightsConfirmed:false;published:false}>('social-manage',{action:'guides.jd.search',keyword,category:jdCategory.value});if(!current(ctx))return;
  if(!res.ok||!res.data||![res.data.searched,res.data.created,res.data.skipped].every(value=>Number.isInteger(value)&&value>=0)||res.data.created+res.data.skipped!==res.data.searched||res.data.rightsConfirmed!==false||res.data.published!==false)throw new Error(res.errMsg||'京东候选未能安全保存');
  jdStatus.value=`已生成 ${res.data.searched} 条联盟推广候选；新增未发布候选 ${res.data.created} 条，重复跳过 ${res.data.skipped} 条。请人工核验后再发布。`;
  busy.value=false;await load(false);
 }catch(e){if(current(ctx))error.value=e instanceof Error?e.message:'京东联盟搜索失败';}finally{if(current(ctx))busy.value=false;}
}
async function unpublish(row:Row){
 if(busy.value)return;const ctx=context();if(!ctx)return;busy.value=true;error.value='';
 try{const answer=await uni.showModal({title:'撤下导购条目',content:`确认撤下“${row.title}”？`,confirmText:'撤下'});if(!current(ctx)||!answer.confirm)return;
  const res=await callCloud<{saved:boolean;id:string;version:number}>('social-manage',{action:'guides.unpublish',id:row._id,version:row.version});if(!current(ctx))return;
  if(!res.ok||res.data?.saved!==true||res.data.id!==row._id||res.data.version!==row.version+1)throw new Error(res.errMsg||'撤下未确认，请刷新核对');
  rows.value=rows.value.map(old=>old._id===row._id?{...old,published:false,version:row.version+1}:old);
  if(form.value?.id===row._id)form.value=null;
  uni.showToast({title:'已撤下',icon:'none'});
 }catch(e){if(current(ctx))error.value=e instanceof Error?e.message:'撤下失败';}finally{if(current(ctx))busy.value=false;}
}
async function save(){
 if(busy.value||!form.value)return;const ctx=context();if(!ctx){error.value='请先登录';return;}
 const draft=form.value;
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(draft.id)||!draft.title.trim()||draft.title.trim().length>200||draft.summary.length>2000||!categories.includes(draft.category)||!sourcePlatforms.some(item=>item.id===draft.sourcePlatform)||draft.expiresAt!==null&&!Number.isSafeInteger(draft.expiresAt)||draft.priceHint.length>100||!Number.isInteger(draft.version)||draft.version<0){error.value='请检查条目ID、标题、分类、来源、有效期、说明和版本';return;}
 if(draft.rightsConfirmed&&!draft.rightsNote.trim()){error.value='确认授权时必须填写授权依据';return;}
 if(draft.published&&!draft.rightsConfirmed){error.value='发布前必须确认真实使用授权并填写授权依据';return;}
 if(draft.published&&(!Number.isSafeInteger(draft.expiresAt)||draft.expiresAt!<=Date.now()||draft.expiresAt!>Date.now()+90*24*60*60*1000)){error.value='公开条目必须设置未来90天内的到期日';return;}
 const validHttps=(value:string)=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443');}catch{return false;}};
 if(draft.link.length>2048||draft.sourceUrl.length>2048||!validHttps(draft.link)||!validHttps(draft.sourceUrl)){error.value='商品链接和归属来源必须是有效的 HTTPS 地址，且不能含账号密码或非标准端口';return;}
 const snapshot={...draft,id:draft.id.trim(),title:draft.title.trim(),summary:draft.summary.trim(),priceHint:draft.priceHint.trim(),rightsNote:draft.rightsNote.trim()};
 busy.value=true;error.value='';
 try{const res=await callCloud<{saved:boolean;id:string;version:number}>('social-manage',{action:'guides.save',...snapshot});if(!current(ctx))return;
  if(!res.ok||res.data?.saved!==true||res.data.id!==snapshot.id||res.data.version!==snapshot.version+1)throw new Error(res.errMsg||'保存未确认，请刷新核对');
  form.value=null;uni.showToast({title:snapshot.published?'已发布':'已保存为未发布',icon:'none'});
 }catch(e){if(current(ctx))error.value=e instanceof Error?e.message:'保存失败';}finally{if(current(ctx))busy.value=false;}
 if(current(ctx)&&!form.value)await load(false);
}
</script>
<style scoped>.page{padding:14px;box-sizing:border-box;min-height:100vh;background:var(--he-color-background);color:var(--he-color-text)}.card{padding:12px;margin:10px 0;background:var(--he-color-surface);border-radius: var(--he-card-radius, 16px)}.source-pending{border:1px solid var(--he-color-border,rgba(127,140,138,.24));opacity:.94}.hint{color:var(--he-color-muted,#75827d)}text{display:block;margin:8px 0}.title{font-size:18px}input,textarea{padding:8px;margin:6px 0;background:var(--he-color-surface);width:100%;box-sizing:border-box}button{margin:6px 0}</style>
