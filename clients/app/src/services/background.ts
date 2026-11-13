import { hasPrivacyConsent, onPrivacyChange } from '@/services/privacy';
import {validTrackPoint} from '@shared/types/track';
import type { TrackPoint } from '@shared/types/track';
// #ifdef APP-PLUS
import { startBackground, stopBackground, backgroundBuffer, acknowledgeBackground } from '@/uni_modules/hiking-background';
// #endif
let running = false;let generation=0;
export function backgroundSupported(): boolean {
  // #ifdef APP-PLUS
  return true;
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}
export function beginBackground(owner: string, session: string, changed: () => void, error: (message: string) => void): boolean {
  if (!backgroundSupported() || !hasPrivacyConsent('location') || !hasPrivacyConsent('backgroundLocation')) return false;
  if (!owner || owner.length > 128) return false;
  // #ifdef APP-PLUS
  const epoch=++generation;let failed=false;
  try { const started=startBackground(owner, session, ()=>{if(epoch===generation)changed();}, message => { if(epoch!==generation)return;failed=true;running = false; error(message); });running=epoch===generation&&started&&!failed; }
  catch { running = false; error('当前安装包未包含后台定位模块，请使用前台记录'); }
  // #endif
  return running;
}
export function stopBackgroundRecording(): void {
  generation++;
  // #ifdef APP-PLUS
  try { stopBackground(); } catch {}
  // #endif
  running = false;
}
export function backgroundRecording(): boolean { return running; }
export function pendingBackground(owner: string, expectedSession = ''): { session: string; points: TrackPoint[]; invalid: boolean } {
  if (!owner || owner.length > 128) return { session: '', points: [], invalid: false };
  // #ifdef APP-PLUS
  try {
    const value = JSON.parse(backgroundBuffer(owner, expectedSession));
    if (!value || typeof value !== 'object' || value.invalid === true || value.owner !== owner || typeof value.session !== 'string'
      || !Array.isArray(value.points) || value.points.length > 10000
      || !value.points.every((point: unknown) => validTrackPoint(point) && point.timestamp <= Date.now() + 30000))
      return { session: typeof value?.session === 'string' ? value.session : '', points: [], invalid: true };
    return { session: value.session, points: [...value.points].sort((a: TrackPoint, b: TrackPoint) => a.timestamp - b.timestamp), invalid: false };
  } catch { return { session: '', points: [], invalid: true }; }
  // #endif
  return { session: '', points: [], invalid: false };
}
export function acknowledgeBackgroundPoints(owner: string, timestamp: number): boolean {
  if (!owner || owner.length > 128) return false;
  if(!Number.isFinite(timestamp)||timestamp<=0)return false;
  // #ifdef APP-PLUS
  try { return acknowledgeBackground(owner,timestamp)===true; } catch { return false; }
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}
onPrivacyChange(consents => { if (!consents.location || !consents.backgroundLocation) stopBackgroundRecording(); });
