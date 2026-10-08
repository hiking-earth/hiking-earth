const TAGS: Array<[string, string, boolean]> = [
  ['ref', '路线编号', false],
  ['network', '步道网络', false],
  ['operator', '维护单位', false],
  ['distance', '距离', true],
  ['ascent', '爬升', true],
  ['descent', '下降', true],
  ['difficulty', '难度', true],
  ['access', 'access 原值（不代表当前许可）', true],
  ['description', '来源描述（未经核验）', true],
  ['website', '来源标注网址（未经核验）', true],
];

function plainTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
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
