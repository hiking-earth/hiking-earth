"""Publish only traceable metadata links; expire freshness, not trail permission."""
import datetime as dt
import re
from urllib.parse import urlsplit

MAX_METADATA_AGE = dt.timedelta(days=90)
MAX_PUBLICATION_AGE = dt.timedelta(days=90)
MAX_FEED_VERIFICATION_AGE = dt.timedelta(days=90)
REVIEWED_FEED_FIELDS = ('label', 'region', 'center', 'url', 'articleHosts', 'format', 'reuse',
                        'evidenceUrl', 'licenseEvidenceUrl', 'titleKeywords', 'includeCategoriesInTitle')
SOURCE_STATE_HISTORY_FIELDS = ('lastSuccess', 'lastAttempt', 'lastError', 'lastCollectedCount',
                               'lastWithheldCount', 'lastExpiredCount', 'lastWithheldReasons')


def synchronize_source_states(registered_sources, previous_states):
    """Refresh source policy metadata without discarding operational history."""
    previous_by_id = {}
    for state in previous_states if isinstance(previous_states, list) else []:
        if isinstance(state, dict) and isinstance(state.get('id'), str):
            previous_by_id[state['id']] = state
    synchronized = []
    for source in registered_sources:
        if not isinstance(source, dict) or not isinstance(source.get('id'), str):
            continue
        state = dict(source)
        previous = previous_by_id.get(source['id'], {})
        for field in SOURCE_STATE_HISTORY_FIELDS:
            if field in previous:
                state[field] = previous[field]
        synchronized.append(state)
    return synchronized


def valid_https_evidence_url(value):
    try:
        parsed = urlsplit(value) if isinstance(value, str) and 0 < len(value) <= 2048 else None
        return (parsed is not None and parsed.scheme == 'https' and bool(parsed.hostname)
                and not parsed.username and not parsed.password and parsed.port is None)
    except ValueError:
        return False


def has_schema_version_1(value):
    return (isinstance(value, dict) and type(value.get('schemaVersion')) is int
            and value.get('schemaVersion') == 1)


def validate_official_source_registry(registry):
    """Fail closed on oversized or malformed approved-feed configuration."""
    if not has_schema_version_1(registry):
        raise ValueError('invalid official source registry schema')
    sources = registry.get('sources')
    if not isinstance(sources, list) or not 0 < len(sources) <= 50:
        raise ValueError('invalid official source count')
    default_cap = registry.get('maxItemsPerFeed', 100)
    if isinstance(default_cap, bool) or not isinstance(default_cap, int) or not 1 <= default_cap <= 100:
        raise ValueError('invalid per-feed item cap')
    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError('invalid official source record')
        identity = source.get('id')
        if (not isinstance(identity, str) or re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', identity) is None
                or identity in seen):
            raise ValueError('invalid duplicate source ID')
        seen.add(identity)
        if source.get('format') != 'rss' or source.get('reuse') != 'metadata-links-only':
            raise ValueError('unsupported official source policy')
        for field in ('label', 'region'):
            value = source.get(field)
            if not isinstance(value, str) or not value.strip() or len(value) > 256:
                raise ValueError('invalid source attribution')
        hosts = source.get('articleHosts')
        if not isinstance(hosts, list) or not 1 <= len(hosts) <= 32:
            raise ValueError('invalid source hosts')
        normalized_hosts = set()
        for host in hosts:
            if not isinstance(host, str) or not 1 <= len(host) <= 253:
                raise ValueError('invalid source host')
            labels = host.rstrip('.').split('.')
            if (len(labels) < 2 or any(not label or len(label) > 63
                    or re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?', label) is None
                    for label in labels)):
                raise ValueError('invalid source host')
            normalized_hosts.add(host.lower().rstrip('.'))
        raw_url = source.get('url')
        if not isinstance(raw_url, str) or len(raw_url) > 2048:
            raise ValueError('invalid official source URL')
        try:
            url = urlsplit(raw_url)
            valid_url = (url.scheme == 'https' and url.hostname in normalized_hosts
                         and not url.username and not url.password and url.port is None)
        except ValueError:
            valid_url = False
        if not valid_url:
            raise ValueError('invalid official source URL')
        if not isinstance(source.get('licenseEvidenceUrl'), str) or not source['licenseEvidenceUrl'].strip():
            raise ValueError('missing official source license evidence URL')
        for field in ('evidenceUrl', 'licenseEvidenceUrl'):
            if field not in source:
                continue
            if not valid_https_evidence_url(source[field]):
                raise ValueError('invalid official source evidence URL')
        keywords = source.get('titleKeywords', [])
        if (not isinstance(keywords, list) or len(keywords) > 30
                or any(not isinstance(word, str) or not word.strip() or len(word) > 120 for word in keywords)):
            raise ValueError('invalid source title filter')
        source_cap = source.get('maxItems', default_cap)
        if isinstance(source_cap, bool) or not isinstance(source_cap, int) or not 1 <= source_cap <= default_cap:
            raise ValueError('invalid source item limit')
        if ('includeCategoriesInTitle' in source
                and not isinstance(source['includeCategoriesInTitle'], bool)):
            raise ValueError('invalid category title option')
    return sources, default_cap


def feed_review_snapshot(source):
    """Return the source fields that must remain unchanged after manual review."""
    return {key: source[key] for key in REVIEWED_FEED_FIELDS if key in source}


def feed_review_matches(source):
    reviewed = source.get('feedReview')
    return isinstance(reviewed, dict) and reviewed == feed_review_snapshot(source)


def feed_acceptance_error(source, now):
    """Require an explicit, dated, current source review before publication."""
    acceptance = source.get('feedAcceptance')
    if acceptance != 'accepted':
        return 'source-feed-not-accepted'
    if not isinstance(source.get('licenseEvidenceUrl'), str) or not source['licenseEvidenceUrl'].strip():
        return 'source-license-evidence-required'
    if not valid_https_evidence_url(source['licenseEvidenceUrl']):
        return 'source-license-evidence-invalid'
    try:
        raw_date = source['feedVerifiedAt']
        verified = dt.date.fromisoformat(raw_date)
        if not isinstance(raw_date, str) or verified.isoformat() != raw_date:
            return 'source-feed-verification-invalid'
    except (KeyError, TypeError, ValueError):
        return 'source-feed-verification-invalid'
    today = now.date()
    if verified > today:
        return 'source-feed-verification-future'
    if today - verified > MAX_FEED_VERIFICATION_AGE:
        return 'source-feed-verification-expired'
    if not isinstance(source.get('feedReview'), dict):
        return 'source-feed-review-required'
    if not feed_review_matches(source):
        return 'source-feed-configuration-changed'
    return None


def review_metadata(row, sources, now):
    if not isinstance(row, dict): return 'invalid-record'
    if not isinstance(row.get('sourceId'), str): return 'invalid-source-id'
    source = sources.get(row.get('sourceId'))
    if not source or source.get('reuse') != 'metadata-links-only': return 'source-not-approved'
    feed_error = feed_acceptance_error(source, now)
    if feed_error: return feed_error
    if row.get('verified') is not True or row.get('sourceUrl') != source.get('url'):
        return 'provenance-mismatch'
    if not isinstance(row.get('id'), str) or not row['id'].strip() or len(row['id']) > 160: return 'invalid-record-id'
    if not isinstance(row.get('title'), str) or not row['title'].strip() or len(row['title']) > 300: return 'missing-title'
    if any(not isinstance(row.get(key), str) or not row[key].strip() for key in ('region', 'sourceLabel')):
        return 'missing-attribution'
    if any(key in row for key in ('body', 'articleBody', 'image', 'imageUrl')):
        return 'unsupported-content-rights'
    try:
        url = urlsplit(row.get('url', ''))
        hosts = source.get('articleHosts')
        if not isinstance(hosts, list) or not hosts:
            return 'source-not-approved'
        if (url.scheme != 'https' or url.hostname not in hosts
                or url.username or url.password or url.port): return 'article-host-mismatch'
        fetched = dt.datetime.fromisoformat(row['fetchedAt'].replace('Z', '+00:00'))
        if fetched.tzinfo is None or fetched.utcoffset() is None: return 'invalid-freshness-date'
        published = dt.datetime.fromisoformat(row['publishedAt'].replace('Z', '+00:00'))
        if published.tzinfo is None or published.utcoffset() is None: return 'invalid-publication-date'
    except (ValueError, TypeError, KeyError, AttributeError): return 'invalid-record'
    if fetched > now + dt.timedelta(minutes=5): return 'future-freshness-date'
    if now - fetched > MAX_METADATA_AGE: return 'metadata-freshness-expired'
    if published > now + dt.timedelta(minutes=5): return 'future-publication-date'
    if now - published > MAX_PUBLICATION_AGE: return 'publication-expired'
    if 'center' in row:
        center = row['center']
        if (not isinstance(center, list) or len(center) != 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float))
                       for value in center)
                or not -180 <= center[0] <= 180 or not -90 <= center[1] <= 90):
            return 'invalid-center'
    return None


def apply_metadata_policy(rows, registry, now):
    sources = {source['id']: source for source in registry}
    published, withheld = [], []
    for row in rows:
        reason = review_metadata(row, sources, now)
        if reason:
            withheld.append({'record': row, 'reason': reason, 'reviewedAt': now.isoformat()})
        else:
            published.append(row)
    return published, withheld


def apply_bounded_metadata_policy(rows, registry, now, limit):
    """Filter rejected rows and preserve eligible overflow beyond the visible cap."""
    if type(limit) is not int or limit < 1:
        raise ValueError('metadata publication limit must be a positive integer')
    published, withheld = apply_metadata_policy(rows, registry, now)
    overflow = published[limit:]
    withheld.extend({'record': row, 'reason': 'publication-cap-exceeded',
                     'reviewedAt': now.isoformat()} for row in overflow)
    return published[:limit], withheld


def build_official_news_snapshot(source_states, published_items, generated_at,
                                 attempted_source_count, failed_source_count):
    """Build a newly reviewed snapshot even when feeds are unavailable.

    Feed failures stay visible in per-source state. The snapshot timestamp means
    the cached metadata was re-evaluated against the current expiry policy; it
    does not claim that an upstream feed was fetched successfully.
    """
    if (not isinstance(generated_at, dt.datetime) or generated_at.tzinfo is None
            or generated_at.utcoffset() is None):
        raise ValueError('official-news snapshot requires an aware generation time')
    if (type(attempted_source_count) is not int or attempted_source_count < 0
            or type(failed_source_count) is not int or not 0 <= failed_source_count <= attempted_source_count):
        raise ValueError('official-news collection counts are invalid')
    if not isinstance(source_states, list) or not isinstance(published_items, list):
        raise ValueError('official-news snapshot collections must be lists')
    state = ('success' if failed_source_count == 0 else
             'all-attempted-sources-failed' if attempted_source_count and failed_source_count == attempted_source_count else
             'partial')
    return {
        'schemaVersion': 1,
        'generatedAt': generated_at.isoformat(),
        'sources': source_states,
        'notice': '官方公告索引；查看原文确认生效范围，不据此自动开放路线。',
        'collectionStatus': {
            'state': state,
            'reviewedAt': generated_at.isoformat(),
            'attemptedSourceCount': attempted_source_count,
            'failedSourceCount': failed_source_count,
            'cachedItemsRevalidated': True,
        },
        'items': published_items,
    }


def bounded_withheld_history(items, limit=500):
    """Keep the most recently reviewed records within the audit-history budget."""
    if type(limit) is not int or limit < 1:
        raise ValueError('withheld history limit must be a positive integer')

    def timestamp(value):
        if not isinstance(value, str):
            return 0.0
        try:
            parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                return 0.0
            return parsed.timestamp()
        except (OverflowError, OSError, TypeError, ValueError):
            return 0.0

    def priority(item):
        if not isinstance(item, dict):
            return 0.0, 0.0, 0.0, ''
        record = item.get('record') if isinstance(item.get('record'), dict) else {}
        published = timestamp(record.get('publishedAt'))
        fetched = timestamp(record.get('fetchedAt'))
        identity = record.get('id') if isinstance(record.get('id'), str) else ''
        return timestamp(item.get('reviewedAt')), published, fetched, identity

    return sorted(items if isinstance(items, list) else [], key=priority, reverse=True)[:limit]


def replace_source_snapshot(existing_rows, source_id, current_rows):
    """Replace one successful source snapshot and return records it withdrew."""
    current_ids = {row.get('id') for row in current_rows if isinstance(row, dict)}
    retained = []
    retired = []
    for row in existing_rows:
        if isinstance(row, dict) and row.get('sourceId') == source_id and row.get('id') not in current_ids:
            retired.append(row)
        else:
            retained.append(row)
    retained.extend(current_rows)
    return retained, retired


class SourceSnapshotReviewError(ValueError):
    """A feed snapshot failed closed; retain diagnostics for the audit record."""

    def __init__(self, message, rejected, expired_ids, expired_rows):
        super().__init__(message)
        self.rejected = tuple(rejected)
        self.expired_ids = frozenset(expired_ids)
        self.expired_rows = tuple(expired_rows)


def review_and_replace_source_snapshot(existing_rows, source_id, source_rows, sources, now):
    """Review one successful feed before replacing its visible snapshot.

    Expired publications are retired, malformed replacements are withheld while
    preserving their last known-good rows, and a feed whose every row is
    otherwise rejected cannot erase its prior snapshot.
    """
    approved = []
    rejected = []
    expired_ids = set()
    expired_rows = []
    for row in source_rows:
        reason = review_metadata(row, sources, now)
        if reason == 'publication-expired':
            expired_ids.add(row.get('id') if isinstance(row, dict) else None)
            expired_rows.append(row)
        elif reason:
            rejected.append({'record': row, 'reason': reason, 'reviewedAt': now.isoformat()})
        else:
            approved.append(row)

    if source_rows and not approved and rejected:
        raise SourceSnapshotReviewError(
            'all feed records were withheld by metadata policy; prior source snapshot retained',
            rejected, expired_ids, expired_rows)

    old_source = {
        row.get('id'): row for row in existing_rows
        if isinstance(row, dict) and row.get('sourceId') == source_id
    }
    rejected_ids = {
        item['record'].get('id') for item in rejected
        if isinstance(item.get('record'), dict)
    }
    approved.extend(old_source[identity] for identity in rejected_ids if identity in old_source)
    visible, retired = replace_source_snapshot(existing_rows, source_id, approved)
    return visible, retired, rejected, expired_ids, expired_rows
