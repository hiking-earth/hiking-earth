import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / 'catalog_publication_validation.py'
spec = importlib.util.spec_from_file_location('catalog_publication_validation', MODULE_PATH)
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


class RouteCatalogValidationTests(unittest.TestCase):
    def route(self, source='osm'):
        prefixes = {'osm': 'osm-relation-1', 'usfs': 'usfs-1', 'hk': 'hk-afcd-1', 'nzdoc': 'nzdoc-1', 'parkscanada': 'parkscanada-1', 'nsw-npws': 'nsw-npws-1', 'england': 'england-trail-1', 'wales': 'wales-trail-1', 'scotland-argyll': 'scotland-argyll-1'}
        source_urls = {
            'osm': 'https://www.openstreetmap.org/relation/1',
            'usfs': 'https://apps.fs.usda.gov/arcx/service',
            'hk': 'https://portal.csdi.gov.hk/server/rest/service',
            'nzdoc': 'https://services1.arcgis.com/3JjYDyG3oajxU6HO/ArcGIS/rest/services/DOC_Walking_Experiences/FeatureServer/1',
            'parkscanada': 'https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Trails_Sentiers_APCA_V2_FGP/FeatureServer/0',
            'nsw-npws': 'https://services7.arcgis.com/9nlQUywsHzFwAwIM/arcgis/rest/services/NPWS_Tracks/FeatureServer/0',
            'england': 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/National_Trails_England/FeatureServer/0',
            'wales': 'https://datamap.gov.wales/geoserver/ows?outputFormat=application%2Fjson&request=GetFeature&service=WFS&srsName=EPSG%3A4326&typename=inspire-nrw%3ANRW_NATIONAL_TRAIL&version=1.0.0',
            'scotland-argyll': 'https://arcgis.argyll-bute.gov.uk/arcgis/rest/services/Open_Data/MapServer/27',
        }
        row = {
            'id': prefixes[source], 'name': 'Trail', 'region': 'Region',
            'center': [114.1, 22.3], 'sourceUrl': source_urls[source],
            'fetchedAt': '2026-10-07T00:00:00Z', 'status': '待核验',
        }
        if source == 'hk':
            row['referencePaths'] = [[[114.0, 22.0], [114.1, 22.1]]]
        if source == 'nzdoc':
            row.update(region='新西兰', referencePaths=[[[-176.2, -40.9], [-176.1, -40.8]]], sourceTags={'officialUrl': 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/'} )
        if source == 'parkscanada':
            row.update(region='加拿大', referencePaths=[[[-115.5, 51.1], [-115.4, 51.2]]], sourceTags={'officialUrlEn': 'https://www.pc.gc.ca/en/pn-np/ab/banff', 'officialUrlFr': 'https://www.pc.gc.ca/fr/pn-np/ab/banff'})
        if source == 'nsw-npws':
            row.update(region='澳大利亚·新南威尔士州', referencePaths=[[[149.1, -33.7], [149.2, -33.8]]], sourceTags={'assetClass': 'Walking Track'})
        if source == 'england':
            row.update(region='英国·英格兰', referencePaths=[[[-2.0, 53.0], [-2.1, 53.1]]], sourceTags={'distanceKm': 10.0})
        if source == 'wales':
            row.update(region='英国·威尔士', referencePaths=[[[-4.8, 51.8], [-4.7, 51.9]]], sourceTags={'sourceStatus': 'Walked Line (10k)'})
        if source == 'scotland-argyll':
            row.update(region='英国·苏格兰·阿盖尔-比特', referencePaths=[[[-5.1, 55.8], [-5.0, 55.9]]], sourceTags={'pathNumber':'C240','grade':'Moderate','distanceKm':1.2,'walkLength':'1 mile / 1.6 km / allow 1 hr'})
        metadata = {
            'osm': {'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','licenseUrl':'https://www.openstreetmap.org/copyright'},
            'usfs': {'sourceUrl':source_urls[source],'license':'USDA source terms; retain attribution and source metadata','attribution':'USDA Forest Service','licenseUrl':'https://data.fs.usda.gov/geodata/edw/datasets.php?xmlKeyword=recreation'},
            'hk': {'sourceUrl':source_urls[source],'license':'DATA.GOV.HK-terms-1.2','attribution':'香港特别行政区政府 · 渔农自然护理署 · DATA.GOV.HK','licenseUrl':'https://data.gov.hk/en/terms-and-conditions'},
            'nzdoc': {'sourceUrl':source_urls[source],'license':'CC-BY-3.0-NZ','attribution':'Crown Copyright: Department of Conservation Te Papa Atawhai 2026','licenseUrl':'https://www.doc.govt.nz/our-work/maps-and-data/terms-and-conditions/'},
            'parkscanada': {'sourceUrl':source_urls[source],'license':'Open Government Licence - Canada','attribution':'Contains information licensed under the Open Government Licence – Canada. Source: Parks Canada (Trails APCA).','licenseUrl':'https://open.canada.ca/en/open-government-licence-canada/'},
            'nsw-npws': {'sourceUrl':source_urls[source],'license':'Creative Commons Attribution','attribution':'© State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2017. Source: NSW NPWS Asset Infrastructure – Track Section.','licenseUrl':'https://data.nsw.gov.au/data/dataset/asset-infrastructure-track-section8bfcf'},
            'england': {'sourceUrl':source_urls[source],'license':'Open Government Licence v3.0','attribution':'© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right 2026.','licenseUrl':'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'},
            'wales': {'sourceUrl':source_urls[source],'license':'Open Government Licence for Public Sector Information (OGL)','attribution':'Contains Natural Resources Wales information © Natural Resources Wales and Database Right. All rights Reserved. Contains Ordnance Survey Data. Ordnance Survey Licence number AC0000849444. Crown Copyright and Database Right.','licenseUrl':'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'},
            'scotland-argyll': {'sourceUrl':source_urls[source],'license':'Open Government Licence v3.0','attribution':'Contains spatial data licensed under Open Government Licence v3.0 from Argyll and Bute Council. Source: Adopted Core Paths.','licenseUrl':'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'},
        }[source]
        return {'schemaVersion': 1, **metadata, 'routes': [row]}

    def test_accepts_each_discovery_source_without_granting_access(self):
        for source in ('osm', 'usfs', 'hk', 'nzdoc', 'parkscanada', 'nsw-npws', 'england', 'wales', 'scotland-argyll'):
            with self.subTest(source=source):
                self.assertEqual(validation.validate_route_catalog(source, self.route(source)), 1)

    def test_accepts_official_dotted_usfs_trail_number(self):
        data = self.route('usfs')
        data['routes'][0]['id'] = 'usfs-5022.010011'
        self.assertEqual(validation.validate_route_catalog('usfs', data), 1)

    def test_rejects_malformed_usfs_trail_number(self):
        for identity in ('usfs-.010011', 'usfs-5022.', 'usfs-5022..010011', 'usfs-05022'):
            with self.subTest(identity=identity):
                data = self.route('usfs')
                data['routes'][0]['id'] = identity
                with self.assertRaisesRegex(ValueError, 'invalid source record ID'):
                    validation.validate_route_catalog('usfs', data)

    def test_rejects_duplicate_ids(self):
        data = self.route()
        data['routes'].append(dict(data['routes'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            validation.validate_route_catalog('osm', data)

    def test_rejects_non_pending_discovery_status(self):
        data = self.route()
        data['routes'][0]['status'] = '开放中'
        with self.assertRaisesRegex(ValueError, 'cannot publish status'):
            validation.validate_route_catalog('osm', data)

    def test_rejects_bad_coordinate_and_cross_source_host(self):
        data = self.route()
        data['routes'][0]['center'] = [181, 22]
        with self.assertRaisesRegex(ValueError, 'WGS84'):
            validation.validate_route_catalog('osm', data)
        data = self.route()
        data['routes'][0]['sourceUrl'] = 'https://example.org/trail'
        with self.assertRaisesRegex(ValueError, 'provenance'):
            validation.validate_route_catalog('osm', data)

    def test_osm_relation_url_must_match_record_id(self):
        data = self.route('osm')
        data['routes'][0]['sourceUrl'] = 'https://www.openstreetmap.org/relation/2'
        with self.assertRaisesRegex(ValueError, 'does not match its source ID'):
            validation.validate_route_catalog('osm', data)

    def test_rejects_hong_kong_reference_line_with_bad_points(self):
        data = self.route('hk')
        data['routes'][0]['referencePaths'] = [[[114.0, 22.0]]]
        with self.assertRaisesRegex(ValueError, 'at least two points'):
            validation.validate_route_catalog('hk', data)

    def test_accepts_new_zealand_doc_reference_geometry_and_official_link(self):
        self.assertEqual(validation.validate_route_catalog('nzdoc', self.route('nzdoc')), 1)

    def test_rejects_new_zealand_doc_wrong_layer_license_or_official_host(self):
        for edit in ('layer', 'license', 'official'):
            with self.subTest(edit=edit):
                data = self.route('nzdoc')
                if edit == 'layer': data['sourceUrl'] = 'https://services1.arcgis.com/example/FeatureServer/1'
                elif edit == 'license': data['license'] = 'unknown'
                else: data['routes'][0]['sourceTags']['officialUrl'] = 'https://example.org/fake'
                with self.assertRaises(ValueError):
                    validation.validate_route_catalog('nzdoc', data)

    def test_accepts_canada_parks_discovery_and_bilingual_official_links(self):
        self.assertEqual(validation.validate_route_catalog('parkscanada', self.route('parkscanada')), 1)

    def test_rejects_canada_parks_unapproved_layer_or_official_host(self):
        for edit in ('layer', 'official'):
            with self.subTest(edit=edit):
                data = self.route('parkscanada')
                if edit == 'layer': data['sourceUrl'] = 'https://services2.arcgis.com/example/FeatureServer/0'
                else: data['routes'][0]['sourceTags']['officialUrlEn'] = 'https://example.org/trail'
                with self.assertRaises(ValueError):
                    validation.validate_route_catalog('parkscanada', data)

    def test_accepts_only_attributed_nsw_npws_discovery_segments(self):
        self.assertEqual(validation.validate_route_catalog('nsw-npws', self.route('nsw-npws')), 1)
        data=self.route('nsw-npws');data['sourceUrl']='https://example.org/track'
        with self.assertRaises(ValueError):validation.validate_route_catalog('nsw-npws',data)


class NewsCatalogValidationTests(unittest.TestCase):
    def catalog(self):
        source = {
            'id': 'official', 'url': 'https://feed.example.gov/rss',
            'articleHosts': ['news.example.gov'],
        }
        return {
            'schemaVersion': 1, 'sources': [source],
            'items': [{
                'id': 'item-1', 'title': 'Notice', 'region': 'Region',
                'sourceId': 'official', 'sourceLabel': 'Official source',
                'verified': True, 'url': 'https://news.example.gov/notice/1',
                'sourceUrl': source['url'], 'publishedAt': '2026-10-06T10:00:00Z',
                'fetchedAt': '2026-10-07T00:00:00Z',
            }],
        }

    def test_accepts_allowlisted_verified_metadata_link(self):
        self.assertEqual(validation.validate_news_catalog(self.catalog()), 1)

    def test_rejects_article_host_outside_source_allowlist(self):
        data = self.catalog()
        data['items'][0]['url'] = 'https://unrelated.example/notice/1'
        with self.assertRaisesRegex(ValueError, 'not allowed'):
            validation.validate_news_catalog(data)

    def test_rejects_nonstandard_url_ports(self):
        data = self.catalog()
        data['items'][0]['url'] = 'https://news.example.gov:8443/notice/1'
        with self.assertRaisesRegex(ValueError, 'explicit port'):
            validation.validate_news_catalog(data)
        data = self.catalog()
        data['sources'][0]['url'] = 'https://feed.example.gov:8443/rss'
        data['items'][0]['sourceUrl'] = data['sources'][0]['url']
        with self.assertRaisesRegex(ValueError, 'explicit port'):
            validation.validate_news_catalog(data)

    def test_rejects_timestamps_without_timezone(self):
        for field in ('publishedAt', 'fetchedAt'):
            data = self.catalog()
            data['items'][0][field] = '2026-10-07T00:00:00'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'must include a timezone'):
                validation.validate_news_catalog(data)

    def test_rejects_unverified_link_and_unknown_source(self):
        data = self.catalog()
        data['items'][0]['verified'] = False
        with self.assertRaisesRegex(ValueError, 'verified'):
            validation.validate_news_catalog(data)
        data = self.catalog()
        data['items'][0]['sourceId'] = 'unknown'
        with self.assertRaisesRegex(ValueError, 'unknown source'):
            validation.validate_news_catalog(data)

    def test_rejects_source_pending_feed_acceptance(self):
        data = self.catalog()
        data['sources'][0]['feedAcceptance'] = 'pending-unified-verification'
        with self.assertRaisesRegex(ValueError, 'has not been accepted'):
            validation.validate_news_catalog(data)

    def test_accepted_feed_requires_a_current_verification_date(self):
        for verified, error in [(None, 'invalid feed verification date'),
                                ('2026-W41-3', 'invalid feed verification date'),
                                ('2026-10-08', 'in the future'),
                                ('2026-07-08', 'has expired')]:
            data = self.catalog()
            data['sources'][0].update(feedAcceptance='accepted')
            if verified is not None:
                data['sources'][0]['feedVerifiedAt'] = verified
            with self.assertRaisesRegex(ValueError, error):
                validation.validate_news_catalog(data, now=validation.datetime(2026, 10, 7, tzinfo=validation.timezone.utc))
        data = self.catalog()
        data['sources'][0].update(feedAcceptance='accepted', feedVerifiedAt='2026-07-09')
        self.assertEqual(validation.validate_news_catalog(data, now=validation.datetime(2026, 10, 7, tzinfo=validation.timezone.utc)), 1)


if __name__ == '__main__':
    unittest.main()
