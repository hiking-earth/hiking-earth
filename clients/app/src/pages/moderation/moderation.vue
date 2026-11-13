<template><scroll-view scroll-y class="page">
  <text class="title">社区举报处理</text><text class="hint">仅授权管理员可处理举报。</text><button :disabled="busy" @click="load">刷新待处理举报</button>
  <text class="hint">{{ message }}</text>
  <view v-for="post in pendingPosts" :key="post.id" class="card">
    <text class="title">待审核：{{ post.title }}</text><text class="hint">{{ post.nickname }}</text><text class="content">{{ post.content }}</text>
    <button :disabled="busy" @click="review(post.id, 'approve', post.version)">审核通过</button><button :disabled="busy" @click="review(post.id, 'reject', post.version)">不予发布</button>
  </view>
  <view v-for="report in reports" :key="report.id" class="card">
    <text class="title">{{ report.post?.title || '帖子已不存在' }}</text><text class="hint">{{ report.post?.nickname }} · {{ new Date(report.createdAt).toLocaleString() }}</text>
    <text class="content">{{ report.post?.content }}</text><text class="reason">举报理由：{{ report.reason }}</text>
    <button :disabled="busy" @click="handle(report.id, 'hide')">隐藏帖子</button><button :disabled="busy" @click="handle(report.id, 'dismiss')">无需处理 / 关闭举报</button>
  </view>
  <button v-if="hasMore" :disabled="busy" @click="loadMore">加载更多待审核内容</button>
</scroll-view></template>
<script setup lang="ts">
import {ref} from 'vue';
import {onShow,onHide,onUnload} from '@dcloudio/uni-app';
import {accountSession,onAccountChange} from '@/services/account';
import {callCloud} from '@/services/cloud';
type Report={id:string;postId:string;reason:string;createdAt:number;post:{title:string;content:string;nickname:string;status:string}|null};
type PendingPost={id:string;title:string;content:string;nickname:string;createdAt:number;version:number};
type Cursor={reports:string|null;posts:string|null};
const pendingPosts=ref<PendingPost[]>([]),reports=ref<Report[]>([]),message=ref(''),busy=ref(false),hasMore=ref(false);
let cursor:Cursor={reports:null,posts:null};
let visible=false,generation=0;
function reset(){generation++;busy.value=false;pendingPosts.value=[];reports.value=[];message.value='';hasMore.value=false;cursor={reports:null,posts:null};}
const unsubscribe=onAccountChange(()=>{reset();if(visible)void load();});
onShow(()=>{visible=true;void load();});onHide(()=>{visible=false;reset();});onUnload(()=>{visible=false;reset();unsubscribe();});
function context(){return {generation,token:accountSession()?.token};}
function current(ctx:ReturnType<typeof context>){return visible&&ctx.generation===generation&&ctx.token===accountSession()?.token;}
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;
async function load(){
 if(busy.value)return;const ctx=context();busy.value=true;message.value='';pendingPosts.value=[];reports.value=[];hasMore.value=false;cursor={reports:null,posts:null};
 try{const result=await callCloud<{reports:Report[];posts:PendingPost[];nextCursor:Cursor;hasMore:{reports:boolean;posts:boolean}}>('community-moderate',{action:'list',cursor});if(!current(ctx))return;
  if(!result.ok||!result.data)throw new Error(result.errMsg||'加载失败');
  const data=result.data;
  if(!Array.isArray(data.posts)||data.posts.length>20||!Array.isArray(data.reports)||data.reports.length>20
    ||!data.nextCursor||data.nextCursor.posts!==(data.posts.length?data.posts[data.posts.length-1].id:null)||data.nextCursor.reports!==(data.reports.length?data.reports[data.reports.length-1].id:null)
    ||!data.hasMore||typeof data.hasMore.posts!=='boolean'||typeof data.hasMore.reports!=='boolean'
    ||data.hasMore.posts&&data.posts.length!==20||data.hasMore.reports&&data.reports.length!==20
    ||data.posts.some(p=>!p||!text(p.id,128)||!p.id||!text(p.title,200)||!text(p.content,5000)||!text(p.nickname,100)||!Number.isFinite(p.createdAt)||p.createdAt<=0||!Number.isInteger(p.version)||p.version<0)
    ||data.reports.some(r=>!r||!text(r.id,128)||!r.id||!text(r.postId,128)||!r.postId||!text(r.reason,3000)||!Number.isFinite(r.createdAt)||r.createdAt<=0||r.createdAt>Date.now()+30000||r.post!==null&&(!r.post||!text(r.post.title,200)||!text(r.post.content,5000)||!text(r.post.nickname,100)||!text(r.post.status,100)))
    ||new Set(data.posts.map(p=>p.id)).size!==data.posts.length||new Set(data.reports.map(r=>r.id)).size!==data.reports.length)throw new Error('审核资料格式无效');
  pendingPosts.value=data.posts;reports.value=data.reports;cursor=data.nextCursor;hasMore.value=data.hasMore.posts||data.hasMore.reports;message.value=data.posts.length||data.reports.length?'':'暂无待处理内容';
 }catch(e){if(current(ctx)){pendingPosts.value=[];reports.value=[];message.value=e instanceof Error?e.message:'加载失败';}}finally{if(current(ctx))busy.value=false;}
}
async function loadMore(){
 if(busy.value||!hasMore.value)return;const ctx=context(),before=cursor;busy.value=true;message.value='';
 try{const result=await callCloud<{reports:Report[];posts:PendingPost[];nextCursor:Cursor;hasMore:{reports:boolean;posts:boolean}}>('community-moderate',{action:'list',cursor:before});if(!current(ctx))return;
  if(!result.ok||!result.data)throw new Error(result.errMsg||'加载失败');const data=result.data;
  if(!Array.isArray(data.posts)||data.posts.length>20||!Array.isArray(data.reports)||data.reports.length>20
    ||!data.nextCursor||data.nextCursor.posts!==(data.posts.length?data.posts[data.posts.length-1].id:before.posts)||data.nextCursor.reports!==(data.reports.length?data.reports[data.reports.length-1].id:before.reports)
    ||!data.hasMore||typeof data.hasMore.posts!=='boolean'||typeof data.hasMore.reports!=='boolean'
    ||data.hasMore.posts&&data.posts.length!==20||data.hasMore.reports&&data.reports.length!==20
    ||data.posts.some(p=>!p||!text(p.id,128)||!p.id||!text(p.title,200)||!text(p.content,5000)||!text(p.nickname,100)||!Number.isFinite(p.createdAt)||p.createdAt<=0||!Number.isInteger(p.version)||p.version<0)
    ||data.reports.some(r=>!r||!text(r.id,128)||!r.id||!text(r.postId,128)||!r.postId||!text(r.reason,3000)||!Number.isFinite(r.createdAt)||r.createdAt<=0||r.createdAt>Date.now()+30000||r.post!==null&&(!r.post||!text(r.post.title,200)||!text(r.post.content,5000)||!text(r.post.nickname,100)||!text(r.post.status,100))))throw new Error('审核资料格式无效');
  const merge=<T extends {id:string}>(currentRows:T[],incoming:T[])=>{const seen=new Set(currentRows.map(row=>row.id));return [...currentRows,...incoming.filter(row=>!seen.has(row.id))];};
  pendingPosts.value=merge(pendingPosts.value,data.posts);reports.value=merge(reports.value,data.reports);cursor=data.nextCursor;hasMore.value=data.hasMore.posts||data.hasMore.reports;
  if(!data.posts.length&&!data.reports.length&&!hasMore.value)message.value='已显示全部待处理内容';
 }catch(e){if(current(ctx))message.value=e instanceof Error?e.message:'加载失败';}finally{if(current(ctx))busy.value=false;}
}
async function mutate(id:string,action:string,version?:number){
 if(busy.value)return;const ctx=context();busy.value=true;let completed=false;
 try{const answer=await uni.showModal({title:action==='approve'?'审核通过':action==='reject'?'不予发布':action==='hide'?'隐藏帖子':'关闭举报',content:'确认提交处理结果？'});if(!answer.confirm||!current(ctx))return;
  const postAction=action==='approve'||action==='reject';
  if(postAction?!pendingPosts.value.some(p=>p.id===id&&p.version===version):!reports.value.some(r=>r.id===id))throw new Error('待处理资料已变化，请刷新');
  const result=await callCloud<{handled:boolean}>('community-moderate',postAction?{postId:id,action,version}:{reportId:id,action});if(!current(ctx))return;
  if(!result.ok||result.data?.handled!==true)throw new Error(result.errMsg||'处理未确认，请刷新核对');
  completed=true;message.value='云端已确认处理';
 }catch(e){if(current(ctx))message.value=e instanceof Error?e.message:'处理失败';}finally{if(current(ctx))busy.value=false;}
 if(completed&&current(ctx))await load();
}
function review(id:string,action:string,version:number){void mutate(id,action,version);}
function handle(id:string,action:string){void mutate(id,action);}
</script>
<style scoped>.page{height:100vh;background:var(--he-color-background);color:var(--he-color-text);padding:24px;box-sizing:border-box}.title{display:block;font-size:20px}.hint{display:block;color:var(--he-color-muted);font-size:13px;margin:12px 0}.card{padding:16px;margin:16px 0;background:var(--he-color-panel);border-radius: var(--he-card-radius, 16px);}.content,.reason{display:block;margin:12px 0;font-size:14px}.reason{color:var(--he-color-warning)}button{margin-top:12px;font-size:14px;background:var(--he-color-accent);color:var(--he-color-on-accent)}</style>
