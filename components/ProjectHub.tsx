"use client";

import { useEffect, useMemo, useState } from "react";
import { ATTRACTIONS } from "@/data/explore";
import { ROUTES, type HikingRoute } from "@/data/routes";
import { getRouteSourceRecords, isPublishReady, OFFICIAL_SOURCE_REGISTRY, type SourceReadiness } from "@/data/source-registry";
import { Activity, BookHeart, Bot, Check, ClipboardList, Download, Globe2, MapPinned, ShieldCheck, Sparkles, Trash2, Users, X } from "lucide-react";

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

const readinessColor: Record<SourceReadiness, string> = { "可本地展示": "#b8f36b", "待官方核验": "#ffd166", "待授权": "#ff9a62" };

export function ProjectHub({ open, route, routes = ROUTES, initialTab = "推荐", onClose, onSelectRoute }: { open: boolean; route: HikingRoute; routes?: HikingRoute[]; initialTab?: HubTab; onClose: () => void; onSelectRoute: (id: string) => void }) {
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [comments, setComments] = useLocalState<Comment[]>("hiking-earth-comments-v1", []);
  const [trips, setTrips] = useLocalState<Trip[]>("hiking-earth-trips-v1", []);
  const [registrations, setRegistrations] = useLocalState<TripRegistration[]>("hiking-earth-registrations-v1", []);
  const [messages, setMessages] = useLocalState<ChatMessage[]>("hiking-earth-chat-v1", []);
  const [diaries, setDiaries] = useLocalState<Diary[]>("hiking-earth-diaries-v1", []);
  const [intent, setIntent] = useState("秋天，从郑州出发，轻装，两天以内");
  const [recommendSeason, setRecommendSeason] = useState("秋");
  const [recommendDays, setRecommendDays] = useState("2");
  const [feedback, setFeedback] = useState("");

  const recommendations = useMemo(() => routes.map((item) => {
    const distance = haversineKm([113.625, 34.747], item.center);
    let score = item.status === "开放中" ? 45 : item.status === "待核验" ? 12 : -80;
    if (item.bestSeasons.some((season) => recommendSeason.includes(season))) score += 25;
    if (intent.includes(item.region.split("·")[0].trim()) || item.scenery.some((tag) => intent.includes(tag))) score += 20;
    if (Number(recommendDays) >= (item.duration.includes("半日") ? 1 : Number(item.duration.match(/\d+/)?.[0] ?? 2))) score += 10;
    score += Math.max(0, 20 - distance / 100);
    return { item, score: Math.round(score), distance };
  }).filter(({ item }) => item.trackMode !== "不展示轨迹").sort((a, b) => b.score - a.score).slice(0, 5), [routes,intent, recommendDays, recommendSeason]);

  if (!open) return null;
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
    <header className="hub-header"><div><span className="eyebrow">HIKING EARTH</span><h2>徒步地球功能中心</h2><p>路线发现与云端社区 · 日记和队聊使用统一账号</p></div><button onClick={onClose} aria-label="关闭功能中心"><X /></button></header>
    <nav className="hub-tabs">{tabs.map(({ id, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={16} />{id}</button>)}</nav>
    <div className="hub-body">
      {tab === "推荐" && <div className="hub-grid recommend-grid">
        <article className="hub-card"><h3><Sparkles size={17} />自然语言行程需求</h3><textarea value={intent} onChange={(event) => setIntent(event.target.value)} /><div className="inline-fields"><label>想看的季节<select value={recommendSeason} onChange={(event) => setRecommendSeason(event.target.value)}><option>春</option><option>夏</option><option>秋</option><option>冬</option></select></label><label>最长假期<select value={recommendDays} onChange={(event) => setRecommendDays(event.target.value)}><option value="1">1天</option><option value="2">2天</option><option value="4">4天</option><option value="7">7天</option><option value="10">10天</option></select></label></div><p className="honesty-note">当前按郑州出发的直线距离、路线状态、季节和时长评分；交通时间、机票/高铁费用需接入地图与票务API后才会计算。</p></article>
        <article className="hub-card"><h3><MapPinned size={17} />推荐结果</h3><div className="recommend-list">{recommendations.map(({ item, score, distance }, index) => <button key={item.id} onClick={() => onSelectRoute(item.id)}><i>{index + 1}</i><span><b>{item.name}</b><small>{item.region} · 直线约 {distance} km · {item.status}</small></span><strong>{Math.max(0, score)}分</strong></button>)}</div></article>
      </div>}

      {(tab === "社区约伴" || tab === "日记足迹") && <div className="hub-card"><h3>统一账号云端社区</h3><p className="honesty-note">登录后，留言、日记、队内消息和通知在同一账号下跨端读取；公开内容需审核。本机旧数据仍可在管理台导出。</p><iframe title="徒步地球云端社区" src={`/client-app/index.html#/pages/companion/social?tab=${tab === "日记足迹" ? "diaries" : "comments"}&routeId=${encodeURIComponent(route.id)}`} style={{width:"100%",height:"70vh",border:0,borderRadius:16}} allow="geolocation" /></div>}

      {tab === "景点新闻" && <div className="hub-grid"><article className="hub-card"><h3><MapPinned size={17} />景点档案</h3><div className="catalog-list">{ATTRACTIONS.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.region} · {item.category}</span><small>{item.summary}</small><i>{item.sourceLabel} · {item.checkedAt}</i><a href={item.sourceUrl} target="_blank" rel="noreferrer">查看官方导览</a></p>)}</div></article><article className="hub-card"><h3><Globe2 size={17} />官方户外公告</h3><iframe title="官方户外公告" src="/client-app/index.html#/pages/route/news" style={{width:"100%",height:640,border:0}} /><p className="honesty-note">公告保留来源与发布日期；请查看官方原文确认当前限制。</p></article></div>}

      {tab === "管理台" && <div className="hub-grid"><article className="hub-card"><h3><ShieldCheck size={17} />路线审核总览</h3><div className="admin-metrics"><p><b>{routes.length}</b><span>首批路线档案</span></p><p><b>{routes.filter((item) => item.status === "开放中").length}</b><span>已标记开放</span></p><p><b>{routes.filter((item) => item.status === "待核验").length}</b><span>待补官方来源</span></p><p><b>{routes.filter((item) => item.trackMode === "不展示轨迹").length}</b><span>仅警示档案</span></p></div><p className="honesty-note">管理员：首版由项目创建者担任。路线目录和官方公告每六小时采集；开放状态由管理员核验，超过有效期回到待核验。</p></article><article className="hub-card"><h3><ClipboardList size={17} />上线前接入清单</h3><ul className="check-list"><li className="done"><Check />3D卫星地球、地形、筛选和路线交互</li><li className="done"><Check />统一账号云端日记、队聊和通知</li><li><Activity />官方开放公告与天气接口</li><li><Activity />更多第三方登录与短信验证</li><li><Activity />合规图片、攻略视频和博物馆授权导览</li></ul></article><article className="hub-card"><h3><ShieldCheck size={17} />本机隐私控制</h3><p className="honesty-note">以下操作只影响当前浏览器，不会上传或删除任何服务器数据。导出的文件可能包含出生日期和紧急联系人，请妥善保管。</p><div className="privacy-actions"><button onClick={exportLocalData}><Download size={15} />导出本机数据</button><a href="/client-app/index.html#/pages/my/import" target="_blank" rel="noreferrer">迁移日记和留言到云端</a><button className="danger" onClick={clearLocalData}><Trash2 size={15} />清除本机数据</button></div></article><article className="hub-card source-gate-card"><h3><ShieldCheck size={17} />数据来源与发布闸门</h3><p className="honesty-note">当前路线：{route.name} · {isPublishReady(route) ? "可发布" : "不可发布"}。所有实时信息和图片授权必须完成后才允许进入正式发布流程。</p><div className="source-gate-list">{getRouteSourceRecords(route).map((source) => <p key={`${source.label}-${source.url}`}><b>{source.label}</b><span style={{ color: readinessColor[source.readiness] }}>{source.readiness}</span><small>{source.checkedAt} · {source.note}</small><a href={source.url} target="_blank" rel="noreferrer">打开来源</a></p>)}</div><div className="source-gate-list"><p><b>天气接口申请入口</b><span style={{ color: readinessColor[OFFICIAL_SOURCE_REGISTRY.weather.readiness] }}>待配置</span><small>完成官方接口申请后，将凭据放入本地环境变量，不写入源码。</small><a href={OFFICIAL_SOURCE_REGISTRY.weather.url} target="_blank" rel="noreferrer">查看申请说明</a></p></div></article></div>}
      {feedback && <p className="hub-feedback">{feedback}<button onClick={() => setFeedback("")}><X size={14} /></button></p>}
    </div>
  </section>;
}
