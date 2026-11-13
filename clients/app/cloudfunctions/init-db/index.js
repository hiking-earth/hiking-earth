// init-db：一次性初始化数据库集合。部署后手动调用一次即可，调用完成后可删除本函数。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = [
  "user_libraries",
  "user_documents",
  "route_reviews",
  "route_access_audit_snapshots", // 定时路线访问风险与来源成员关系变更复核快照；仅可信云函数访问
  "team_messages",
  "user_notifications",
  "client_accounts",
  "client_account_merges", // 微信/手机号分裂账号的服务端锁定、分批迁移与续跑状态；客户端不可直读写
  "client_identity_registry", // 身份归属预检版本闸门；与身份变更处于同一事务
  "client_account_merge_library_archives", // 合并后超容量的收藏/行程原样保留；仅可信云函数可访问
  "client_wechat_identity_links",
  "client_phone_identity_links",
  "client_sessions",
  "client_qr_logins",
  "client_wechat_tickets",
  "client_rate_limits",
  "offline_map_requests", // 用户申请的免费自选区域地图，仅保存中心坐标、范围与构建状态
  "offline_map_request_limits", // 自选地图账号级24小时申请并发锁，worker清理过期锁
  "offline_map_queue_guard", // 自选地图并发入队串行闸门
  "offline_map_worker_status", // 最近一次经授权的免费地图构建worker心跳
  "community_reports",
  "companion_posts",  // 约伴帖（机审后发布）
  "teams",            // 组队
  "team_members",     // 队员实时位置（敏感个人信息，覆盖更新不留历史）
  "sos_events",       // 一键求救
  "tracks",           // 云同步轨迹（仅本人可读）
  "guide_items",      // 装备导购条目
];

exports.main = async () => {
  const results = [];
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      results.push(`${name}: 已创建`);
    } catch (e) {
      results.push(`${name}: ${e.message}`);
    }
  }
  return { results };
};
