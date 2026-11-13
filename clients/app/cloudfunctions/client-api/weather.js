// MET Norway worldwide forecast, attributed CC BY 4.0. No GPS required.
const SOURCE = 'https://api.met.no/doc/TermsOfService';
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const cache = new Map(), pending = new Map();
let retryAfter = 0, lastRequest = 0, consecutiveFailures = 0;

function currentForecast(entry, now = Date.now()) {
  const time = Date.parse(entry?.result?.weather?.observedAt);
  return Number.isFinite(time) && time >= now - 3600000 && time <= now + 7200000;
}

function scheduleRetry(response) {
  consecutiveFailures = Math.min(consecutiveFailures + 1, 7);
  const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, 15_000 * 2 ** (consecutiveFailures - 1));
  const retryHeader = response?.headers?.get('retry-after');
  const headerDelay = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader)
    ? Number(retryHeader) * 1000
    : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
  const retryAfterDelay = Number.isFinite(headerDelay)
    ? Math.max(0, Math.min(MAX_RETRY_DELAY_MS, headerDelay)) : 0;
  const statusDelay = [403, 429].includes(response?.status) ? 60_000 : 0;
  retryAfter = Date.now() + Math.max(exponentialDelay, retryAfterDelay, statusDelay);
}

function cacheExpiry(headers, now = Date.now()) {
  const value = headers.get('expires');
  if (value === null) return now + DEFAULT_CACHE_TTL_MS;
  const parsed = Date.parse(value);
  // A malformed or already-expired provider directive must not be extended.
  return Number.isFinite(parsed) ? parsed : now;
}

async function readBoundedJson(response) {
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESPONSE_BYTES) throw new Error('schema');
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('schema');
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('schema');
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
}

exports.forecast = async (data, reserveProviderRequest = async () => {}) => {
  const { latitude, longitude } = data;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('请提供有效路线坐标');
  const lat = latitude.toFixed(2), lon = longitude.toFixed(2), key = `${lat},${lon}`;
  const prior = cache.get(key);
  try {
    if (prior && prior.expiresAt > Date.now() && currentForecast(prior)) return prior.result;
    let task = pending.get(key);
    if (!task) {
      if (Date.now() < retryAfter || Date.now() - lastRequest < 250) throw new Error('backoff');
      lastRequest = Date.now();
      task = (async () => {
        let response;
        try {
          // Count only cache misses that will contact MET Norway. Cached and
          // same-key coalesced requests must not consume the provider budget.
          await reserveProviderRequest();
          const headers = { 'User-Agent': 'HikingEarth/0.2 (https://github.com/hiking-earth/clients; support: 2308582955@qq.com)', Accept: 'application/json' };
          // We store one selected forecast slot, not the complete timeseries.
          // Once that slot ages out, request a body so a new slot can be chosen.
          if (prior?.modified && currentForecast(prior)) headers['If-Modified-Since'] = prior.modified;
          response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
          const providerNotice = response.status === 203
            ? '天气服务提示当前接口版本正在弃用；请留意应用更新。'
            : '';
          if (providerNotice) console.warn('MET forecast provider announced a deprecation notice');
          const expiresAt = cacheExpiry(response.headers);
          if (response.status === 304 && prior && currentForecast(prior)) {
            consecutiveFailures = 0;
            retryAfter = 0;
            const cacheExpiresAt = new Date(expiresAt).toISOString();
            return { ...prior, expiresAt, result: { ...prior.result, cacheExpiresAt } };
          }
          if (!response.ok) throw new Error('provider');
          const payload = await readBoundedJson(response);
          const point = payload?.properties?.timeseries?.find(p => typeof p.time === 'string' && Date.parse(p.time) >= Date.now()-3600000 && Date.parse(p.time) <= Date.now()+7200000);
          const details = point?.data?.instant?.details;
          if (!details || ![details.air_temperature, details.wind_speed, details.relative_humidity].every(Number.isFinite)
              || details.air_temperature < -100 || details.air_temperature > 70 || details.wind_speed < 0 || details.wind_speed > 150
              || details.relative_humidity < 0 || details.relative_humidity > 100) throw new Error('schema');
          const rain = point.data.next_1_hours?.details?.precipitation_amount;
          if (rain !== undefined && (!Number.isFinite(rain) || rain < 0 || rain > 1000)) throw new Error('schema');
          consecutiveFailures = 0;
          retryAfter = 0;
          return { expiresAt, modified: response.headers.get('last-modified') || '', result: {
            status: 'available', provider: 'MET Norway', license: 'CC BY 4.0', sourceUrl: SOURCE, type: 'forecast',
            cacheExpiresAt: new Date(expiresAt).toISOString(),
            ...(providerNotice ? { providerNotice } : {}),
            weather: { city: key, temperature: `${details.air_temperature} °C`, wind: `${details.wind_speed} m/s`,
              humidity: `${details.relative_humidity}%`, rain: Number.isFinite(rain) ? `${rain} mm / 下一小时` : '暂无逐小时预报',
              observedAt: point.time, fetchedAt: new Date().toISOString() },
          } };
        } catch (error) {
          scheduleRetry(response);
          throw error;
        }
      })();
      pending.set(key, task);
    }
    try {
      const entry = await task;
      if (entry.expiresAt > Date.now()) {
        if (cache.size >= 512 && !cache.has(key)) cache.delete(cache.keys().next().value);
        cache.set(key, entry);
      } else cache.delete(key);
      return entry.result;
    } finally { pending.delete(key); }
  } catch(error) {
    // No request headers, credentials or coordinates in diagnostic logs.
    console.warn('MET forecast unavailable', { reason: ['backoff','provider','schema'].includes(error.message) ? error.message : error.name });
    return { status: 'unavailable', message: '天气预报暂不可用，请查属地预警后再出发。', sourceUrl: SOURCE };
  }
};
