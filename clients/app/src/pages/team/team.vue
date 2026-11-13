<template>
  <view class="page">
    <!-- 未入队 -->
    <view v-if="!team" class="entry">
      <text class="entry-title">组队会合</text>
      <text class="entry-sub">队友实时位置互见 · 双向距离 · 箭头导航会合</text>
      <button class="btn primary he-primary" @click="createTeam">创建队伍</button>
      <view class="join-row">
        <input v-model="inviteCode" class="input" placeholder="输入 6 位邀请码" placeholder-class="ph" maxlength="6" />
        <button class="btn ghost" @click="joinTeam">加入</button>
      </view>
      <text class="privacy">位置共享属敏感个人信息，仅在队伍激活期间上报，退出即停止</text>
    </view>

    <!-- 已入队 -->
    <template v-else>
      <view class="team-bar">
        <view class="team-info">
          <text class="team-name">{{ team.name }}</text>
          <text class="team-code" @click="copyCode">邀请码 {{ team.inviteCode }} · 点按复制</text>
        </view>
        <view v-if="team.createdBy === myOpenid" class="leave" @click="manageTeam">管理</view>
        <view v-if="availableTeams.length > 1" class="leave" @click="chooseTeam">切换队伍</view>
        <view class="leave" @click="leave">退出</view>
      </view>

      <view v-if="!sharing" class="share-tip">
        <text>位置共享未开启，队友看不到你</text>
        <view class="share-on" @click="startShare">开启共享</view>
      </view>
      <view v-else class="share-tip on">
        <text>位置共享中 · 每 {{ REPORT_INTERVAL / 1000 }} 秒上报</text>
        <view class="share-on off" @click="stopShare">停止</view>
      </view>

      <view v-for="a in alerts" :key="a.id" class="share-tip">
        <text>{{ a.openid === myOpenid ? '你已发出求助信号' : '队友发出求助信号' }}：{{ a.message }} · {{ freshness(a.triggeredAt) }}</text>
        <button v-if="a.openid === myOpenid" size="mini" @click="resolveSos">解除</button>
      </view>
      <!-- 成员列表：实时距离 -->
      <scroll-view scroll-y class="members">
        <view v-for="m in membersWithDistance" :key="m.openid" class="member" @click="rendezvous(m)" @longpress="manageMember(m)">
          <view class="avatar">{{ m.nickname.slice(0, 1) }}</view>
          <view class="m-info">
            <text class="m-name">{{ m.nickname }}<text v-if="m.isLeader" class="leader">队长</text><text v-if="m.openid === myOpenid" class="me">我</text></text>
            <text class="m-time">{{ freshness(m.updatedAt) }}</text>
          </view>
          <view class="m-dist">
            <text class="m-dist-v">{{ m.openid === myOpenid ? '—' : m.distanceText }}</text>
            <text v-if="m.openid !== myOpenid" class="m-go">会合 →</text>
          </view>
        </view>
        <view v-if="members.length <= 1" class="empty">还没有队友加入，把邀请码发给 TA</view>
      </scroll-view>

      <view class="tip">点任意队友：箭头实时指向 TA，双向距离随两人移动更新（类苹果查找）</view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { onLoad, onShow, onHide } from "@dcloudio/uni-app";
import { formatDistance, haversineM } from "@shared/api/navigation-core";
import type { Team, TeamMember } from "@shared/types/social";
import type { TrackPoint } from "@shared/types/track";
import { accountSession, onAccountChange } from '@/services/account';
import { callCloud } from "@/services/cloud";
import { startLocationUpdates, stopLocationUpdates } from "@/services/location";
import { hasPrivacyConsent, onPrivacyChange } from "@/services/privacy";

const REPORT_INTERVAL = 10000;

const team = ref<(Team & { teamId?: string }) | null>(null);
const availableTeams = ref<(Team & { teamId?: string })[]>([]);
const inviteCode = ref("");
type Alert = { id: string; openid: string; message: string; triggeredAt: number };
const alerts = ref<Alert[]>([]);
const members = ref<TeamMember[]>([]);
const myOpenid = ref("");
const sharing = ref(false);
const myPos = ref<TrackPoint | null>(null);
const membersWithDistance = ref<(TeamMember & { distanceText: string })[]>([]);
const onMyLocation = (p: TrackPoint) => { myPos.value = p; };

let reportTimer: ReturnType<typeof setInterval> | null = null;
let remoteQueue: Promise<unknown> = Promise.resolve();
let pollTimer: ReturnType<typeof setInterval> | null = null;

let context=0,pollSequence=0;
let discoverSequence=0;
function identity(){return `${uni.getStorageSync('he_openid')||''}:${accountSession()?.token||''}`;}
function snapshot(){return {owner:identity(),epoch:context,teamId:team.value?.id};}
function current(value:ReturnType<typeof snapshot>){return value.owner===identity()&&value.epoch===context&&value.teamId===team.value?.id;}

onLoad(async () => {
  const original=snapshot();
  const res = await callCloud<{ openid: string }>("login");
  if (!current(original)||!res.ok || !res.data) return;
  myOpenid.value = res.data.openid;
  // 本机缓存先用于断网显示；随后按登录身份读取云端成员关系并纠正它。
  const saved = uni.getStorageSync("he_team");
  if (saved) {
    try { const restored=typeof saved==='string'?JSON.parse(saved):saved;if(!validTeam(restored))throw new Error("invalid team");team.value=restored;startPoll(); } catch { uni.removeStorageSync("he_team"); }
  }
  await discoverJoinedTeams();
});

onShow(() => { if (team.value) startPoll(); void discoverJoinedTeams(); });
onHide(() => { context++; stopPoll(); stopShare(); });
const unsubscribePrivacy = onPrivacyChange((consents) => {
  if (!consents.location || !consents.teamLocation) stopShare();
});
const unsubscribeAccount = onAccountChange(() => {
  context++;stopShare(); stopPoll(); team.value = null; members.value = []; alerts.value = [];
  membersWithDistance.value = []; availableTeams.value=[];myOpenid.value = accountSession()?.openid||String(uni.getStorageSync('he_openid') || '');
  void discoverJoinedTeams();
});
onUnmounted(() => { context++;unsubscribePrivacy(); unsubscribeAccount(); stopPoll(); stopShare(); });

let entering=false;
const CREATION_KEY='he_team_creation_request_v1';
function pendingCreation():{id:string;key:string}{
  const owner=String(uni.getStorageSync('he_openid')||myOpenid.value);
  if(!owner)throw new Error('请先登录');
  const key=`${CREATION_KEY}:${encodeURIComponent(owner)}`;
  function parse(raw:any){const value=typeof raw==='string'?JSON.parse(raw):raw;
    if(!value||typeof value.owner!=='string'||typeof value.id!=='string'||!/^team-[a-zA-Z0-9-]{1,100}$/.test(value.id))throw new Error('创建请求缓存异常');
    return value;
  }
  const raw=uni.getStorageSync(key);
  if(raw){const saved=parse(raw);if(saved.owner!==owner)throw new Error('创建请求账号不匹配');return {id:saved.id,key};}
  const legacyRaw=uni.getStorageSync(CREATION_KEY);
  if(legacyRaw){const legacy=parse(legacyRaw);if(legacy.owner===owner){
    uni.setStorageSync(key,JSON.stringify(legacy));uni.removeStorageSync(CREATION_KEY);return {id:legacy.id,key};
  }}
  const id=`team-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  uni.setStorageSync(key,JSON.stringify({owner,id}));return {id,key};
}
function clearCreation(request:{id:string;key:string}){
  try{const raw=uni.getStorageSync(request.key);const saved=typeof raw==='string'?JSON.parse(raw):raw;if(saved?.id===request.id){const legacyRaw=uni.getStorageSync(CREATION_KEY);const legacy=typeof legacyRaw==='string'?JSON.parse(legacyRaw):legacyRaw;if(legacy?.id===request.id&&legacy?.owner===saved.owner)uni.removeStorageSync(CREATION_KEY);uni.removeStorageSync(request.key);}}
  catch{uni.showToast({title:'创建请求缓存清理失败',icon:'none'});}
}
function rememberTeam(){
  try{uni.setStorageSync('he_team',JSON.stringify(team.value));}
  catch{uni.showToast({title:'已加入队伍，本机缓存保存失败',icon:'none'});}
}
async function createTeam() {
  if(entering||team.value)return;
  const original=snapshot();entering=true;
  try{
    const creationRequest=pendingCreation();
    const res=await callCloud<{teamId:string;inviteCode:string;requestExpired?:boolean}>('team-create',{name:'徒步小队',requestId:creationRequest.id});
    if(!current(original))return;
    if(res.code==='TEAM_REQUEST_EXPIRED')clearCreation(creationRequest);
    if(!res.ok||!res.data||typeof res.data.teamId!=='string'||!res.data.teamId||typeof res.data.inviteCode!=='string'||!/^\d{6}$/.test(res.data.inviteCode)){
      uni.showToast({title:res.errMsg||'创建返回资料无效，请刷新后重试',icon:'none'});return;
    }
    team.value={id:res.data.teamId,name:'徒步小队',inviteCode:res.data.inviteCode,createdBy:myOpenid.value,createdAt:Date.now(),active:true};
    availableTeams.value=[team.value,...availableTeams.value.filter(item=>item.id!==team.value!.id)];
    clearCreation(creationRequest);rememberTeam();startPoll();
  }catch{if(current(original))uni.showToast({title:'创建请求失败，请重试',icon:'none'});}
  finally{entering=false;}
}
async function joinTeam() {
  if(entering||team.value)return;
  if(!/^\d{6}$/.test(inviteCode.value)){uni.showToast({title:'请输入六位数字邀请码',icon:'none'});return;}
  const original=snapshot();entering=true;
  try{
    const res=await callCloud<{team:Team}>('team-join',{inviteCode:inviteCode.value});
    if(!current(original))return;
    if(!res.ok||!res.data||!validTeam(res.data.team)||!res.data.team.active){uni.showToast({title:res.errMsg||'加入返回资料无效',icon:'none'});return;}
    team.value=res.data.team;availableTeams.value=[team.value,...availableTeams.value.filter(item=>item.id!==team.value!.id)];rememberTeam();startPoll();
  }catch{if(current(original))uni.showToast({title:'加入请求失败，请重试',icon:'none'});}
  finally{entering=false;}
}

async function discoverJoinedTeams():Promise<void> {
  const sequence=++discoverSequence,original=snapshot();
  const result=await callCloud<{teams:(Team & {teamId?:string})[];hasMore:boolean}>('team-current');
  if(sequence!==discoverSequence||!current(original))return;
  if(!result.ok||!result.data)return; // Keep the last local cache when the network is unavailable.
  if(!Array.isArray(result.data.teams)||result.data.teams.length>100||typeof result.data.hasMore!=='boolean'
    ||!result.data.teams.every(validTeam)||new Set(result.data.teams.map(item=>item.id)).size!==result.data.teams.length){
    uni.showToast({title:'云端队伍目录格式无效，已保留本机缓存',icon:'none'});return;
  }
  availableTeams.value=result.data.teams;
  if(!availableTeams.value.length){team.value=null;members.value=[];alerts.value=[];membersWithDistance.value=[];stopPoll();stopShare();uni.removeStorageSync('he_team');return;}
  const preferred=team.value?.id||'';
  team.value=availableTeams.value.find(item=>item.id===preferred)||availableTeams.value[0];
  rememberTeam();startPoll();
  if(result.data.hasMore)uni.showToast({title:'成员目录达到100条查询上限，可能遗漏旧队伍',icon:'none'});
}

function chooseTeam(){
  if(availableTeams.value.length<2)return;
  const original=snapshot();
  uni.showActionSheet({itemList:availableTeams.value.map(item=>`${item.name} · ${item.inviteCode}`),success:choice=>{
    if(!current(original))return;
    const selected=availableTeams.value[choice.tapIndex];if(!selected||selected.id===team.value?.id)return;
    stopShare();stopPoll();team.value=selected;members.value=[];alerts.value=[];membersWithDistance.value=[];rememberTeam();startPoll();
  }});
}

let leaving=false;
function leave() {
  if(leaving||!team.value)return;
  const original=snapshot();
  uni.showModal({title:'退出队伍？',content:'退出后停止位置共享',success:async result=>{
    if(!result.confirm||leaving||!team.value||!current(original))return;
    leaving=true;
    try{
      const teamId=team.value.id;
      stopShare();await remoteQueue;
      if(!current(original))return;
      const response=await callCloud<{left:boolean}>('team-leave',{teamId});
      if(!current(original))return;
      if(!response.ok||response.data?.left!==true){uni.showToast({title:response.errMsg||'退出未确认，请重试',icon:'none'});return;}
      stopPoll();team.value=null;members.value=[];alerts.value=[];membersWithDistance.value=[];
      try{uni.removeStorageSync('he_team');}
      catch{uni.showToast({title:'已退出队伍，本机缓存清理失败',icon:'none'});}
      availableTeams.value=availableTeams.value.filter(item=>item.id!==teamId);
      if(availableTeams.value.length){team.value=availableTeams.value[0];rememberTeam();startPoll();}
      else void discoverJoinedTeams();
    }catch{if(current(original))uni.showToast({title:'退出请求失败，共享已停止，请重试',icon:'none'});}
    finally{leaving=false;}
  }});
}

/* ---------- 位置上报 ---------- */
let shareGeneration = 0;
let startingShare = false;
async function startShare() {
  if (sharing.value || startingShare || !team.value) return;
  if (!hasPrivacyConsent("location") || !hasPrivacyConsent("teamLocation")) {
    uni.showModal({ title: "需要先启用位置共享", content: "请在“我的 → 隐私设置”中启用定位和组队位置共享，再回来手动开启共享。", showCancel: false });
    return;
  }
  startingShare = true;
  const epoch = ++shareGeneration;
  const original=snapshot();
  let ok=false;
  try{ok=await startLocationUpdates(onMyLocation,"team");}
  catch{if(epoch===shareGeneration&&current(original))uni.showToast({title:'定位启动失败，请重试',icon:'none'});}
  finally{if(epoch===shareGeneration)startingShare=false;}
  if(epoch!==shareGeneration||!current(original))return;
  if (!ok) {
    uni.showToast({ title: "定位未启动，未开启共享", icon: "none" });
    return;
  }
  sharing.value = true;
  reportTimer = setInterval(report, REPORT_INTERVAL);
}
function stopShare() {
  const wasSharing = sharing.value;
  const teamId = team.value?.id;
  const owner=identity();
  shareGeneration++;
  startingShare = false;
  sharing.value = false;
  myPos.value = null;
  stopLocationUpdates(onMyLocation);
  if (reportTimer) clearInterval(reportTimer);
  reportTimer = null;
  if (wasSharing && teamId) {
    remoteQueue = remoteQueue.catch(() => {}).then(async () => {
      if(owner!==identity())return;
      const res = await callCloud("team-stop", { teamId });
      if (owner===identity()&&!res.ok) uni.showToast({ title: "本机已停止共享；云端位置清理失败，最多一分钟后不再展示", icon: "none" });
    });
  }
}

async function report() {
  if (!sharing.value || !team.value || !myPos.value || !hasPrivacyConsent("teamLocation") || !hasPrivacyConsent("location")) return;
  const epoch = shareGeneration;
  const payload = { teamId: team.value.id, latitude: myPos.value.latitude, longitude: myPos.value.longitude };
  remoteQueue = remoteQueue.catch(() => {}).then(async () => {
    if (!sharing.value || epoch !== shareGeneration) return;
    const res = await callCloud("team-report", payload);
    if (!res.ok && epoch === shareGeneration) { stopShare(); uni.showToast({ title: res.errMsg ?? "上报失败，共享已停止", icon: "none" }); }
  });
  await remoteQueue;
}

/* ---------- 成员轮询 + 距离计算 ---------- */
function startPoll() {
  stopPoll();
  poll();
  pollTimer = setInterval(poll, REPORT_INTERVAL);
}
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function validTeam(value:any):value is Team {
  return !!value&&typeof value.id==='string'&&!!value.id&&typeof value.name==='string'&&typeof value.createdBy==='string'&&!!value.createdBy
    &&typeof value.inviteCode==='string'&&/^\d{6}$/.test(value.inviteCode)&&typeof value.active==='boolean'&&Number.isFinite(value.createdAt)&&value.createdAt>0;
}
function validLocations(value:any,id:string):boolean {
  if(!value||!validTeam(value.team)||value.team.id!==id||!value.team.active||!Array.isArray(value.members)||value.members.length>100||!Array.isArray(value.alerts)||value.alerts.length>10)return false;
  const ids=new Set<string>();
  if(!value.members.every((m:any)=>{
    if(!m||m.teamId!==id||typeof m.openid!=='string'||!m.openid||ids.has(m.openid))return false;
    ids.add(m.openid);
    return typeof m.nickname==='string'&&typeof m.isLeader==='boolean'&&Number.isFinite(m.updatedAt)&&m.updatedAt>=0
      &&((m.latitude===null&&m.longitude===null)||(Number.isFinite(m.latitude)&&Math.abs(m.latitude)<=90&&Number.isFinite(m.longitude)&&Math.abs(m.longitude)<=180));
  }))return false;
  const alertsSeen=new Set<string>();
  return value.alerts.every((a:any)=>{if(!a||typeof a.id!=='string'||!a.id||alertsSeen.has(a.id))return false;alertsSeen.add(a.id);return typeof a.openid==='string'&&typeof a.message==='string'&&Number.isFinite(a.triggeredAt)&&a.triggeredAt>0;});
}

async function poll() {
  if (!team.value) return;
  const id = team.value.id;
  const original=snapshot(),sequence=++pollSequence;
  const res = await callCloud<{ members: TeamMember[]; alerts: Alert[]; team: Team }>("team-locations", { teamId: id });
  if (!current(original)||sequence!==pollSequence||team.value?.id !== id) return;
  if (res.ok && res.data && validLocations(res.data,id)) {
    team.value = res.data.team;
    rememberTeam();
    members.value = res.data.members;
    alerts.value = res.data.alerts ?? [];
    membersWithDistance.value = res.data.members.map((m) => {
      const d = myPos.value && fresh(m)
        ? haversineM(myPos.value, { latitude: m.latitude!, longitude: m.longitude! })
        : NaN;
      return { ...m, distanceText: isNaN(d) ? "暂无有效位置" : formatDistance(d) };
    });
  } else if (res.errMsg === '队伍已解散' || res.errMsg === '不是本队成员') {
    stopShare(); stopPoll(); team.value = null; members.value = []; alerts.value = [];
    membersWithDistance.value = []; uni.removeStorageSync('he_team');
    uni.showToast({ title: res.errMsg, icon: 'none' });
    void discoverJoinedTeams();
  }
}

function fresh(m: TeamMember): boolean {
  return Number.isFinite(m.latitude) && Number.isFinite(m.longitude) && Math.abs(m.latitude!)<=90 && Math.abs(m.longitude!)<=180 && Number.isFinite(m.updatedAt) && m.updatedAt > 0 && m.updatedAt<=Date.now()+30000 && Date.now() - m.updatedAt <= 60000;
}
function freshness(ts: number): string {
  if (!ts) return "未共享位置";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "刚刚在线";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return `${Math.floor(s / 3600)} 小时前`;
}

/** 会合：箭头导航到队友实时位置 */
function rendezvous(m: TeamMember) {
  if (m.openid === myOpenid.value) return;
  if (!fresh(m)) { uni.showToast({ title: "队友位置已过期，暂时不能导航", icon: "none" }); return; }
  uni.navigateTo({
    url: `/pages/navigation/session?mode=member&teamId=${team.value!.id}&memberId=${m.openid}&name=${encodeURIComponent(m.nickname)}`,
  });
}

let resolving=false;
async function resolveSos() {
  if(resolving)return;
  const original=snapshot();resolving=true;
  try{
    const res = await callCloud("sos-trigger", { action: "resolve" });
    if(!current(original))return;
    if (res.ok) await poll();
    else uni.showToast({ title: res.errMsg ?? "解除失败", icon: "none" });
  }catch{if(current(original))uni.showToast({title:'解除请求失败，请重试',icon:'none'});}
  finally{resolving=false;}
}
function manageTeam() {
  const original=snapshot();
  if (!team.value || team.value.createdBy !== myOpenid.value) return;
  uni.showActionSheet({ itemList: ['修改队名', '解散队伍'], success: choice => {
    if(!current(original)||team.value?.createdBy!==myOpenid.value)return;
    if (choice.tapIndex === 0) uni.showModal({ title: '修改队名', editable: true, placeholderText: team.value?.name, success: async result => {
      if (result.confirm&&current(original)) await manage('rename', { name: result.content });
    } });
    else uni.showModal({ title: '解散队伍', content: '关闭邀请码，停止所有成员的位置共享。', success: async result => {
      if (result.confirm&&current(original)) await manage('disband');
    } });
  } });
}
function manageMember(member: TeamMember) {
  const original=snapshot();
  if (!team.value || team.value.createdBy !== myOpenid.value || member.openid === myOpenid.value) return;
  uni.showActionSheet({ itemList: ['移交队长', '移除成员'], success: choice => {
    if(!current(original)||team.value?.createdBy!==myOpenid.value)return;
    const action = choice.tapIndex === 0 ? 'transfer' : 'remove';
    uni.showModal({ title: action === 'transfer' ? '移交队长' : '移除成员', content: `确认对“${member.nickname}”执行此操作？`, success: async result => {
      if (result.confirm&&current(original)) await manage(action, { memberId: member.openid });
    } });
  } });
}
let managing=false;
async function manage(action: string, data: Record<string, unknown> = {}) {
  if (!team.value || managing || team.value.createdBy!==myOpenid.value) return;
  const original=snapshot();managing=true;
  try{
    const result = await callCloud('team-manage', { teamId: team.value.id, action, ...data });
    if(!current(original))return;
    if (!result.ok) { uni.showToast({ title: result.errMsg || '操作失败', icon: 'none' }); return; }
    await poll();
  }catch{if(current(original))uni.showToast({title:'队伍操作失败，请重试',icon:'none'});}
  finally{managing=false;}
}
function copyCode() {
  uni.setClipboardData({ data: team.value!.inviteCode });
}
</script>

<style lang="scss" scoped>
.page { height: 100vh; background: var(--he-color-background); padding: 16px; box-sizing: border-box; }
.entry { display: flex; flex-direction: column; padding-top: 40px; }
.entry-title { font-size: 24px; font-weight: 700; color: var(--he-color-text); }
.entry-sub { margin-top: 4px; font-size: 12px; color: var(--he-color-muted); }
.btn { margin-top: 16px; border-radius: 499.5px; font-size: 15px; }
.btn.primary { background: var(--he-color-accent); color: var(--he-color-on-accent); font-weight: 600; }
.btn.ghost { background: var(--he-color-surface); color: var(--he-color-text); width: 90px; margin-top: 0; }
.join-row { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
.input { flex: 1; background: var(--he-color-surface); border-radius: 499.5px; padding: 10px 16px; font-size: 14px; color: var(--he-color-text); }
.ph { color: var(--he-color-muted); }
.privacy { margin-top: 24px; font-size: 10px; color: var(--he-color-muted); line-height: 1.7; }
.team-bar { display: flex; align-items: center; background: var(--he-color-panel); border-radius: 10px; padding: 12px; }
.team-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.team-name { font-size: 16px; font-weight: 600; color: var(--he-color-text); }
.team-code { font-size: 12px; color: var(--he-color-accent); }
.leave { font-size: 13px; color: var(--he-color-danger); padding: 4px 8px; }
.share-tip { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding: 10px 12px; background: rgba(var(--he-color-warning-rgb), 0.1); border-radius: 8px; font-size: 12px; color: var(--he-color-warning); }
.share-tip.on { background: rgba(var(--he-color-accent-rgb), 0.1); color: var(--he-color-accent); }
.share-on { padding: 4px 12px; background: var(--he-color-accent); color: var(--he-color-on-accent); border-radius: 499.5px; font-size: 11px; font-weight: 600; }
.share-on.off { background: var(--he-color-surface); color: var(--he-color-muted); }
.members { margin-top: 12px; flex: 1; }
.member { display: flex; align-items: center; background: var(--he-color-panel); border-radius: 10px; padding: 12px; margin-bottom: 8px; }
.avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--he-color-surface); color: var(--he-color-accent); display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600; }
.m-info { flex: 1; margin-left: 10px; display: flex; flex-direction: column; gap: 3px; }
.m-name { font-size: 14px; font-weight: 600; color: var(--he-color-text); }
.leader, .me { margin-left: 6px; font-size: 9px; color: var(--he-color-on-accent); background: var(--he-color-accent); border-radius: 4px; padding: 1px 5px; }
.me { background: var(--he-color-info); }
.m-time { font-size: 10px; color: var(--he-color-muted); }
.m-dist { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.m-dist-v { font-size: 15px; font-weight: 700; color: var(--he-color-text); }
.m-go { font-size: 11px; color: var(--he-color-accent); }
.empty { text-align: center; color: var(--he-color-muted); font-size: 12px; padding: 24px 0; }
.tip { padding: 12px 0; font-size: 10px; color: var(--he-color-muted); text-align: center; }
</style>
