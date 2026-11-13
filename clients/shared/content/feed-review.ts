/** Keep client-visible official notices bound to the exact manually reviewed feed configuration. */
const REVIEWED_FIELDS = [
  'label', 'region', 'center', 'url', 'articleHosts', 'format', 'reuse',
  'evidenceUrl', 'licenseEvidenceUrl', 'titleKeywords', 'includeCategoriesInTitle',
] as const;

type FeedSource = Record<string, unknown>;

export function hasCurrentOfficialFeedReview(source: FeedSource, now = new Date()): boolean {
  if (!source || source.feedAcceptance !== 'accepted') return false;
  if (typeof source.feedVerifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.feedVerifiedAt)) return false;
  const verifiedAt = new Date(`${source.feedVerifiedAt}T00:00:00.000Z`);
  if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt.toISOString().slice(0, 10) !== source.feedVerifiedAt) return false;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = (todayUtc - verifiedAt.getTime()) / 86_400_000;
  if (ageDays < 0 || ageDays > 90) return false;

  const expected: Record<string, unknown> = {};
  for (const field of REVIEWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) expected[field] = source[field];
  }
  const reviewed = source.feedReview;
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) return false;
  const actual = reviewed as Record<string, unknown>;
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return expectedKeys.length === actualKeys.length
    && expectedKeys.every((key, index) => key === actualKeys[index] && JSON.stringify(expected[key]) === JSON.stringify(actual[key]));
}
