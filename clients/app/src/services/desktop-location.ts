import type { TrackPoint } from '@shared/types/track';
import { isDesktop } from '@/services/desktop';
type Snapshot = { point: TrackPoint | null; error: string | null };
type Invoke = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
let serial = 0;
/** System location only: no IP-derived or fabricated fix. */
export function watchDesktopLocation(onPoint: (point: TrackPoint) => void, onError: (message: string) => void): () => void {
  if (!isDesktop()) throw new Error('当前平台不是桌面客户端');
  const invoke = (window as unknown as { __TAURI__: { core: { invoke: Invoke } } }).__TAURI__.core.invoke;
  return watchSystemLocation(invoke, onPoint, onError);
}
/** Injectable transport makes native cancellation verifiable without GPS hardware. */
export function watchSystemLocation(invoke: Invoke, onPoint: (point: TrackPoint) => void, onError: (message: string) => void): () => void {
  const session = `${Date.now()}-${++serial}`;
  let stopped = false, firstFix = false, lastTimestamp = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + 30000;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    void invoke('desktop_location_stop', { session }).catch(() => {});
  };
  const fail = (message: string) => { if (!stopped) { stop(); onError(message); } };
  const poll = async () => {
    if (stopped) return;
    try {
      const value = await invoke<Snapshot>('desktop_location_read', { session });
      if (stopped) return;
      if (value.error) { fail(value.error); return; }
      const point = value.point;
      if (point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
          && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
          && Number.isFinite(point.timestamp) && point.timestamp > lastTimestamp
          && point.timestamp <= Date.now() + 1000 && Date.now() - point.timestamp <= 30000) {
        firstFix = true; lastTimestamp = point.timestamp; onPoint(point);
      }
      if ((!firstFix && Date.now() >= deadline) || (firstFix && Date.now() - lastTimestamp > 60000)) {
        fail('系统定位超时，请检查定位服务及应用权限后重试'); return;
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    } catch { fail('无法读取系统位置，请检查定位服务后重试'); }
  };
  void invoke('desktop_location_start', { session }).then(() => {
    if (stopped) { void invoke('desktop_location_stop', { session }).catch(() => {}); return; }
    void poll();
  }).catch(() => fail('无法启动系统定位，请检查应用权限后重试'));
  return stop;
}
