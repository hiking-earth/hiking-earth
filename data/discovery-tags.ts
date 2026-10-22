const TAGS: Array<[string, string, boolean]> = [
  ['ref', '路线编号', false],
  ['network', '步道网络', false],
  ['operator', '维护单位', false],
  ['distance', '距离', true],
  ['distanceKm', '距离（km）', true],
  ['ascent', '爬升', true],
  ['descent', '下降', true],
  ['difficulty', '难度', true],
  ['estimatedTime', '预计时长', true],
  ['hasAlerts', '来源提示字段', true],
  ['nameFrench', '法语名称', true],
  ['alternateName', '其他名称', true],
  ['trailSystem', '步道系统名称', true],
  ['access', 'access 原值（不代表当前许可）', true],
  ['description', '来源描述（未经核验）', true],
  ['website', '来源标注网址（未经核验）', true],
];

function plainTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Source metadata may contain control bytes; strip them before display.
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 240) : undefined;
}

const NAME_REVIEW_PATTERN = /\b(?:fix\s*me|todo|unknown|unnamed|no\s+name)\b|check\s*&\s*complete/i;

/** Flag obvious source placeholders for human review without hiding the discovery record. */
export function discoveryNameReview(value: unknown): string[] {
  const name = plainTag(value);
  if (!name || !NAME_REVIEW_PATTERN.test(name)) return [];
  return ['来源名称包含 TODO、FIXME、unknown 等待办或占位标记；请核对原始路线记录后再补充正式资料。'];
}

const ACCESS_FIELDS = /(?:access|clos(?:e|ed|ure)|open|status|restrict(?:ion|ed)?|hiking|pedestrian)/i;
const NEGATIVE_ACCESS_KEYS = new Set(['hikingrestricted', 'closed', 'isclosed', 'accessdenied', 'restricted']);
const POSITIVE_ACCESS_KEYS = new Set(['hikingaccepted', 'pedestrianaccess', 'open', 'isopen']);
const NEGATIVE_ACCESS_VALUES = new Set([
  'closed', 'restricted', 'prohibited', 'forbidden', 'notpermitted', 'private',
  'blocked', 'denied', 'inactive', 'seasonalclosed', 'temporarilyclosed', 'underconstruction',
]);
const ACCESS_RESTRICTION_TEXT = /\b(closed|closure|restricted|prohibited|no access|not permitted|suspended|temporarily unavailable|hiking not allowed|cerrad[oa]s?|cierre|prohibid[oa]s?|acceso restringido|sin acceso|fermé|fermée|ferme|fermee|fermeture|interdit(?:e|s|es)?|accès restreint|accès interdit|geschlossen|gesperrt|sperrung|zugang verboten|chiuso|chiusa|chiusura|vietato|vietata|fechado|fechada|proibido|proibida|acesso restrito|gesloten|afgesloten|verboden|toegang beperkt|stengt|stängd|avstängd|zamknięty|zamknięta|zakaz wstępu)\b|закрыт[аоы]?|проход запрещ[её]н|закрыто для прохода|关闭|封闭|封閉|禁止通行|禁止進入|禁止进入|限制通行|暂停开放|暫停開放|暂不开放|暫不開放|不允许徒步|不允許徒步|通行止め|立入禁止|通行禁止|利用禁止|入山禁止|폐쇄|통행금지|출입금지|접근제한/i;

function normalizedAccessKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Flag source-provided closure/restriction clues for an administrator's review.
 * This is triage only: it never changes route access, status, or navigation.
 */
export function discoveryAccessReview(route: unknown): string[] {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return [];
  const row = route as Record<string, unknown>;
  const tags = row.sourceTags && typeof row.sourceTags === 'object' && !Array.isArray(row.sourceTags)
    ? row.sourceTags as Record<string, unknown>
    : {};
  const fields: Record<string, unknown> = { ...tags };
  for (const field of ['status', 'access', 'accessStatus', 'closure', 'closureStatus', 'restriction',
    'hikingAccess', 'pedestrianAccess', 'hikingRestricted', 'isClosed', 'isOpen', 'open', 'restricted', 'accessDenied']) {
    if (field in row && !(field in fields)) fields[field] = row[field];
  }
  const findings: string[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!ACCESS_FIELDS.test(field)) continue;
    const key = normalizedAccessKey(field);
    let negative = false;
    let display: string | undefined;
    if (typeof value === 'boolean') {
      negative = (NEGATIVE_ACCESS_KEYS.has(key) && value)
        || (POSITIVE_ACCESS_KEYS.has(key) && !value)
        || (['access', 'hikingaccess'].includes(key) && !value);
      display = String(value);
    } else if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (!text) continue;
      const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
      const falseMeansRestricted = POSITIVE_ACCESS_KEYS.has(key)
        || ['access', 'hikingaccess'].includes(key)
        || key.startsWith('accessstatus');
      negative = ACCESS_RESTRICTION_TEXT.test(text)
        || NEGATIVE_ACCESS_VALUES.has(normalized)
        || (falseMeansRestricted && ['no', 'false', '0'].includes(normalized))
        || (NEGATIVE_ACCESS_KEYS.has(key) && ['yes', 'true', '1'].includes(normalized));
      display = plainTag(text);
    }
    if (negative && display) findings.push(`来源访问限制信号待复核：${field}=${display}`);
    if (findings.length >= 8) break;
  }
  return findings;
}

/** Show source-contributed discovery tags as unverified clues, never as safety or access decisions. */
export function discoveryTagHighlights(value: unknown, sourceLabel = '来源'): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const tags = value as Record<string, unknown>;
  const highlights: string[] = [];
  for (const [key, label, unverified] of TAGS) {
    const content = plainTag(tags[key]);
    if (content) highlights.push(`${label}：${content}${unverified ? `（${sourceLabel}原值，待核验）` : ''}`);
  }
  return highlights;
}

export function discoveryTagValue(value: unknown, key: string, sourceLabel = '来源'): string {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? plainTag((value as Record<string, unknown>)[key])
    : undefined;
  return raw ? `${raw}（${sourceLabel}原值，待核验）` : '待核验';
}
