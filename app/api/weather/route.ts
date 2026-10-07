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
          // CloudBase runs the attributed provider request; edge egress to MET can fail.
          const response = await fetch("https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "weather.forecast", data: { latitude: Number(latitude), longitude: Number(longitude) } }),
            signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
          });
          if (!response.ok) throw new Error("provider");
          const payload = await response.json();
          const result = payload?.data, weather = result?.weather;
          if (payload?.ok !== true || result?.status !== "available" || result.provider !== "MET Norway"
              || result.license !== "CC BY 4.0" || !weather
              || ![weather.city, weather.temperature, weather.wind, weather.humidity, weather.rain]
                .every(v => typeof v === "string" && v.length < 100)
              || typeof weather.observedAt !== "string" || !Number.isFinite(Date.parse(weather.observedAt))) throw new Error("schema");
          return { weather: weather as Weather, expires: Date.now() + 60000, modified: "" };
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
