/** Foreground location and compass subscriptions, with immediate consent revocation. */
import type { TrackPoint } from "@shared/types/track";
import { HeadingFilter } from "@shared/api/navigation-core";
import { hasPrivacyConsent, onPrivacyChange } from "@/services/privacy";
import { isDesktop } from '@/services/desktop';
import { watchDesktopLocation } from '@/services/desktop-location';

declare const plus: any;
let nativeWatch: number | undefined;

export type LocationCallback = (p: TrackPoint) => void;
export type HeadingCallback = (deg: number) => void;
type Purpose = "navigation" | "team";
const locations = new Map<LocationCallback, Purpose>();
const headings = new Set<HeadingCallback>();
const filter = new HeadingFilter(0.2);
let running = false;
let compassRunning = false;
let generation = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let pending: Promise<boolean> | undefined;
let settle: ((ok: boolean) => void) | undefined;
let stopDesktop: (() => void) | undefined;
let locationError = '';
const failureListeners = new Set<(message: string) => void>();
export function getLocationError(): string { return locationError; }
export function onLocationFailure(cb: (message: string) => void): () => void {
  failureListeners.add(cb); return () => { failureListeners.delete(cb); };
}

function allowed(purpose: Purpose): boolean {
  return hasPrivacyConsent("location") && (purpose !== "team" || hasPrivacyConsent("teamLocation"));
}
function deliver(res: any) {
  if(!res || !Number.isFinite(res.latitude) || Math.abs(res.latitude)>90 || !Number.isFinite(res.longitude) || Math.abs(res.longitude)>180)return;
  const optional=(value:unknown,nonnegative=false):number|undefined=>typeof value==='number'&&Number.isFinite(value)&&(!nonnegative||value>=0)?value:undefined;
  const point: TrackPoint = {
    latitude: res.latitude, longitude: res.longitude,
    altitude: optional(res.altitude), speed: optional(res.speed,true),
    accuracy: optional(res.horizontalAccuracy ?? res.accuracy,true), timestamp: optional(res.timestamp,true) ?? Date.now(),
  };
  locations.forEach((purpose, cb) => { if (allowed(purpose)) { try { cb({...point}); } catch { /* One view must not interrupt other subscribers. */ } } });
}
const locationListener = (res: any) => { if (running) deliver(res); };
const compassListener = (res: any) => {
  if (!compassRunning || !hasPrivacyConsent("location")) return;
  if(!res || !Number.isFinite(res.direction) || res.direction<0 || res.direction>360)return;
  const value = filter.push(res.direction===360?0:res.direction);
  headings.forEach((cb) => { try { cb(value); } catch { /* Keep other consumers receiving headings. */ } });
};
function shutdown() {
  generation++;
  running = false;
  stopDesktop?.();
  stopDesktop = undefined;
  // #ifdef APP-PLUS
  if (nativeWatch !== undefined) { try { plus.geolocation.clearWatch(nativeWatch); } catch { /* Internal revocation still completes. */ } }
  nativeWatch = undefined;
  // #endif
  if (pollTimer !== undefined) clearInterval(pollTimer);
  pollTimer = undefined;
  try { uni.offLocationChange?.(locationListener); } catch { /* The listener already rejects revoked updates. */ }
  try { uni.stopLocationUpdate?.({ complete: () => {} }); } catch { /* Settle pending consumers even if the platform stop throws. */ }
  settle?.(false);
  settle = undefined;
  pending = undefined;
}

export async function startLocationUpdates(cb: LocationCallback, purpose: Purpose = "navigation"): Promise<boolean> {
  if (!allowed(purpose)) return false;
  locationError = '';
  locations.set(cb, purpose);
  if (running) return true;
  if (!pending) {
    const epoch = ++generation;
    const operation = new Promise<boolean>((resolve) => {
      settle = resolve;
      const valid = () => epoch === generation && locations.size > 0;
      const finish = (ok: boolean) => {
        if (!valid()) { resolve(false); return; }
        running = ok;
        if (!ok) locations.clear();
        resolve(ok);
      };
      const poll = () => {
        if (!valid()) return;
        try { uni.getLocation({
          type: "wgs84",
          success: (res: any) => { if (valid()) deliver(res); },
          fail: () => { if (valid()) { locations.clear(); shutdown(); } },
        }); } catch { if (valid()) { locations.clear(); shutdown(); } }
      };
      const fallback = () => {
        try { uni.getLocation({
          type: "wgs84",
          success: (res: any) => {
            if (!valid()) { resolve(false); return; }
            finish(true);
            deliver(res);
            if (valid()) pollTimer = setInterval(poll, 3000);
          },
          fail: () => finish(false),
        }); } catch { finish(false); }
      };
      try {
      // #ifdef H5
      if (isDesktop()) {
        stopDesktop = watchDesktopLocation(res => {
          if (!valid()) return;
          if (!running) finish(true);
          deliver(res);
        }, message => {
          if (!valid()) return;
          locationError = message;
          finish(false); locations.clear(); shutdown();
          failureListeners.forEach(cb => { try { cb(message); } catch { /* Isolate views. */ } });
        });
        return;
      }
      // #endif
      // #ifdef APP-PLUS
      nativeWatch = plus.geolocation.watchPosition((res: any) => {
        if (!valid()) return;
        if (!running) finish(true);
        deliver({ ...res.coords, horizontalAccuracy: res.coords.accuracy });
      }, () => { if (valid()) { finish(false); locations.clear(); shutdown(); } }, {
        provider: 'system', coordsType: 'wgs84', geocode: false,
        enableHighAccuracy: true, timeout: 15000, maximumAge: 1000,
      });
      return;
      // #endif
      if (typeof uni.startLocationUpdate !== "function") { fallback(); return; }
      uni.startLocationUpdate({
        type: "wgs84",
        success: () => {
          if (!valid()) {
            // A newer start owns the platform stream; never stop it here.
            if (!running && !pending) { try { uni.stopLocationUpdate?.({ complete: () => {} }); } catch { /* The canceled start remains revoked. */ } }
            resolve(false);
            return;
          }
          try { uni.onLocationChange(locationListener); }
          catch { finish(false); shutdown(); return; }
          finish(true);
        },
        fail: (err: any) => {
          if (!valid()) { resolve(false); return; }
          // Permission denial must not be treated as a successful start.
          if (/not support|not implemented|不支持/i.test(err?.errMsg ?? "")) fallback();
          else finish(false);
        },
      });
      } catch { finish(false); }
    });
    pending = operation;
    void operation.then(() => {
      if (pending === operation) { pending = undefined; settle = undefined; }
    });
  }
  const ok = await pending;
  return !!ok && locations.has(cb) && allowed(purpose);
}

export function stopLocationUpdates(cb?: LocationCallback): void {
  if (cb) locations.delete(cb);
  else locations.clear();
  if (!locations.size) shutdown();
}
export function startCompass(cb: HeadingCallback): void {
  if (!hasPrivacyConsent("location")) return;
  headings.add(cb);
  if (compassRunning) return;
  compassRunning = true;
  filter.reset();
  uni.onCompassChange(compassListener);
}
export function stopCompass(cb?: HeadingCallback): void {
  if (cb) headings.delete(cb);
  else headings.clear();
  if (!headings.size && compassRunning) {
    compassRunning = false;
    try { uni.offCompassChange?.(compassListener); } catch { /* Late events are rejected by compassRunning. */ }
  }
}
onPrivacyChange(() => {
  locations.forEach((purpose, cb) => { if (!allowed(purpose)) locations.delete(cb); });
  if (!locations.size) shutdown();
  if (!hasPrivacyConsent("location")) stopCompass();
});
