"""Canonical mapping for catalogs exposed as immutable public pages.

USGS is intentionally absent: the app queries its public endpoint on demand
and does not maintain or publish a downloaded full-catalog snapshot.
"""

PUBLIC_CATALOG_FILES = {
    'osm': 'data/catalog/osm.json',
    'usfs': 'data/catalog/usfs.json',
    'hk': 'data/catalog/hk-afcd.json',
    'nzdoc': 'data/catalog/nzdoc.json',
    'parkscanada': 'data/catalog/canada-parks.json',
    'scotland-argyll': 'data/catalog/scotland-argyll-corepaths.json',
    'ni-midulster': 'data/catalog/ni-midulster-prow.json',
    'norfolk-prow': 'data/catalog/norfolk-prow.json',
    'cambridgeshire-prow': 'data/catalog/cambridgeshire-prow.json',
    'nps-public-trails': 'data/catalog/nps-public-trails.json',
    'swisstopo-wanderwege': 'data/catalog/swisstopo-wanderwege.json',
    'victoria-recreation-tracks': 'data/catalog/victoria-recreation-tracks.json',
    'queensland-qpws-trails': 'data/catalog/queensland-qpws-trails.json',
    'taiwan-trails': 'data/catalog/taiwan-trails.json',
    'korea-durunubi-trails': 'data/catalog/korea-durunubi-trails.json',
    'nsw-npws': 'data/catalog/nsw-npws.json',
    'england': 'data/catalog/england-trails.json',
    'wales': 'data/catalog/wales-trails.json',
    'japan-tokai': 'data/catalog/japan-tokai-trails.json',
    'news': 'data/content/official-news.json',
}

PUBLIC_CATALOG_LABELS = {
    'osm': 'OSM',
    'usfs': 'USFS',
    'hk': 'Hong Kong AFCD',
    'nzdoc': 'New Zealand DOC',
    'parkscanada': 'Parks Canada',
    'scotland-argyll': 'Argyll and Bute',
    'ni-midulster': 'Mid Ulster Public Rights of Way',
    'norfolk-prow': 'Norfolk Public Rights of Way',
    'cambridgeshire-prow': 'Cambridgeshire Public Rights of Way',
    'nps-public-trails': 'NPS public trails',
    'swisstopo-wanderwege': 'swisstopo named hiking references',
    'victoria-recreation-tracks': 'Victoria recreation tracks',
    'queensland-qpws-trails': 'Queensland QPWS walking tracks',
    'taiwan-trails': 'Taiwan Tourism Administration official hiking trails',
    'korea-durunubi-trails': 'Korea Tourism Organization DuruNubi Korea Dulle Trail',
    'nsw-npws': 'NSW NPWS',
    'england': 'Natural England',
    'wales': 'Natural Resources Wales',
    'japan-tokai': 'Japan Ministry of the Environment · Tokai Nature Trail',
    'news': 'Official notices',
}

PUBLIC_CATALOG_SOURCES = tuple(PUBLIC_CATALOG_FILES)
