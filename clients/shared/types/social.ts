/**
 * 社交 / 安全 / 导购数据模型（客户端自有，对应云开发集合）
 */

/** 组队成员实时位置（敏感个人信息，需明示授权） */
export type TeamMember = {
  teamId: string;
  openid: string;
  nickname: string;
  avatarUrl?: string;
  latitude: number | null;
  longitude: number | null;
  updatedAt: number;
  isLeader: boolean;
};

export type Team = {
  id: string;
  name: string;
  routeId?: string;
  createdBy: string;
  createdAt: number;
  /** 邀请码（6 位） */
  inviteCode: string;
  active: boolean;
};

/** SOS 事件：一键求救，上报位置给紧急联系人和队友 */
export type SosEvent = {
  id: string;
  openid: string;
  latitude: number;
  longitude: number;
  message?: string;
  triggeredAt: number;
  resolvedAt?: number;
  status: "active" | "resolved";
};

/** 约伴帖（UGC，发布前过内容安全机审） */
export type CompanionPost = {
  id: string;
  openid: string;
  nickname: string;
  routeId?: string;
  title: string;
  content: string;
  /** 计划出发日期 YYYY-MM-DD */
  departDate: string;
  /** 计划人数上限 */
  maxMembers: number;
  /** 已报名 openid 列表 */
  members: string[];
  /** Public listing includes only the current user in members. */
  memberCount?: number;
  createdAt: number;
  status: "open" | "full" | "closed" | "deleted" | "pending" | "hidden";
};

/** 装备导购条目（个人主体导购模式，跳第三方成交） */
export type GuideItem = {
  id: string;
  title: string;
  category: "鞋靴" | "背包" | "服装" | "露营" | "导航" | "应急" | "其他";
  summary: string;
  image: string;
  /** 第三方跳转链接（淘宝/京东联盟等） */
  link: string;
  /** 商家/联盟来源标记；只有官方授权接口返回的来源才能标为对应平台。 */
  sourcePlatform?: "taobao" | "jd" | "pdd" | "xianyu" | "other" | "unknown";
  priceHint?: string;
  /** 可选的商品/推广信息有效期；到期后公开列表自动隐藏。 */
  expiresAt?: number;
};
