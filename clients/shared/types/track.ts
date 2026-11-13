/**
 * GPS 轨迹记录数据模型（客户端自有）
 * 坐标统一存 WGS84（uni.getLocation 默认 type:'wgs84'），渲染腾讯地图时转 GCJ-02。
 */

export type TrackPoint = {
  /** 暂停或中断后的新段起点，避免跨段连线 */
  segmentStart?: boolean;
  /** 导入文件缺少时间时不将本机占位时间导出成实测数据 */
  timeEstimated?: boolean;
  /** 纬度（WGS84） */
  latitude: number;
  /** 经度（WGS84） */
  longitude: number;
  /** 海拔（米），可能不可用 */
  altitude?: number;
  /** 速度（m/s） */
  speed?: number;
  /** 定位精度（米） */
  accuracy?: number;
  /** 采样时间戳（ms） */
  timestamp: number;
};

export type TrackRecord = {
  id: string;
  /** 用户命名，默认按日期生成 */
  name: string;
  /** 关联路线 id（自由徒步则为空） */
  routeId?: string;
  points: TrackPoint[];
  /** 累计里程（米） */
  distanceM: number;
  /** 实际记录用时，不含暂停 */
  activeDurationMs?: number;
  /** 累计爬升（米） */
  ascentM: number;
  /** 累计下降（米） */
  descentM: number;
  /** 开始/结束时间戳（ms） */
  startedAt: number;
  endedAt?: number;
  /** 记录状态 */
  state: "recording" | "paused" | "finished";
  /** 是否已云同步 */
  synced: boolean;
  /** 创建或导入该本机轨迹时的账号身份；匿名轨迹为anonymous，旧版未标记轨迹需用户确认后才能转入账号 */
  localOwner?: string;
  /** 该云端版本所属的统一账号身份 */
  cloudOwner?: string;
  /** 用户当前账号下云端轨迹的乐观并发版本 */
  cloudVersion?: number;
};

/** GPX 导出的最小单元，保持与 TrackPoint 一对一 */
export function trackToGpx(track: TrackRecord): string {
  const trkpts = track.points
    .map((p, index) => {
      const time = p.timeEstimated ? "" : `<time>${new Date(p.timestamp).toISOString()}</time>`;
      const ele = p.altitude != null ? `<ele>${p.altitude.toFixed(1)}</ele>` : "";
      return `${index > 0 && p.segmentStart ? "    </trkseg>\n    <trkseg>\n" : ""}      <trkpt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}">${ele}${time}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hiking-earth-clients" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${escapeXml(track.name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Coordinates and optional sensor fields must be finite before recording. */
export function validTrackPoint(value:unknown):value is TrackPoint {
  const p=value as any;
  return !!p && Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90
    && Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180
    && Number.isFinite(p.timestamp) && p.timestamp>0 && p.timestamp<=8640000000000000
    && (p.altitude==null || Number.isFinite(p.altitude))
    && (p.speed==null || (Number.isFinite(p.speed)&&p.speed>=0))
    && (p.accuracy==null || (Number.isFinite(p.accuracy)&&p.accuracy>=0))
    && (p.segmentStart===undefined || typeof p.segmentStart==='boolean')
    && (p.timeEstimated===undefined || typeof p.timeEstimated==='boolean');
}
