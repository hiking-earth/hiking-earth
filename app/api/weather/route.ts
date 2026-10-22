import { NextRequest, NextResponse } from "next/server";
import { isCurrentForecastTime } from "@/data/weather-gear-advice";
const SOURCE = "https://api.met.no/doc/TermsOfService";
const MAX_PROXY_RESPONSE_BYTES = 256 * 1024;
type Weather = { city: string; temperature: string; wind: string; humidity: string; rain: string; observedAt: string; fetchedAt: string };
type Entry = { weather: Weather; expires: number; cacheExpiresAt?: string; providerNotice?: string };
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PROXY_RESPONSE_BYTES) throw new Error("response_size");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response_body");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROXY_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("response_size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
let retryAfter = 0;
let lastRequest = 0;
let consecutiveFailures = 0;
const MAX_RETRY_DELAY = 15 * 60 * 1000;
function scheduleRetry(response?: Response) {
  consecutiveFailures = Math.min(consecutiveFailures + 1, 7);
  const exponentialDelay = Math.min(MAX_RETRY_DELAY, 15_000 * 2 ** (consecutiveFailures - 1));
  const retryHeader = response?.headers.get("retry-after");
  const parsedDelay = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader)
    ? Number(retryHeader) * 1000
    : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
  const upstreamDelay = Number.isFinite(parsedDelay) ? Math.max(0, Math.min(MAX_RETRY_DELAY, parsedDelay)) : 0;
  retryAfter = Date.now() + Math.max(exponentialDelay, upstreamDelay);
}
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
    if (!entry || entry.expires <= Date.now() || !isCurrentForecastTime(entry.weather.observedAt)) {
      let job = pending.get(key);
      if (!job) {
        if (Date.now() < retryAfter || Date.now() - lastRequest < 250) throw new Error("backoff");
        lastRequest = Date.now();
        job = (async () => {
          let response: Response | undefined;
          try {
            // CloudBase runs the attributed provider request; edge egress to MET can fail.
            response = await fetch("https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "weather.forecast", data: { latitude: Number(latitude), longitude: Number(longitude) } }),
              signal: AbortSignal.timeout(15000), redirect: "manual", cache: "no-store",
            });
            if (!response.ok) throw new Error("provider_http_"+response.status);
            const payload:unknown=await readBoundedJson(response);
            if(!isRecord(payload)||payload.ok!==true||!isRecord(payload.data))throw new Error("schema");
            const result=payload.data, weather=result.weather;
            if (isRecord(weather) && weather.fetchedAt === undefined) {
              // Older deployed CloudBase functions omit fetchedAt even when they
              // return a valid, fresh forecast. Record when this trusted proxy
              // received that response; observedAt and all forecast fields are
              // still validated below.
              weather.fetchedAt = new Date().toISOString();
            }
            const providerExpiry = typeof result?.cacheExpiresAt === "string" ? Date.parse(result.cacheExpiresAt) : Number.NaN;
            const providerNotice = typeof result?.providerNotice === "string" && result.providerNotice.length <= 200
              ? result.providerNotice : undefined;
            if (result.status !== "available" || result.provider !== "MET Norway"
                || result.license !== "CC BY 4.0" || !weather
                || !isRecord(weather) || weather.city !== key
                || ![weather.city, weather.temperature, weather.wind, weather.humidity, weather.rain]
                  .every(v => typeof v === "string" && v.length < 100)
                || typeof weather.fetchedAt !== "string" || !Number.isFinite(Date.parse(weather.fetchedAt))
                || Date.parse(weather.fetchedAt) > Date.now() + 5 * 60 * 1000
                || !isCurrentForecastTime(weather.observedAt)) throw new Error("schema");
            consecutiveFailures = 0;
            retryAfter = 0;
            const cacheExpiresAt = Number.isFinite(providerExpiry) ? result.cacheExpiresAt as string : undefined;
            const expires = Math.min(Date.now() + 10 * 60 * 1000, Number.isFinite(providerExpiry) ? providerExpiry : Date.now() + 60000);
            return { weather: weather as Weather, expires, cacheExpiresAt, providerNotice };
          } catch (error) {
            scheduleRetry(response);
            throw error;
          }
        })();
        pending.set(key, job);
      }
      try {
        entry = await job;
        if (cache.size >= 512 && !cache.has(key)) cache.delete(cache.keys().next().value!);
        if (entry.expires > Date.now()) cache.set(key, entry);
        else cache.delete(key);
      } finally { pending.delete(key); }
    }
    const maxAge = Math.max(1, Math.min(600, Math.floor((entry.expires - Date.now()) / 1000)));
    return NextResponse.json({ status: "available", weather: entry.weather, ...(entry.cacheExpiresAt ? { cacheExpiresAt: entry.cacheExpiresAt } : {}), ...(entry.providerNotice ? { providerNotice: entry.providerNotice } : {}), sourceUrl: SOURCE, provider: "MET Norway",
      license: "CC BY 4.0", type: "forecast" }, { headers: { "cache-control": entry.expires > Date.now() ? `private, max-age=${maxAge}` : "private, no-store" } });
  } catch (error) {
    console.warn("weather proxy unavailable", { reason: error instanceof Error ? error.name + ":" + error.message.replace(/https?:\/\/[^\s]+/g,"[upstream]").slice(0,180) : "unknown" });
    const retrySeconds = Math.max(1, Math.ceil((retryAfter - Date.now()) / 1000));
    return NextResponse.json({ status: "unavailable", message: "天气预报暂不可用，请查属地预警后再出发。", sourceUrl: SOURCE },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": String(retrySeconds) } });
  }
}
