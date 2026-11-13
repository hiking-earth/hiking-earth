import hashlib, importlib.util, json, pathlib, tempfile, unittest
spec=importlib.util.spec_from_file_location('inventory',pathlib.Path(__file__).parents[1]/'export-offline-map-inventory.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
        self.config={'schemaVersion':1,'regions':[{'id':'example','name':'Example','bbox':'0,0,0.1,0.1','minZoom':8,'maxZoom':15}]}
        fingerprint=hashlib.sha256(json.dumps(module.batch.validate_regions(self.config),sort_keys=True).encode()).hexdigest()
        self.state={'schemaVersion':1,'configSha256':fingerprint,'build':'20261006.pmtiles','regions':{'example':'complete'}}
        self.record={'name':'Example','bounds':[0,0,0.1,0.1],'minZoom':8,'maxZoom':15,'id':'example','file':'example-20261006.pmtiles','upstream':{'build':'20261006.pmtiles'},'bytes':127,'sha256':hashlib.sha256(b'x'*127).hexdigest(),'license':'ODbL-1.0 Produced Work','attribution':'OSM contributors','sourcePolicy':'https://docs.protomaps.com/basemaps/downloads'}
        (self.root/self.record['file']).write_bytes(b'x'*127);self.write()
    def write(self):
        (self.root/'batch.json').write_text(json.dumps(self.state));(self.root/'example-20261006.json').write_text(json.dumps(self.record))
    def test_complete_bytes(self):
        value=module.export(self.root,self.config);self.assertEqual(value['bytes'],127);self.assertFalse(value['accessVerified'])
    def test_partial_batch(self):
        self.state['regions']['example']='failed';self.write()
        with self.assertRaises(ValueError):module.export(self.root,self.config)
    def test_changed_bytes(self):
        (self.root/self.record['file']).write_bytes(b'y'*127)
        with self.assertRaises(ValueError):module.export(self.root,self.config)
    def test_missing_rights(self):
        del self.record['attribution'];self.write()
        with self.assertRaises(ValueError):module.export(self.root,self.config)
    def test_missing_configured_region(self):
        self.config['regions'].append({'id':'second','name':'Second','bbox':'1,1,1.1,1.1'})
        with self.assertRaises(ValueError):module.export(self.root,self.config)
    def test_changed_bounds(self):
        self.record['bounds']=[0,0,0.2,0.2];self.write()
        with self.assertRaises(ValueError):module.export(self.root,self.config)
    def test_invalid_upstream(self):
        self.record['upstream']=[];self.write()
        with self.assertRaises(ValueError):module.export(self.root,self.config)

    def test_global_overview_requires_world_scope_in_build_manifest(self):
        key='20261006.pmtiles';identity='world-overview';file=identity+'-20261006.pmtiles'
        data=b'x'*127;(self.root/file).write_bytes(data)
        config={'schemaVersion':1,'regions':[{'id':identity,'name':'World overview','bbox':'-180,-85.05112878,180,85.05112878','minZoom':0,'maxZoom':5,'scope':'global-overview'}]}
        fingerprint=hashlib.sha256(json.dumps(module.batch.validate_regions(config),sort_keys=True).encode()).hexdigest()
        state={'schemaVersion':1,'configSha256':fingerprint,'build':key,'regions':{identity:'complete'}}
        record={'name':'World overview','bounds':[-180,-85.05112878,180,85.05112878],'minZoom':0,'maxZoom':5,'scope':'global-overview','id':identity,'file':file,'upstream':{'build':key},'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'license':'ODbL-1.0 Produced Work','attribution':'OSM contributors','sourcePolicy':'https://docs.protomaps.com/basemaps/downloads'}
        (self.root/(identity+'-20261006.json')).write_text(json.dumps(record))
        (self.root/'batch.json').write_text(json.dumps(state))
        result=module.export(self.root,config)
        self.assertEqual(result['maps'][0]['scope'],'global-overview')
        record.pop('scope')
        (self.root/(identity+'-20261006.json')).write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError,'map region mismatch'):module.export(self.root,config)

if __name__=='__main__':unittest.main()
