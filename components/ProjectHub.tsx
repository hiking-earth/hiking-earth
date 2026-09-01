"use client";

import { useEffect, useMemo, useState } from "react";
import { ATTRACTIONS, OUTDOOR_NEWS } from "@/data/explore";
import { ROUTES, type HikingRoute } from "@/data/routes";
import { getRouteSourceRecords, isPublishReady, OFFICIAL_SOURCE_REGISTRY, type SourceReadiness } from "@/data/source-registry";
import { Activity, BookHeart, Bot, CalendarDays, Check, ClipboardList, Download, Globe2, MapPinned, MessageCircle, Send, ShieldCheck, Sparkles, Trash2, Users, X } from "lucide-react";

export type HubTab = "推荐" | "社区约伴" | "日记足迹" | "景点新闻" | "管理台";
type Comment = { id: string; routeId: string; text: string; createdAt: string };
type Trip = { id: string; routeId: string; date: string; title: string; emergency: string; createdAt: string };
type TripRegistration = { id: string; tripId: string; emergency: string; birth: string; guardianConfirmed: boolean; createdAt: string };
type ChatMessage = { id: string; tripId: string; text: string; createdAt: string };
type Diary = { id: string; routeId: string; title: string; text: string; privacy: "仅自己" | "公开"; checkedIn: boolean; createdAt: string };

const LOCAL_DATA_KEYS = [
  "hiking-earth-comments-v1",
  "hiking-earth-trips-v1",
  "hiking-earth-registrations-v1",
  "hiking-earth-chat-v1",
  "hiking-earth-diaries-v1",
] as const;

function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) as T : initial;
    } catch { /* local prototype: ignore damaged browser cache */ }
    return initial;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode can disable storage */ }
  }, [key, value]);
  return [value, setValue] as const;
}

function haversineKm(a: [number, number], b: [number, number]) {
  const rad = (degree: number) => degree * Math.PI / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const lat1 = rad(a[1]);
  const lat2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function ageFromBirth(birth: string) {
  if (!birth) return 0;
  const birthday = new Date(`${birth}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birthday.getFullYear();
  if (now.getMonth() < birthday.getMonth() || (now.getMonth() === birthday.getMonth() && now.getDate() < birthday.getDate())) age -= 1;
  return age;
}

const readinessColor: Record<SourceReadiness, string> = { "可本地展示": "#b8f36b", "待官方核验": "#ffd166", "待授权": "#ff9a62" };

export function ProjectHub({ open, route, initialTab = "推荐", onClose, onSelectRoute }: { open: boolean; route: HikingRoute; initialTab?: HubTab; onClose: () => void; onSelectRoute: (id: string) => void }) {
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [comments, setComments] = useLocalState<Comment[]>("hiking-earth-comments-v1", []);
  const [trips, setTrips] = useLocalState<Trip[]>("hiking-earth-trips-v1", []);
  const [registrations, setRegistrations] = useLocalState<TripRegistration[]>("hiking-earth-registrations-v1", []);
  const [messages, setMessages] = useLocalState<ChatMessage[]>("hiking-earth-chat-v1", []);
  const [diaries, setDiaries] = useLocalState<Diary[]>("hiking-earth-diaries-v1", []);
  const [commentText, setCommentText] = useState("");
  const [chatText, setChatText] = useState("");
  const [birth, setBirth] = useState("");
  const [joinBirth, setJoinBirth] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [emergency, setEmergency] = useState("");
  const [joinEmergency, setJoinEmergency] = useState("");
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [currentTime] = useState(() => Date.now());
  const [diaryTitle, setDiaryTitle] = useState("");
  const [diaryText, setDiaryText] = useState("");
  const [diaryPrivacy, setDiaryPrivacy] = useState<"仅自己" | "公开">("仅自己");
  const [intent, setIntent] = useState("秋天，从郑州出发，轻装，两天以内");
  const [recommendSeason, setRecommendSeason] = useState("秋");
  const [recommendDays, setRecommendDays] = useState("2");
  const [feedback, setFeedback] = useState("");

  const recommendations = useMemo(() => ROUTES.map((item) => {
    const distance = haversineKm([113.625, 34.747], item.center);
    let score = item.status === "开放中" ? 45 : item.status === "待核验" ? 12 : -80;
    if (item.bestSeasons.some((season) => recommendSeason.includes(season))) score += 25;
    if (intent.includes(item.region.split("·")[0].trim()) || item.scenery.some((tag) => intent.includes(tag))) score += 20;
    if (Number(recommendDays) >= (item.duration.includes("半日") ? 1 : Number(item.duration.match(/\d+/)?.[0] ?? 2))) score += 10;
    score += Math.max(0, 20 - distance / 100);
    return { item, score: Math.round(score), distance };
  }).filter(({ item }) => item.trackMode !== "不展示轨迹").sort((a, b) => b.score - a.score).slice(0, 5), [intent, recommendDays, recommendSeason]);

  if (!open) return null;
  const routeComments = comments.filter((item) => item.routeId === route.id);
  const routeTrips = trips.filter((item) => item.routeId === route.id);
  const activeTrip = routeTrips[0];
  const tripMessages = messages.filter((item) => item.tripId === activeTrip?.id);
  const activeRegistration = registrations.find((item) => item.tripId === activeTrip?.id);
  const activeTripRegistrationCount = registrations.filter((item) => item.tripId === activeTrip?.id).length;
  const isTripArchived = activeTrip ? currentTime > new Date(`${activeTrip.date}T23:59:59`).getTime() + 30 * 24 * 60 * 60 * 1000 : false;
  const canOrganize = route.status === "开放中";

  function addComment() {
    if (!commentText.trim()) return;
    setComments((items) => [{ id: crypto.randomUUID(), routeId: route.id, text: commentText.trim(), createdAt: new Date().toLocaleString("zh-CN") }, ...items]);
    setCommentText("");
  }

  function createTrip() {
    if (!canOrganize) return setFeedback("当前路线未处于“开放中”，不能发起约伴。");
    if (ageFromBirth(birth) < 18) return setFeedback("只有成年人可以独立发布活动；未成年人需由监护人报名。");
    if (!tripDate || emergency.trim().length < 5) return setFeedback("请填写日期和有效的紧急联系人信息。");
    const tripId = crypto.randomUUID();
    const createdAt = new Date().toLocaleString("zh-CN");
    setTrips((items) => [{ id: tripId, routeId: route.id, date: tripDate, title: `${route.name} · 免费/AA约伴`, emergency: emergency.trim(), createdAt }, ...items]);
    setRegistrations((items) => [{ id: crypto.randomUUID(), tripId, emergency: emergency.trim(), birth, guardianConfirmed: false, createdAt }, ...items]);
    setFeedback("活动已保存在本机；群聊仅对本活动报名成员开放。");
  }

  function joinTrip() {
    if (!activeTrip) return;
    if (isTripArchived) return setFeedback("该活动结束已满 30 天，群聊已归档，不能再报名。");
    if (!joinBirth || joinEmergency.trim().length < 5) return setFeedback("请填写出生日期和有效的紧急联系人信息。");
    if (ageFromBirth(joinBirth) < 18 && !guardianConfirmed) return setFeedback("未成年人报名需要由监护人确认后才能进入活动群聊。");
    if (activeRegistration) return setFeedback("你已完成报名，可以进入本活动群聊。");
    setRegistrations((items) => [{ id: crypto.randomUUID(), tripId: activeTrip.id, emergency: joinEmergency.trim(), birth: joinBirth, guardianConfirmed, createdAt: new Date().toLocaleString("zh-CN") }, ...items]);
    setFeedback("报名已保存到当前浏览器；现在可以进入活动群聊。");
  }

  function addChat() {
    if (!activeTrip || !activeRegistration || isTripArchived) return setFeedback(isTripArchived ? "该活动群聊已归档。" : "请先完成报名后再进入活动群聊。");
    if (!chatText.trim()) return;
    setMessages((items) => [...items, { id: crypto.randomUUID(), tripId: activeTrip.id, text: chatText.trim(), createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) }]);
    setChatText("");
  }

  function addDiary() {
    if (!diaryTitle.trim() || !diaryText.trim()) return setFeedback("请先填写日记标题和内容。");
    setDiaries((items) => [{ id: crypto.randomUUID(), routeId: route.id, title: diaryTitle.trim(), text: diaryText.trim(), privacy: diaryPrivacy, checkedIn: true, createdAt: new Date().toLocaleString("zh-CN") }, ...items]);
    setDiaryTitle(""); setDiaryText(""); setFeedback("日记和打卡已保存在本机。");
  }

  function exportLocalData() {
    const payload = {
      product: "徒步地球",
      exportedAt: new Date().toISOString(),
      scope: "当前浏览器本地数据",
      comments,
      trips,
      registrations,
      messages,
      diaries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `徒步地球-本机数据-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setFeedback("本机数据已导出为 JSON 文件；请妥善保管其中的个人信息。");
  }

  function clearLocalData() {
    if (!window.confirm("确定清除当前浏览器中的留言、约伴、报名、群聊、日记和足迹吗？此操作不可撤销，建议先导出备份。")) return;
    LOCAL_DATA_KEYS.forEach((key) => localStorage.removeItem(key));
    setComments([]);
    setTrips([]);
    setRegistrations([]);
    setMessages([]);
    setDiaries([]);
    setFeedback("当前浏览器中的徒步地球本机数据已清除。");
  }

  const tabs: { id: HubTab; icon: typeof Bot }[] = [
    { id: "推荐", icon: Bot }, { id: "社区约伴", icon: Users }, { id: "日记足迹", icon: BookHeart }, { id: "景点新闻", icon: Globe2 }, { id: "管理台", icon: ShieldCheck },
  ];

  return <section className="project-hub glass" role="dialog" aria-modal="true" aria-label="徒步地球功能中心">
    <header className="hub-header"><div><span className="eyebrow">LOCAL COMPETITION EDITION</span><h2>徒步地球功能中心</h2><p>游客本地档案 · 无需登录 · 数据只保存在这台设备</p></div><button onClick={onClose} aria-label="关闭功能中心"><X /></button></header>
    <nav className="hub-tabs">{tabs.map(({ id, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={16} />{id}</button>)}</nav>
    <div className="hub-body">
      {tab === "推荐" && <div className="hub-grid recommend-grid">
        <article className="hub-card"><h3><Sparkles size={17} />自然语言行程需求</h3><textarea value={intent} onChange={(event) => setIntent(event.target.value)} /><div className="inline-fields"><label>想看的季节<select value={recommendSeason} onChange={(event) => setRecommendSeason(event.target.value)}><option>春</option><option>夏</option><option>秋</option><option>冬</option></select></label><label>最长假期<select value={recommendDays} onChange={(event) => setRecommendDays(event.target.value)}><option value="1">1天</option><option value="2">2天</option><option value="4">4天</option><option value="7">7天</option><option value="10">10天</option></select></label></div><p className="honesty-note">当前按郑州出发的直线距离、路线状态、季节和时长评分；交通时间、机票/高铁费用需接入地图与票务API后才会计算。</p></article>
        <article className="hub-card"><h3><MapPinned size={17} />推荐结果</h3><div className="recommend-list">{recommendations.map(({ item, score, distance }, index) => <button key={item.id} onClick={() => onSelectRoute(item.id)}><i>{index + 1}</i><span><b>{item.name}</b><small>{item.region} · 直线约 {distance} km · {item.status}</small></span><strong>{Math.max(0, score)}分</strong></button>)}</div></article>
      </div>}

      {tab === "社区约伴" && <div className="hub-grid">
        <article className="hub-card"><h3><MessageCircle size={17} />{route.name} · 路线留言</h3><div className="compose-row"><input maxLength={300} value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="分享路况、体验或提问" /><button onClick={addComment}><Send size={15} />发布</button></div><div className="feed-list">{routeComments.length ? routeComments.map((item) => <p key={item.id}><b>本地游客</b><span>{item.text}</span><small>{item.createdAt}</small></p>) : <em>还没有留言，发布第一条吧。</em>}</div></article>
        <article className="hub-card"><h3><CalendarDays size={17} />免费/AA约伴</h3><div className="form-stack"><label>出生日期<input type="date" value={birth} onChange={(event) => setBirth(event.target.value)} /></label><label>活动日期<input type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} /></label><label>紧急联系人<input value={emergency} onChange={(event) => setEmergency(event.target.value)} placeholder="姓名与电话（仅本机保存）" /></label><button onClick={createTrip} disabled={!canOrganize}>发起活动</button></div>{activeTrip && <div className="trip-summary"><b>{activeTrip.title}</b><small>{activeTrip.date} · 已报名 {activeTripRegistrationCount} 人 · {isTripArchived ? "活动群聊已归档" : "仅已报名成员可见"}</small></div>}{activeTrip && !isTripArchived && !activeRegistration && <div className="form-stack join-trip"><b>报名后进入活动群聊</b><label>出生日期<input type="date" value={joinBirth} onChange={(event) => setJoinBirth(event.target.value)} /></label><label>紧急联系人<input value={joinEmergency} onChange={(event) => setJoinEmergency(event.target.value)} placeholder="姓名与电话（仅本机保存）" /></label><label className="guardian-check"><input type="checkbox" checked={guardianConfirmed} onChange={(event) => setGuardianConfirmed(event.target.checked)} />如未满 18 岁，确认由监护人完成报名</label><button onClick={joinTrip}><Users size={15} />报名并进入群聊</button></div>}{activeTrip && activeRegistration && !isTripArchived && <div className="chat-box"><b>{activeTrip.title}</b><small>活动群聊 · 只有已报名成员可见</small>{tripMessages.map((item) => <p key={item.id}>{item.text}<i>{item.createdAt}</i></p>)}<div className="compose-row"><input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="给已报名成员留言" /><button onClick={addChat}><Send size={15} /></button></div></div>}</article>
      </div>}

      {tab === "日记足迹" && <div className="hub-grid">
        <article className="hub-card"><h3><BookHeart size={17} />记录这次旅程</h3><div className="form-stack"><label>标题<input maxLength={80} value={diaryTitle} onChange={(event) => setDiaryTitle(event.target.value)} placeholder={`${route.name}的一天`} /></label><label>日记<textarea maxLength={5000} value={diaryText} onChange={(event) => setDiaryText(event.target.value)} placeholder="天气、同行者、感受和需要记住的细节…" /></label><label>可见范围<select value={diaryPrivacy} onChange={(event) => setDiaryPrivacy(event.target.value as "仅自己" | "公开")}><option>仅自己</option><option>公开</option></select></label><button onClick={addDiary}><Check size={15} />保存日记并打卡</button></div></article>
        <article className="hub-card footprint-card"><h3><MapPinned size={17} />我的发光足迹</h3><div className="footprint-map">{[...new Set(diaries.filter((item) => item.checkedIn).map((item) => item.routeId))].map((id, index) => <button key={id} className="footprint-dot" style={{ left: `${18 + (index * 19) % 68}%`, top: `${24 + (index * 27) % 52}%` }} title={ROUTES.find((item) => item.id === id)?.name}><span /></button>)}</div><div className="diary-list">{diaries.length ? diaries.map((item) => <p key={item.id}><b>{item.title}</b><span>{ROUTES.find((routeItem) => routeItem.id === item.routeId)?.name} · {item.privacy}</span><small>{item.createdAt}</small></p>) : <em>打卡后，去过的路线会在这里亮起来。</em>}</div></article>
      </div>}

      {tab === "景点新闻" && <div className="hub-grid"><article className="hub-card"><h3><MapPinned size={17} />国内著名景点首批档案</h3><div className="catalog-list">{ATTRACTIONS.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.region} · {item.category}</span><small>{item.summary}</small><i>{item.sourceLabel}</i></p>)}</div></article><article className="hub-card"><h3><Globe2 size={17} />全球新闻地球图层框架</h3><div className="catalog-list">{OUTDOOR_NEWS.map((item) => <p key={item.id}><b>{item.title}<strong>{item.importance}</strong></b><span>{item.industry} · {item.region}</span><small>{item.sourceLabel}</small></p>)}</div><p className="honesty-note">新闻锚点、行业/时间/重要度字段已定义；没有实时新闻API时只展示“待接入”，绝不把占位内容冒充新闻。</p></article></div>}

      {tab === "管理台" && <div className="hub-grid"><article className="hub-card"><h3><ShieldCheck size={17} />路线审核总览</h3><div className="admin-metrics"><p><b>{ROUTES.length}</b><span>首批路线档案</span></p><p><b>{ROUTES.filter((item) => item.status === "开放中").length}</b><span>已标记开放</span></p><p><b>{ROUTES.filter((item) => item.status === "待核验").length}</b><span>待补官方来源</span></p><p><b>{ROUTES.filter((item) => item.trackMode === "不展示轨迹").length}</b><span>仅警示档案</span></p></div><p className="honesty-note">管理员：首版由项目创建者担任。状态更新工作流建议每 12 小时检查一次，重要公告即时人工复核。</p></article><article className="hub-card"><h3><ClipboardList size={17} />上线前接入清单</h3><ul className="check-list"><li className="done"><Check />3D卫星地球、地形、筛选和路线交互</li><li className="done"><Check />本地评论、约伴群聊、日记与足迹</li><li><Activity />官方开放公告与天气接口</li><li><Activity />微信/QQ/手机号/邮箱登录和多端同步</li><li><Activity />合规图片、攻略视频和博物馆授权导览</li></ul></article><article className="hub-card"><h3><ShieldCheck size={17} />本机隐私控制</h3><p className="honesty-note">以下操作只影响当前浏览器，不会上传或删除任何服务器数据。导出的文件可能包含出生日期和紧急联系人，请妥善保管。</p><div className="privacy-actions"><button onClick={exportLocalData}><Download size={15} />导出本机数据</button><button className="danger" onClick={clearLocalData}><Trash2 size={15} />清除本机数据</button></div></article><article className="hub-card source-gate-card"><h3><ShieldCheck size={17} />数据来源与发布闸门</h3><p className="honesty-note">当前路线：{route.name} · {isPublishReady(route) ? "可发布" : "不可发布"}。所有实时信息和图片授权必须完成后才允许进入正式发布流程。</p><div className="source-gate-list">{getRouteSourceRecords(route).map((source) => <p key={`${source.label}-${source.url}`}><b>{source.label}</b><span style={{ color: readinessColor[source.readiness] }}>{source.readiness}</span><small>{source.checkedAt} · {source.note}</small><a href={source.url} target="_blank" rel="noreferrer">打开来源</a></p>)}</div><div className="source-gate-list"><p><b>天气接口申请入口</b><span style={{ color: readinessColor[OFFICIAL_SOURCE_REGISTRY.weather.readiness] }}>待配置</span><small>完成官方接口申请后，将凭据放入本地环境变量，不写入源码。</small><a href={OFFICIAL_SOURCE_REGISTRY.weather.url} target="_blank" rel="noreferrer">查看申请说明</a></p></div></article></div>}
      {feedback && <p className="hub-feedback">{feedback}<button onClick={() => setFeedback("")}><X size={14} /></button></p>}
    </div>
  </section>;
}
