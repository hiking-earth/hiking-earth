import { NextRequest, NextResponse } from "next/server";

const OFFICIAL_WEATHER_BASE = "https://www.weather.com.cn/adat/sk/";

type OfficialWeatherPayload = {
  weatherinfo?: {
    city?: string;
    cityid?: string;
    temp?: string;
    WD?: string;
    WS?: string;
    SD?: string;
    time?: string;
    rain?: string;
  };
};

export async function GET(request: NextRequest) {
  const cityId = request.nextUrl.searchParams.get("cityId") ?? "";
  if (!/^\d{9}$/.test(cityId)) {
    return NextResponse.json({ status: "unavailable", message: "缺少有效的中国天气网城市编码。" }, { status: 400 });
  }

  try {
    const response = await fetch(`${OFFICIAL_WEATHER_BASE}${cityId}.html`, {
      headers: { accept: "application/json", "user-agent": "HikingEarth-local-preview/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`official weather status ${response.status}`);
    const payload = await response.json() as OfficialWeatherPayload;
    const info = payload.weatherinfo;
    if (!info?.city || !info.temp || !info.time) throw new Error("official weather payload incomplete");

    return NextResponse.json({
      status: "available",
      source: "中国天气网官方公开实况",
      sourceUrl: `${OFFICIAL_WEATHER_BASE}${cityId}.html`,
      fetchedAt: new Date().toISOString(),
      weather: {
        city: info.city,
        cityId: info.cityid ?? cityId,
        temperature: `${info.temp}℃`,
        wind: [info.WD, info.WS].filter(Boolean).join(" ") || "暂无",
        humidity: info.SD ? `${info.SD}` : "暂无",
        rain: info.rain ? `${info.rain} mm` : "暂无",
        observedAt: info.time,
      },
    }, { headers: { "cache-control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({
      status: "unavailable",
      message: "官方天气暂时无法核实，请打开中国天气网来源页查看；页面不会用旧数据冒充实时天气。",
      sourceUrl: `${OFFICIAL_WEATHER_BASE}${cityId}.html`,
    }, { status: 503 });
  }
}
