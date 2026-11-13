<template>
  <view class="page">
    <scroll-view scroll-y class="list">
      <view v-for="p in posts" :key="p.id" class="card" @longpress="reportPost(p)">
        <view class="card-head">
          <text class="nick">{{ p.nickname }}</text>
          <text class="date">{{ p.departDate }} 出发</text>
        </view>
        <text class="title">{{ p.title }}{{ p.status === 'pending' ? ' · 待审核' : p.status === 'closed' ? ' · 已关闭' : '' }}</text>
        <text class="content">{{ p.content }}</text>
        <view class="card-foot">
          <text class="members">{{ (p.memberCount ?? p.members.length) }}/{{ p.maxMembers }} 人</text>
          <text v-if="routeName(p.routeId)" class="route">{{ routeName(p.routeId) }}</text>
          <view
            class="join" :class="{ full: (p.memberCount ?? p.members.length) >= p.maxMembers || joined(p) }"
            @click="join(p)"
          >{{ p.status === 'pending' ? '待审核' : p.status === 'closed' ? '已关闭' : joined(p) ? '已报名' : (p.memberCount ?? p.members.length) >= p.maxMembers ? '已满员' : '报名' }}</view>
        </view>
        <button v-if="myOpenid && p.openid === myOpenid" size="mini" @click="managePost(p)">管理活动</button>
        <button v-if="myOpenid && p.openid === myOpenid" size="mini" @click="contacts(p)">查看报名联系信息</button>
        <button v-else-if="joined(p)" size="mini" @click="cancelJoin(p)">取消报名</button>
      </view>
      <view v-if="posts.length === 0" class="empty">{{ loadError || "还没有约伴帖，来发第一条" }}</view>
      <view class="notice">社区内容发布前需要审核；请勿发布他人位置等敏感信息。发现违规可长按帖子举报。</view>
    </scroll-view>

    <view v-if="joiningPost" class="mask" @click="cancelRegistration()"><view class="form" @click.stop><text class="form-title">活动报名</text><text>{{joiningPost.title}}</text><input :disabled="submitting" v-model="birth" class="input" placeholder="出生日期 YYYY-MM-DD（不保存完整生日）" /><input :disabled="submitting" v-model="emergency" maxlength="200" class="input" placeholder="紧急联系人姓名与电话" /><view><switch :color="HE_PALETTE.accent" :disabled="submitting" :checked="guardian" @change="guardian=eventValue($event)" /><text>未成年人由监护人填写并确认</text></view><view><switch :color="HE_PALETTE.accent" :disabled="submitting" :checked="contactConsent" @change="contactConsent=eventValue($event)" /><text>同意将紧急联系信息提供给发起人；取消报名即删除，未取消时在出发日期后30天删除</text></view><button :disabled="submitting" @click="submitRegistration">确认报名</button><button @click="cancelRegistration()">取消</button></view></view>
    <view class="fab" @click="newPost">＋ 发约伴</view>

    <!-- 发帖弹窗 -->
    <view v-if="showForm" class="mask" @click="cancelForm()">
      <view class="form" @click.stop>
        <text class="form-title">{{ editingId ? '编辑约伴' : '发约伴' }}</text>
        <input :disabled="submitting" v-model="form.title" class="input" placeholder="标题（如：武功山两日轻装）" placeholder-class="ph" />
        <textarea :disabled="submitting" v-model="form.content" class="textarea" placeholder="时间、集合点、强度要求…" placeholder-class="ph" />
        <input :disabled="submitting" v-model="form.departDate" class="input" placeholder="出发日期 YYYY-MM-DD" placeholder-class="ph" />
        <view v-if="!editingId"><input :disabled="submitting" v-model="birth" class="input" placeholder="出生日期 YYYY-MM-DD（用于成年人判断，不保存完整生日）" /><input :disabled="submitting" v-model="emergency" maxlength="200" class="input" placeholder="紧急联系人姓名与电话" /><switch :color="HE_PALETTE.accent" :disabled="submitting" :checked="contactConsent" @change="contactConsent=eventValue($event)" /><text>同意保存本人紧急联系信息，仅本人及发起人可访问；出发日期后30天删除</text></view>
        <input :disabled="submitting" v-model.number="form.maxMembers" type="number" class="input" placeholder="人数上限" placeholder-class="ph" />
        <RouteSearchPicker v-model="form.routeId" :disabled="submitting" placeholder="搜索或选择关联路线（可选）" />
        <view class="form-actions">
          <button class="btn ghost" @click="cancelForm()">取消</button>
          <button class="btn primary he-primary" :disabled="submitting" @click="submit">{{ editingId ? '保存' : '发布' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
function eventValue(event: Event): any { return (event as Event & {detail:{value:unknown}}).detail.value; }
import { ref } from "vue";
import { onShow, onHide, onUnload } from "@dcloudio/uni-app";
import { ROUTES } from "@/services/route-catalog";
import RouteSearchPicker from '@/components/RouteSearchPicker.vue';
import type { CompanionPost } from "@shared/types/social";
import { callCloud } from "@/services/cloud";
import { accountSession, onAccountChange } from "@/services/account";
let context = 0, loadSequence = 0;
function identity(){return `${uni.getStorageSync("he_openid")||""}:${accountSession()?.token||""}`;}
function snapshot(){return {owner:identity(),epoch:context};}
function current(value:ReturnType<typeof snapshot>){return value.owner===identity()&&value.epoch===context;}

const birth=ref(''),emergency=ref(''),contactConsent=ref(false),guardian=ref(false),joiningPost=ref<CompanionPost|null>(null);
let creationId=`post-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function clearSensitive(){birth.value='';emergency.value='';contactConsent.value=false;guardian.value=false;}
function cancelRegistration(force=false){if(submitting.value&&!force)return;joiningPost.value=null;clearSensitive();}
const posts = ref<CompanionPost[]>([]);
const showForm = ref(false);
const editingId = ref('');
const submitting = ref(false);
const myOpenid = ref("");
const loadError = ref("");
const form = ref({ title: "", content: "", departDate: "", maxMembers: 4, routeId: "" });

function cancelForm(force=false){if(submitting.value&&!force)return;showForm.value=false;clearSensitive();}
function invalidate(){context++;loadSequence++;cancelRegistration(true);cancelForm(true);}
const unsubscribeAccount=onAccountChange(()=>{invalidate();posts.value=[];myOpenid.value="";loadError.value="账号已变化，请刷新活动";});
onHide(invalidate);
onUnload(()=>{invalidate();unsubscribeAccount();});
onShow(load);

function validPosts(value:unknown):value is CompanionPost[]{
  if(!Array.isArray(value)||value.length>50)return false;
  const ids=new Set<string>();
  return value.every(p=>{
    if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id))return false;
    ids.add(p.id);
    return typeof p.openid==='string'&&(!p.openid||p.openid===myOpenid.value)
      &&typeof p.nickname==='string'&&p.nickname.length<=40&&typeof p.title==='string'&&p.title.length<=60
      &&typeof p.content==='string'&&p.content.length<=1000&&typeof p.departDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(p.departDate)
      &&(p.routeId===undefined||typeof p.routeId==='string')&&Number.isInteger(p.maxMembers)&&p.maxMembers>=2&&p.maxMembers<=50
      &&Array.isArray(p.members)&&p.members.length<=1&&p.members.every((id:unknown)=>typeof id==='string'&&!!id&&id===myOpenid.value)
      &&Number.isInteger(p.memberCount)&&p.memberCount>=p.members.length&&p.memberCount<=p.maxMembers
      &&Number.isFinite(p.createdAt)&&p.createdAt>0&&['open','full','closed','pending'].includes(p.status)
      &&(p.status!=='pending'||(!!myOpenid.value&&p.openid===myOpenid.value));
  });
}

async function load() {
  const original=snapshot(), sequence=++loadSequence;
  const login = await callCloud<{ openid: string }>("login");
  if(!current(original)||sequence!==loadSequence)return;
  myOpenid.value = login.ok ? login.data?.openid ?? "" : "";
  const res = await callCloud<{ posts: CompanionPost[] }>("companion-list");
  if(!current(original)||sequence!==loadSequence)return;
  if (res.ok && res.data && validPosts(res.data.posts)) { posts.value = res.data.posts; loadError.value = ""; }
  else { posts.value = []; loadError.value = res.errMsg ?? "加载失败"; }
}

function routeName(id?: string): string {
  return ROUTES.find((r) => r.id === id)?.name ?? "";
}

function joined(p: CompanionPost): boolean {
  return p.members.includes(myOpenid.value);
}

function join(p:CompanionPost){if(submitting.value)return;if(!['open','full'].includes(p.status)||joined(p)||(p.memberCount??p.members.length)>=p.maxMembers)return;clearSensitive();joiningPost.value=p;}
async function mutate(name:string,data:Record<string,unknown>){
  if(submitting.value)return;
  const original=snapshot();submitting.value=true;
  try{const result=await callCloud(name,data);return current(original)?result:undefined;}
  catch{if(current(original))uni.showToast({title:'请求失败，请重试',icon:'none'});}
  finally{submitting.value=false;}
}
async function submitRegistration(){
  if(!joiningPost.value||submitting.value)return;
  const original=snapshot();
  const res=await mutate('companion-join',{postId:joiningPost.value.id,birth:birth.value,emergency:emergency.value,guardianConfirmed:guardian.value,contactConsent:contactConsent.value,nickname:uni.getStorageSync('he_nickname')||'山友'});
  if(!res)return;
  if(!res.ok){uni.showToast({title:res.errMsg||'报名失败',icon:'none'});return;}
  cancelRegistration();await load();if(current(original))uni.showToast({title:'已报名',icon:'success'});
}
async function contacts(p:CompanionPost){
  if(submitting.value||!myOpenid.value||p.openid!==myOpenid.value)return;
  const original=snapshot();
  const res=await mutate('companion-manage',{action:'registrations',postId:p.id});
  if(!res||!current(original))return;
  const rows=res.data?.items;
  if(!res.ok||!Array.isArray(rows)||rows.length>50||!rows.every((row:any)=>row&&typeof row.emergency==='string'&&row.emergency.length<=200&&(row.nickname===undefined||(typeof row.nickname==='string'&&row.nickname.length<=40))&&typeof row.adult==='boolean'&&typeof row.guardianConfirmed==='boolean')){
    uni.showToast({title:res.errMsg||'联系资料格式无效，未显示',icon:'none'});return;
  }
  uni.showModal({title:'报名联系信息（仅发起人）',content:rows.map((row:any,i:number)=>`${i+1}. ${row.nickname||'山友'}：${row.emergency}；${row.adult?'成年人':row.guardianConfirmed?'未成年 / 监护人已确认':'未成年 / 监护人未确认'}`).join('\n')||'当前没有报名联系信息',showCancel:false});
}

function newPost() {
  if(submitting.value)return;
  clearSensitive();creationId=`post-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  editingId.value = ''; form.value = { title: '', content: '', departDate: '', maxMembers: 4, routeId: '' }; showForm.value = true;
}
async function cancelJoin(post: CompanionPost) {
  const original=snapshot();
  uni.showModal({ title: '取消报名', content: '确认退出该活动？', success: async result => {
    if (result.confirm && current(original)) await changePost(post, 'leave');
  } });
}
function managePost(post: CompanionPost) {
  const original=snapshot();
  const labels = ['编辑活动', post.status === 'closed' ? '重新开放报名' : '关闭报名', '删除活动'];
  uni.showActionSheet({ itemList: labels, success: choice => {
    if(!current(original)||submitting.value)return;
    if (choice.tapIndex === 0) {
      editingId.value = post.id; form.value = { title: post.title, content: post.content, departDate: post.departDate, maxMembers: post.maxMembers, routeId: post.routeId || '' }; showForm.value = true; return;
    }
    const action = choice.tapIndex === 2 ? 'delete' : post.status === 'closed' ? 'reopen' : 'close';
    uni.showModal({ title: labels[choice.tapIndex], content: action === 'delete' ? '删除后活动内容不再展示。此操作无法恢复。' : '确认更新报名状态？', success: async result => {
      if (result.confirm && current(original)) await changePost(post, action);
    } });
  } });
}
async function changePost(post: CompanionPost, action: string) {
  if(submitting.value)return;
  const original=snapshot();
  const result = await mutate('companion-manage', { postId: post.id, action });
  if(!result||!current(original))return;
  if (result.ok) await load();
  if(!current(original))return;
  uni.showToast({ title: result.ok ? '已更新' : result.errMsg || '操作失败', icon: 'none' });
}
function reportPost(p: CompanionPost) {
  const original=snapshot();
  uni.showActionSheet({ itemList: ["垃圾广告", "人身攻击或违法内容", "泄露个人信息", "其他违规内容"], success: async (r) => {
    if(!current(original))return;
    const reasons = ["垃圾广告", "人身攻击或违法内容", "泄露个人信息", "其他违规内容"];
    const result = await mutate("companion-report", { postId: p.id, reason: reasons[r.tapIndex] });
    if(!result||!current(original))return;
    const duplicate=result.ok&&result.data?.duplicate===true;
    uni.showToast({ title: duplicate ? "该内容已举报过，原处理记录已保留" : result.ok ? "举报已提交，等待处理" : result.errMsg ?? "举报失败", icon: "none" });
  } });
}

async function submit() {
  if(submitting.value)return;
  const original=snapshot();
  if (!form.value.title.trim() || !form.value.content.trim()) {
    uni.showToast({ title: "请填写标题和内容", icon: "none" });
    return;
  }
  // 内容安全机审（云函数内 security.msgSecCheck）
  const res = await mutate(editingId.value ? 'companion-manage' : 'companion-create', {
    ...(editingId.value ? { postId: editingId.value, action: 'edit' } : {}),
    ...form.value,
    id:creationId,birth:birth.value,emergency:emergency.value,contactConsent:contactConsent.value,
    nickname: uni.getStorageSync('he_nickname') || '山友',
  });
  if(!res||!current(original))return;
  if (res.ok) {
    showForm.value = false;clearSensitive();
    form.value = { title: "", content: "", departDate: "", maxMembers: 4, routeId: "" };
    uni.showToast({ title: res.data?.reviewPending || res.data?.status === 'pending' ? '已提交，等待审核' : '已发布', icon: 'success' });
    load();
  } else {
    uni.showToast({ title: res.errMsg ?? "发布失败", icon: "none" });
  }
}
</script>

<style lang="scss" scoped>
.page { height: 100vh; background: var(--he-color-background); }
.list { height: 100%; padding: 12px 16px; box-sizing: border-box; }
.card { background: var(--he-color-panel); border-radius: var(--he-card-radius, 16px); padding: 14px 12px; margin-bottom: 10px; }
.card-head { display: flex; justify-content: space-between; }
.nick { font-size: 12px; color: var(--he-color-accent); }
.date { font-size: 11px; color: var(--he-color-muted); }
.title { display: block; margin-top: 6px; font-size: 16px; font-weight: 600; color: var(--he-color-text); }
.content { display: block; margin-top: 4px; font-size: 13px; color: var(--he-color-muted); line-height: 1.6; }
.card-foot { display: flex; align-items: center; margin-top: 8px; gap: 8px; }
.members { font-size: 11px; color: var(--he-color-muted); }
.route { flex: 1; font-size: 11px; color: var(--he-color-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.join { padding: 4px 16px; background: var(--he-color-accent); color: var(--he-color-on-accent); font-size: 12px; font-weight: 600; border-radius: var(--he-control-radius, 12px); }
.join.full { background: var(--he-color-surface); color: var(--he-color-muted); }
.empty { text-align: center; color: var(--he-color-muted); padding: 40px 0; font-size: 13px; }
.notice { margin: 12px 0 80px; font-size: 10px; color: var(--he-color-muted); line-height: 1.7; }
.fab { position: fixed; right: 16px; bottom: calc(24px + env(safe-area-inset-bottom)); padding: 10px 18px; background: var(--he-color-accent); color: var(--he-color-on-accent); font-size: 14px; font-weight: 600; border-radius: var(--he-control-radius, 12px); box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
.mask { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; }
.form { width: 100%; background: var(--he-color-panel); border-radius: var(--he-card-radius, 16px) var(--he-card-radius, 16px) 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
.form-title { display: block; font-size: 16px; font-weight: 600; color: var(--he-color-text); margin-bottom: 12px; }
.input { background: var(--he-color-surface); border-radius: var(--he-input-radius, 13px); padding: 10px 12px; font-size: 14px; color: var(--he-color-text); margin-bottom: 8px; }
.textarea { background: var(--he-color-surface); border-radius: var(--he-input-radius, 13px); padding: 10px 12px; font-size: 14px; color: var(--he-color-text); margin-bottom: 8px; height: 80px; width: auto; }
.picker { color: var(--he-color-muted); }
.ph { color: var(--he-color-muted); }
.form-actions { display: flex; gap: 12px; margin-top: 4px; }
.btn { flex: 1; border-radius: 499.5px; font-size: 14px; }
.btn.ghost { background: var(--he-color-surface); color: var(--he-color-muted); }
.btn.primary { background: var(--he-color-accent); color: var(--he-color-on-accent); font-weight: 600; }
/* #ifdef H5 */
.fab{bottom:calc(74px + env(safe-area-inset-bottom))}.mask{z-index:1000}
/* #endif */
</style>
