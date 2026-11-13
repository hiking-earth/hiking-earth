"""Parse the small, metadata-only RSS subset accepted by the collector."""
import datetime as dt
import email.utils
import xml.etree.ElementTree as ET


class _RejectDoctypeBuilder(ET.TreeBuilder):
    """Reject DTDs at the parser level, independent of XML byte encoding."""

    def doctype(self, name, pubid, system):
        raise ValueError('unsupported XML doctype declarations')


def parse_rss(data):
    """Parse RSS without permitting DTD/entity declarations."""
    parser = ET.XMLParser(target=_RejectDoctypeBuilder())
    root = ET.fromstring(data, parser=parser)
    if root.tag != 'rss' or root.find('channel') is None:
        raise ValueError('unsupported RSS structure')
    return root


PUBLICATION_DATE_TAGS = (
    'pubDate',
    '{http://purl.org/dc/elements/1.1/}date',
    '{http://purl.org/dc/terms/}issued',
    '{http://www.w3.org/2005/Atom}published',
    '{http://www.w3.org/2005/Atom}updated',
)


def item_publication_date(item):
    """Read the first valid explicit RSS/Dublin Core/Atom date.

    Feeds sometimes emit a placeholder in ``pubDate`` while supplying a valid
    Dublin Core date on the same item. Prefer any parseable source date; only
    return a raw invalid value when no supported field contains a valid date,
    so the existing policy can withhold it instead of guessing.
    """
    first_invalid = None
    for tag in PUBLICATION_DATE_TAGS:
        raw = item.findtext(tag)
        if not raw or not raw.strip():
            continue
        raw = raw.strip()
        try:
            value = email.utils.parsedate_to_datetime(raw)
        except (TypeError, ValueError, OverflowError):
            try:
                value = dt.datetime.fromisoformat(raw.replace('Z', '+00:00'))
            except (TypeError, ValueError, OverflowError):
                first_invalid = first_invalid or raw
                continue
        return value.isoformat()
    return first_invalid
