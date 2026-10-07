import { NextRequest, NextResponse } from "next/server";
const SOURCE = "https://api.met.no/doc/TermsOfService";
type Weather = { city: string; temperature: string; wind: string; humidity: string; rain: string; observedAt: string };
type Entry = { weather: Weather; expires: number; modified: string };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
let retryAfter = 0;
let lastRequest = 0;
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const latText = params.get("latitude") ?? "", lonText = params.get("longitude") ?? "";
  const decimal = /^-?\d+(?:\.\d+)?$/;
  const lat = Number(latText), lon = Number(lonText);
  if (params.has("cityId") || params.getAll("latitude").length !== 1 || params.getAll("longitude").length !== 1
      || !decimal.test(latText) || !decimal.test(lonText) || !Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ status: "unavailable", message: "请提供有效的路线坐标。" }, { status: 400 });
  }
  // Coarse coordinates reduce location disclosure and consolidate nearby requests.
  const latitude = lat.toFixed(2), longitude = lon.toFixed(2), key = `${latitude},${longitude}`;
  const previous = cache.get(key);
  try {
    let entry = previous;
    if (!entry || entry.expires <= Date.now()) {
      let job = pending.get(key);
      if (!job) {
        if (Date.now() < retryAfter || Date.now() - lastRequest < 250) throw new Error("backoff");
        lastRequest = Date.now();
        job = (async () => {
          const headers: Record<string, string> = {
            "User-Agent": "HikingEarth/0.2 https://github.com/hiking-earth/clients", "Accept": "application/json",
          };
          if (previous?.modified) headers["If-Modified-Since"] = previous.modified;
          const response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude}&lon=${longitude}`,
            { headers, signal: AbortSignal.timeout(10000), redirect: "error" });
          if (response.status === 429 || response.status === 403) {
            const seconds = Number(response.headers.get("retry-after"));
            retryAfter = Date.now() + Math.max(60000, Math.min(86400000, Number.isFinite(seconds) ? seconds * 1000 : 60000));
          }
          const expires = Math.max(Date.now() + 60000, Date.parse(response.headers.get("expires") ?? "") || Date.now() + 3600000);
          if (response.status === 304 && previous) return { ...previous, expires };
          if (!response.ok) throw new Error("provider");
          const payload: any = await response.json();
          const point = payload?.properties?.timeseries?.find((p: { time?: string }) =>
            typeof p.time === "string" && Date.parse(p.time) >= Date.now() - 3600000);
          const details = point?.data?.instant?.details;
          if (!details || ![details.air_temperature, details.wind_speed, details.relative_humidity].every(Number.isFinite)
              || !Number.isFinite(Date.parse(point.time))) throw new Error("schema");
          const rain = point.data.next_1_hours?.details?.precipitation_amount;
          const weather: Weather = { city: `${latitude}, ${longitude}`, temperature: `${details.air_temperature} °C`,
            wind: `${details.wind_speed} m/s`, humidity: `${details.relative_humidity}%`,
            rain: Number.isFinite(rain) ? `${rain} mm / 下一小时` : "暂无逐小时预报", observedAt: point.time };
          return { weather, expires, modified: response.headers.get("last-modified") ?? "" };
        })();
        pending.set(key, job);
      }
      try {
        entry = await job;
        if (cache.size >= 512 && !cache.has(key)) cache.delete(cache.keys().next().value!);
        cache.set(key, entry);
      } finally { pending.delete(key); }
    }
    return NextResponse.json({ status: "available", weather: entry.weather, sourceUrl: SOURCE, provider: "MET Norway",
      license: "CC BY 4.0", type: "forecast" }, { headers: { "cache-control": "public, max-age=60" } });
  } catch {
    return NextResponse.json({ status: "unavailable", message: "天气预报暂不可用，请查属地预警后再出发。", sourceUrl: SOURCE },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } });
  }
}
