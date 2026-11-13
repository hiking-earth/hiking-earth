import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { haversineM } from '@shared/api/navigation-core';
import type { TrackPoint, TrackRecord } from '@shared/types/track';

/** GPX import is local. Reject entity declarations and oversized input before parsing. */
export function importGpx(xml: string, now = Date.now()): TrackRecord {
  if (!xml || xml.length > 5 * 1024 * 1024) throw new Error('请选择不超过 5 MB 的 GPX 文件');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含实体声明的 GPX');
  if (XMLValidator.validate(xml) !== true) throw new Error('GPX XML 格式不正确');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false }).parse(xml);
  if (!parsed.gpx) throw new Error('文件不是 GPX 格式');
  const array = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v];
  const segments = array(parsed.gpx.trk).flatMap(t => array(t.trkseg).map(s => array(s.trkpt)));
  if (!segments.length) segments.push(...array(parsed.gpx.rte).map(r => array(r.rtept)));
  const points: TrackPoint[] = [];
  let distanceM = 0, ascentM = 0, descentM = 0;
  let activeDurationMs = 0;
  for (const segment of segments) {
    let last: TrackPoint | undefined;
    for (const raw of segment) {
      const latitude = Number(raw['@_lat']), longitude = Number(raw['@_lon']);
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('GPX 包含无效坐标');
      const timestamp = raw.time == null ? now + points.length * 1000 : Date.parse(String(raw.time));
      if (!Number.isFinite(timestamp) || (last && timestamp < last.timestamp)) throw new Error('GPX 时间无效或顺序倒置');
      const altitude = raw.ele == null ? undefined : Number(raw.ele);
      if (altitude != null && !Number.isFinite(altitude)) throw new Error('GPX 海拔无效');
      const p: TrackPoint = { latitude, longitude, timestamp, altitude, segmentStart: !last, timeEstimated: raw.time == null };
      if (last) {
        distanceM += haversineM(last, p);
        if (raw.time != null) activeDurationMs += p.timestamp - last.timestamp;
        if (last.altitude != null && p.altitude != null) {
          const delta = p.altitude - last.altitude;
          ascentM += Math.max(0, delta); descentM += Math.max(0, -delta);
        }
      }
      points.push(p); last = p;
      if (points.length > 20000) throw new Error('GPX 超过 20000 个点，请先简化轨迹');
    }
  }
  if (points.length < 2) throw new Error('GPX 至少需要两个轨迹点');
  const sourceName = array(parsed.gpx.trk)[0]?.name ?? array(parsed.gpx.rte)[0]?.name;
  return { id: `import-${now}-${Math.random().toString(36).slice(2, 8)}`, name: String(sourceName ?? '导入轨迹').slice(0, 60), points, distanceM, ascentM, descentM,
    activeDurationMs, startedAt: points[0].timestamp, endedAt: points[points.length - 1].timestamp, state: 'finished', synced: false };
}
