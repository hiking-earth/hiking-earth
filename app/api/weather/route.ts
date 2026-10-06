import { NextRequest, NextResponse } from "next/server";

const SMART_WEATHER_APPLICATION = "https://www.weather.com.cn/wzfw/smart/weatherapi.shtml";
const OFFICIAL_WEATHER_HOME = "https://www.weather.com.cn/";

export async function GET(request: NextRequest) {
  const cityId = request.nextUrl.searchParams.get("cityId") ?? "";
  if (!/^\d{9}$/.test(cityId)) {
    return NextResponse.json({ status: "unavailable", message: "缺少有效的天气服务城市编码。" }, { status: 400 });
  }

  // The old /adat/sk endpoint was not the project's approved SmartWeatherAPI
  // integration. Do not present an undocumented public endpoint as licensed,
  // stable, or suitable for hiking decisions. Enable a provider only after the
  // owner obtains the official API contract and the server is configured.
  return NextResponse.json({
    status: "unavailable",
    message: "正式天气接口尚未申请并配置。出发前请直接查看中国天气网及属地预警；本页不会用未授权数据冒充实况。",
    sourceUrl: OFFICIAL_WEATHER_HOME,
    applicationUrl: SMART_WEATHER_APPLICATION,
  }, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}
