// companion-create：发约伴帖。先过微信内容安全机审，再入库。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({throwOnNotFound:false});
const crypto=require("crypto");

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { errMsg: "请先在微信小程序登录" };
  const { title = "", content = "", departDate = "", maxMembers = 4, routeId = "", nickname = "山友" } = event;

  if (typeof title !== "string" || !title.trim() || title.length > 60 || typeof content !== "string" || !content.trim() || content.length > 1000) return { errMsg: "标题须为 1–60 字，内容须为 1–1000 字" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate) || Number.isNaN(Date.parse(departDate)) || new Date(departDate).toISOString().slice(0, 10) !== departDate) return { errMsg: "请填写有效出发日期" };
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 50) return { errMsg: "人数须为 2–50 的整数" };
  const birth=String(event.birth||'');const birthday=new Date(birth+'T00:00:00Z');const now=new Date();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||Number.isNaN(birthday.getTime())||birthday.toISOString().slice(0,10)!==birth||birthday>now||now.getUTCFullYear()-birthday.getUTCFullYear()>120)return {errMsg:'请填写有效出生日期，仅用于本次年龄判断'};
  let age=now.getUTCFullYear()-birthday.getUTCFullYear();if(now.getUTCMonth()<birthday.getUTCMonth()||(now.getUTCMonth()===birthday.getUTCMonth()&&now.getUTCDate()<birthday.getUTCDate()))age--;
  if(age<18)return {errMsg:'只有成年人可独立发布活动'};
  if(typeof event.emergency!=='string'||event.emergency.trim().length<5||event.emergency.length>200||event.contactConsent!==true)return {errMsg:'请填写紧急联系人并确认用途'};
  if(typeof event.id!=='string'||event.id.length>100||!event.id)return {errMsg:'缺少活动提交标识'};
  if(typeof routeId!=='string'||routeId.length>120)return {errMsg:'路线标识无效'};
  if(Date.parse(departDate+'T23:59:59+08:00')<Date.now())return {errMsg:'请选择尚未结束的出发日期'};
  if(routeId){const route=(await db.collection('route_reviews').doc(crypto.createHash('sha256').update(routeId).digest('hex')).get()).data;if(!route||route.status!=='开放中'||!Number.isFinite(route.expiresAt)||route.expiresAt<=Date.now())return {errMsg:'关联路线须先完成有效官方开放核验，或取消关联并说明待核验路线'};}
  // Unified accounts do not have a WeChat OpenID. Queue for authorized
  // review instead of pretending that WeChat-only checks succeeded.
  let reviewPending = OPENID.startsWith("account:");
  if (!reviewPending) try {
    const check = await cloud.openapi.security.msgSecCheck({ openid: OPENID, scene: 3, version: 2, content: `${title}\n${content}` });
    if (!check || check.errCode !== 0) return { errMsg: "内容未通过安全审核，请修改后再发" };
    if(check.result?.suggest==='review')reviewPending=true;
    else if(check.result?.suggest!=='pass')return {errMsg:"内容未通过安全审核，请修改后再发"};
  } catch (e) {
    return { errMsg: "内容未通过安全审核，请修改后再发" };
  }

  const doc = {
    openid: OPENID,
    nickname: String(nickname).slice(0, 20),
    routeId,
    title: String(title).slice(0, 60),
    content: String(content).slice(0, 1000),
    departDate,
    maxMembers: Math.min(Math.max(Number(maxMembers) || 4, 1), 50),
    members: [OPENID],
    createdAt: Date.now(),
    status: reviewPending ? "pending" : "open",
  };
  const id=crypto.createHash('sha256').update(`${OPENID}:post:${event.id}`).digest('hex');
  return db.runTransaction(async tx=>{const ref=tx.collection('companion_posts').doc(id);const previous=(await ref.get()).data;
   if(previous){if(['deleted','hidden','deleting'].includes(previous.status))return {errMsg:'该提交已失效，请重新创建活动'};return {id,...previous,reviewPending:previous.status==='pending'};}
   await ref.set({data:doc});
   const registrationId=crypto.createHash('sha256').update(`${OPENID}:registration:${id}`).digest('hex');
   await tx.collection('user_documents').doc(registrationId).set({data:{owner:OPENID,kind:'registration',nickname:String(event.nickname||'山友').slice(0,40),postId:id,adult:true,guardianConfirmed:false,emergency:event.emergency.trim(),expiresAt:Date.parse(departDate+'T23:59:59+08:00')+30*86400000,createdAt:Date.now()}});
   return {id,...doc,reviewPending};
  });
};
