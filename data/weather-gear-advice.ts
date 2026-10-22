export type RouteWeatherValues = {
  temperature?: unknown;
  wind?: unknown;
  rain?: unknown;
  observedAt?: unknown;
};

export type WeatherGearAdvice = {
  available: boolean;
  items: string[];
  notices: string[];
};

const numberBefore = (value: unknown, unit: RegExp, min: number, max: number): number | null => {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = value.trim().match(unit);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

/** The provider may return the next forecast slot up to two hours ahead. */
export function isCurrentForecastTime(value: unknown, now = Date.now()): boolean {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp)
    && timestamp >= now - 60 * 60 * 1000
    && timestamp <= now + 2 * 60 * 60 * 1000;
}

/**
 * Adds conservative packing hints only when the coordinate forecast is recent
 * and its units match the service contract. It never infers route access or
 * replaces local warnings and current conditions.
 */
export function weatherGearAdvice(weather?: RouteWeatherValues | null, now = Date.now()): WeatherGearAdvice {
  if (!isCurrentForecastTime(weather?.observedAt, now)) {
    return { available: false, items: [], notices: [] };
  }

  const temperature = numberBefore(weather?.temperature, /^(-?\d+(?:\.\d+)?)\s*°?C$/i, -80, 65);
  const wind = numberBefore(weather?.wind, /^(\d+(?:\.\d+)?)\s*m\/s$/i, 0, 150);
  const rain = numberBefore(weather?.rain, /^(\d+(?:\.\d+)?)\s*mm(?:\s*\/.*)?$/i, 0, 1000);
  if (temperature === null && wind === null && rain === null) {
    return { available: false, items: [], notices: [] };
  }
  const items = new Set<string>();
  const notices: string[] = [];

  if (temperature !== null && temperature <= 5) {
    items.add('保暖中层、帽子和手套');
    items.add('应急保温毯');
    notices.push('路线坐标预报气温偏低；高海拔、风口和夜间可能更冷，请准备分层衣物并按体感调整。');
  }
  if (temperature !== null && temperature >= 28) {
    items.add('遮阳帽和防晒衣物');
    items.add('额外饮水与电解质补给');
    notices.push('路线坐标预报气温偏高；增加补水、避开最热时段，并留意中暑症状。');
  }
  if (rain !== null && rain >= 1) {
    items.add('防水外层与背包防雨保护');
    items.add('干燥备用袜和衣物');
    notices.push('坐标预报有降水；山地局地雨量可能不同，出发前核对属地强降雨、山洪和滑坡预警。');
  }
  if (wind !== null && wind >= 10) {
    items.add('防风外层');
    notices.push('路线坐标预报风力较强；暴露山脊和高处可能更危险，请核对现场及属地预警，必要时取消行程。');
  }
  if (!items.size) notices.push('当前坐标预报未触发额外装备规则；这不代表天气安全，请继续查看属地预警和现场情况。');

  return { available: true, items: [...items], notices };
}
