<template>
 <scroll-view scroll-y class="page">
  <view class="tabs"><button v-for="mode in modes" :key="mode.key" :class="{selected:tab===mode.key}" :disabled="busy" @click="selectTab(mode.key)">{{ mode.name }}</button></view>
  <text v-if="error" class="error">{{ error }}</text>
  <button class="he-primary" @click="openAccount">账号与登录</button>
  <button :disabled="loading||busy" @click="refresh">{{loading?'正在刷新…':'刷新当前内容'}}</button>
  <view v-if="tab==='diaries'" class="row diary-feed"><button :class="{selected:!publicFeed}" :disabled="loading||busy" @click="setDiaryFeed(false)">我的日记</button><button :class="{selected:publicFeed}" :disabled="loading||busy" @click="setDiaryFeed(true)">公开日记</button></view>
  <view v-if="tab==='diaries'&&!publicFeed||tab==='comments'" class="card">
   <text class="title">{{ tab==='diaries'?'云端日记与手动打卡':'路线留言' }}</text>
   <text>路线：{{ routeName || '请选择路线' }}</text><input :disabled="busy" v-model="keyword" placeholder="搜索路线" />
   <view v-if="keyword" class="choices"><button v-for="route in matching" :key="route.id" :disabled="busy" @click="chooseRoute(route.id)">{{ route.name }} · {{ route.region }}</button></view>
   <input :disabled="busy" v-if="tab==='diaries'" v-model="title" maxlength="100" placeholder="日记标题" />
   <text v-if="tab==='comments'||isPublic" class="feed-note">公开日记和路线留言最多2500字；文本安全检查通过后仍需管理员审核。</text>
   <textarea :disabled="busy" v-model="body" :maxlength="(tab==='comments'||isPublic)?2500:5000" placeholder="写下内容；公开内容需审核后展示" />
   <view v-if="tab==='diaries'"><view class="row"><text>公开日记（默认仅自己）</text><switch :color="HE_PALETTE.accent" :disabled="busy" :checked="isPublic" @change="isPublic=eventValue($event)" /></view><view class="row"><text>手动标记已到访</text><switch :color="HE_PALETTE.accent" :disabled="busy" :checked="checkedIn" @change="checkedIn=eventValue($event)" /></view></view>
   <button class="he-primary" :disabled="busy||!routeId||!body.trim()" @click="save">{{ editing?'保存修改':'提交' }}</button>
   <button :disabled="busy" v-if="editing" @click="cancelEdit()">取消编辑</button>
  </view>
  <view v-if="tab==='messages'" class="card"><text class="title">队内消息</text><text>已通过检查的消息仅当前有效队伍成员可见。已关联微信身份的消息先经过平台文本安全检查；未关联微信身份的消息会进入管理员待审，管理员可查看待审内容，通过后才对队友开放。微信检查失败时消息不会发送，请稍后重试。后台暂停轮询，返回后继续。</text><textarea :disabled="busy" v-model="body" maxlength="1000" placeholder="给队友发送消息" /><button class="he-primary" :disabled="busy||!body.trim()" @click="send">发送</button></view>
  <view v-if="tab==='diaries'&&!publicFeed" class="card"><text>当前已加载的本人日记中，已到访 {{ footprintCount }} 条路线（手动标记）</text></view>
  <button :disabled="loading" @click="refresh">{{ loading?'加载中…':'刷新云端内容' }}</button>
  <text class="feed-note">前台第一页自动检查更新：队聊和通知每10秒，其他内容每30秒；后台暂停。加载后续页时可手动刷新回到最新内容。</text>
  <text v-if="tab==='diaries'&&publicFeed" class="feed-note">这里只展示作者主动公开且审核通过的日记。</text>
  <view v-for="item in items" :key="item._id" class="card">
   <text class="title">{{ item.title || item.nickname || '徒步记录' }}</text><text v-if="item.body">{{ item.body }}</text>
   <text v-if="item.status">{{ statuses[item.status] || item.status }} · 版本 {{ item.version }}</text>
   <text v-if="item.machineReviewStatus">平台文本检查：{{ item.machineReviewStatus==='pass'?'通过（仍待人工审核）':item.machineReviewStatus==='review'?'建议人工复核':'未执行（无已验证微信身份）' }}</text>
   <text>{{ new Date(item.updatedAt || item.createdAt).toLocaleString() }}</text>
   <view v-if="tab==='diaries'&&item.mine" class="row"><button v-if="!publicFeed" :disabled="busy" @click="edit(item)">编辑</button><button :disabled="busy" @click="remove(item)">删除</button></view>
   <view v-if="tab==='notifications'" class="row"><button v-if="['companion-registration','companion-cancellation','companion-closed'].includes(item.type)&&item.postId" :disabled="busy" @click="openCompanion">查看约伴活动</button><button v-if="!item.read" :disabled="busy" @click="read(item)">标为已读</button></view>
   <view v-if="tab==='moderation'" class="row"><button :disabled="busy" @click="decide(item,'approve')">通过</button><button :disabled="busy" @click="decide(item,'reject')">拒绝</button></view>
  </view>
  <text v-if="!items.length&&!loading">当前没有云端记录</text><button v-if="hasMore" :disabled="loading" @click="more">加载下一页</button>
 </scroll-view>
</template>
<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
function eventValue(event: Event): any { return (event as Event & {detail:{value:unknown}}).detail.value; }
import {computed,ref} from 'vue';
import {onLoad,onShow,onHide,onUnload} from '@dcloudio/uni-app';
import {callCloud} from '@/services/cloud';
import {accountSession,onAccountChange} from '@/services/account';
import {ROUTES} from '@/services/route-catalog';
const modes=[{key:'diaries',name:'日记'},{key:'comments',name:'留言'},{key:'messages',name:'队聊'},{key:'notifications',name:'通知'},{key:'moderation',name:'审核'}];
const statuses:Record<string,string>={private:'仅自己',pending:'待审核',approved:'已通过',rejected:'未通过'};
const tab=ref('diaries'),publicFeed=ref(false),routeId=ref(''),keyword=ref(''),title=ref(''),body=ref(''),isPublic=ref(false),checkedIn=ref(false),editing=ref<any>(null);
const items=ref<any[]>([]),error=ref(''),busy=ref(false),loading=ref(false),hasMore=ref(false),moderationCursor=ref({documents:0,messages:0});let newId=`note-${Date.now()}-${Math.random().toString(36).slice(2)}`,messageId=`msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;let page=0,sequence=0,context=0,mutationSequence=0,visible=false,timer:ReturnType<typeof setInterval>|undefined;
const matching=computed(()=>ROUTES.filter(r=>`${r.name} ${r.region}`.toLowerCase().includes(keyword.value.toLowerCase())).slice(0,10));
const footprintCount=computed(()=>new Set(items.value.filter(item=>item.mine&&item.checkedIn).map(item=>item.routeId)).size);
function openAccount(){uni.navigateTo({url:'/pages/account/account'});}
function openCompanion(){uni.navigateTo({url:'/pages/companion/companion'});}
const routeName=computed(()=>ROUTES.find(r=>r.id===routeId.value)?.name);
function teamId(){try{const raw=uni.getStorageSync('he_team');const team=typeof raw==='string'?JSON.parse(raw):raw;return team?.teamId||team?.id||'';}catch{return '';}}
// Cloud social data is scoped to a verified unified account. A legacy WeChat
// OpenID may remain in local storage, but must not make this page look signed in.
const identity=()=>accountSession()?.openid || '';
function chooseRoute(id:string){if(busy.value)return;context++;routeId.value=id;keyword.value='';if(tab.value==='comments')void refresh();}
function cancelEdit(force=false){if(busy.value&&!force)return;editing.value=null;title.value='';body.value='';isPublic.value=false;checkedIn.value=false;newId=`note-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function resetModerationCursor(){moderationCursor.value={documents:0,messages:0};}
function selectTab(value:string){if(busy.value)return;context++;sequence++;page=0;resetModerationCursor();items.value=[];hasMore.value=false;tab.value=value;cancelEdit();void refresh();startPolling();}
function setDiaryFeed(value:boolean){if(publicFeed.value===value)return;publicFeed.value=value;context++;sequence++;page=0;resetModerationCursor();items.value=[];hasMore.value=false;cancelEdit();void refresh();}
function startPolling(){visible=true;if(timer)clearInterval(timer);timer=undefined;if(!accountSession())return;const interval=['messages','notifications'].includes(tab.value)?10000:30000;timer=setInterval(()=>{const firstModerationPage=tab.value!=='moderation'||(moderationCursor.value.documents===0&&moderationCursor.value.messages===0);if(visible&&!loading.value&&!busy.value&&page===0&&firstModerationPage)void load();},interval);}
async function load(append=false){
 const token=++sequence,owner=identity(),sessionToken=accountSession()?.token,mode=tab.value;if(!owner){loading.value=false;hasMore.value=false;error.value='请先登录';items.value=[];return;}
 if(mode==='comments'&&!routeId.value){loading.value=false;hasMore.value=false;items.value=[];error.value='选择路线后查看留言';return;}
 const action=mode==='moderation'?'moderation.list':`${mode}.list`;loading.value=true;error.value='';
 try{const request={action,page,routeId:routeId.value,teamId:teamId(),public:mode==='diaries'&&publicFeed.value,...(mode==='moderation'?{cursor:moderationCursor.value}:{})};const result=await callCloud<{items:any[];hasMore:boolean;nextCursor?:{documents:number;messages:number}}>('social-manage',request);
  if(token!==sequence||owner!==identity()||sessionToken!==accountSession()?.token)return;
  if(!result.ok||!result.data)throw new Error(result.errMsg||'加载失败');const rows=result.data.items,nextCursor=result.data.nextCursor;if(!Array.isArray(rows)||rows.length>(mode==='messages'?30:20)||typeof result.data.hasMore!=='boolean'||mode==='moderation'&&(!nextCursor||!Number.isInteger(nextCursor.documents)||nextCursor.documents<0||nextCursor.documents>20000||!Number.isInteger(nextCursor.messages)||nextCursor.messages<0||nextCursor.messages>20000)||!rows.every(item=>item&&typeof item._id==='string'&&item._id.length>0)||new Set(rows.map(item=>item._id)).size!==rows.length)throw new Error('云端内容格式无效');
  if(mode==='messages'){
   const ordered=[...rows].reverse();
   if(append){const existing=new Set(items.value.map(item=>item._id));items.value=[...ordered.filter(item=>!existing.has(item._id)),...items.value];}
   else items.value=ordered;
  }else items.value=append?[...items.value,...rows.filter(item=>!items.value.some(old=>old._id===item._id))]:rows;
  if(mode==='moderation')moderationCursor.value=nextCursor!;hasMore.value=result.data.hasMore;
 }catch(e:any){if(token===sequence){error.value=e.message;if(append)page=Math.max(0,page-1);}}finally{if(token===sequence)loading.value=false;}
}
function refresh(){page=0;resetModerationCursor();return load();}function more(){if(loading.value)return;if(tab.value!=='moderation')page++;void load(true);}
function validReceipt(data:Record<string,unknown>,result:any){
 if(!result||typeof result!=='object')return false;
 switch(data.action){
  case 'notifications.read':return result.updated===true;
  case 'documents.remove':return result.deleted===true;
  case 'messages.send':return result.sent===true;
  case 'moderation.decide':return result.reviewed===true;
  case 'diaries.save':case 'comments.create':return typeof result.id==='string'&&!!result.id&&result.version===Number(data.version)+1&&['pending','private'].includes(result.status);
  default:return false;
 }
}
async function mutate(data:Record<string,unknown>){
 if(busy.value)return false;const owner=identity(),sessionToken=accountSession()?.token,originalContext=context,operation=++mutationSequence;
 if(!owner){error.value='请先登录';return false;}
 const current=()=>owner===identity()&&sessionToken===accountSession()?.token&&originalContext===context&&operation===mutationSequence;
 busy.value=true;error.value='';
 try{const result=await callCloud('social-manage',data);if(!current())return false;
  if(!result.ok||!validReceipt(data,result.data))throw new Error(result.errMsg||'云端未确认操作，请刷新核对');return true;
 }catch(e){if(current())error.value=e instanceof Error?e.message:'操作失败';return false;}finally{if(operation===mutationSequence)busy.value=false;}
}

async function save(){
 const owner=identity(),sessionToken=accountSession()?.token,originalContext=context,mode=tab.value;
 if(await mutate({action:mode==='diaries'?'diaries.save':'comments.create',id:editing.value?.clientId||newId,version:editing.value?.version||0,routeId:routeId.value,title:title.value,body:body.value,visibility:isPublic.value?'public':'private',checkedIn:checkedIn.value})){
  cancelEdit();await refresh();
  if(owner===identity()&&sessionToken===accountSession()?.token&&originalContext===context)
   uni.showToast({title:mode==='comments'?'已提交审核':'已保存云端日记',icon:'none'});
 }
}
function edit(item:any){if(busy.value)return;context++;editing.value=item;title.value=item.title;body.value=item.body;routeId.value=item.routeId;isPublic.value=item.visibility==='public';checkedIn.value=item.checkedIn;}
async function remove(item:any){const owner=identity(),originalContext=context;const result=await uni.showModal({title:'删除云端日记',content:'删除后其他设备也不再看到此记录，是否继续？'});if(result.confirm&&owner===identity()&&originalContext===context&&await mutate({action:'documents.remove',id:item._id}))await refresh();}
async function send(){if(await mutate({action:'messages.send',teamId:teamId(),id:messageId,body:body.value})){body.value='';messageId=`msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;await refresh();}}
async function read(item:any){if(await mutate({action:'notifications.read',id:item._id}))await refresh();}
async function decide(item:any,decision:string){if(await mutate({action:'moderation.decide',id:item._id,version:item.version,decision,reviewKind:item.reviewKind||'document'}))await refresh();}
function stop(){visible=false;context++;mutationSequence++;busy.value=false;if(timer)clearInterval(timer);timer=undefined;sequence++;loading.value=false;}
const unsubscribe=onAccountChange(()=>{
 const wasVisible=visible;
 stop();items.value=[];hasMore.value=false;page=0;resetModerationCursor();cancelEdit(true);
 routeId.value='';keyword.value='';publicFeed.value=false;
 messageId=`msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 error.value=accountSession()?'账号已变化，正在刷新内容':'请先登录';
 if(wasVisible){void refresh();startPolling();}
});
onLoad(query=>{if(query?.routeId)routeId.value=query.routeId;if(query?.tab&&modes.some(m=>m.key===query.tab))tab.value=query.tab;});
onShow(()=>{void refresh();startPolling();});onHide(stop);onUnload(()=>{stop();unsubscribe();});
</script>
<style scoped>.page{background:var(--he-color-background);min-height:100vh;padding:12px;box-sizing:border-box;color:var(--he-color-text)}.tabs,.row{display:flex;gap:5px;flex-wrap:wrap}.tabs button{font-size:12px;padding:0 8px}.selected{background:var(--he-color-accent);color:var(--he-color-on-accent)}.diary-feed{margin-top:10px}.feed-note{display:block;color:var(--he-color-muted);margin:6px 0}.card{display:flex;flex-direction:column;gap:8px;background:var(--he-color-surface);border-radius:var(--he-card-radius, 16px);padding:12px;margin:10px 0}.title{font-size:16px;font-weight:700}.error{color:var(--he-color-warning)}input,textarea{background:var(--he-color-background);border-radius:var(--he-input-radius, 13px);padding:9px;width:100%;box-sizing:border-box}textarea{height:100px}button{margin:0;color:var(--he-color-text);border-radius:var(--he-control-radius, 12px)}button.selected{color:var(--he-color-on-accent)}.choices{display:flex;flex-direction:column;gap:4px}</style>
