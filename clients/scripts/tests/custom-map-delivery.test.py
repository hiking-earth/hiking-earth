import hashlib,importlib.util,json,pathlib,tempfile,unittest,zipfile
spec=importlib.util.spec_from_file_location('delivery',pathlib.Path(__file__).parents[1]/'package-custom-map-delivery.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.source=self.root/'input';self.source.mkdir();self.data=b'x'*127;self.name='custom-example-20261010.pmtiles';(self.source/self.name).write_bytes(self.data);self.row={'name':self.name,'bytes':127,'sha256':hashlib.sha256(self.data).hexdigest(),'license':'ODbL-1.0 Produced Work','attribution':'OSM contributors','label':'Example','bounds':[0,0,0.1,0.1]};self.write();(self.source/'source-inventory.json').write_text(json.dumps({'schemaVersion':1,'accessVerified':False,'terrainIncluded':False,'bytes':127,'maps':[{**self.row,'file':self.name,'name':'Example','sourcePolicy':'https://docs.protomaps.com/basemaps/downloads'}]}))
 def write(self): (self.source/'catalog.json').write_text(json.dumps([self.row]))
 def test_valid(self):
  target=self.root/'delivery.zip';r=module.package(self.source,target);self.assertEqual(r['maps'],1);self.assertFalse(r['published']);self.assertIsNone(zipfile.ZipFile(target).testzip())
 def test_changed_map(self):
  (self.source/self.name).write_bytes(b'y'*127)
  with self.assertRaises(ValueError):module.package(self.source,self.root/'x.zip')
 def test_path_rejected(self):
  self.row['name']='../outside.pmtiles';self.write()
  with self.assertRaises(ValueError):module.package(self.source,self.root/'x.zip')
 def test_missing_rights(self):
  self.row.pop('license');self.write()
  with self.assertRaises(ValueError):module.package(self.source,self.root/'x.zip')
 def test_inventory_mismatch(self):
  (self.source/'source-inventory.json').write_text('{}')
  with self.assertRaises(ValueError):module.package(self.source,self.root/'x.zip')
 def test_symlink_catalog(self):
  catalog=self.source/'catalog.json';catalog.rename(self.root/'outside.json');catalog.symlink_to(self.root/'outside.json')
  with self.assertRaises(ValueError):module.package(self.source,self.root/'x.zip')
if __name__=='__main__':unittest.main()
