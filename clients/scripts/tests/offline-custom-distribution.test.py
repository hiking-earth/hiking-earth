import importlib.util,json,pathlib,unittest
root=pathlib.Path(__file__).parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
fixtures=load('fixtures',root/'tests/offline-map-inventory.test.py')
exporter=load('custom_export',root/'export-custom-map-distribution.py')
class Tests(fixtures.InventoryTests):
 def test_distribution_keeps_bytes_and_client_catalog(self):
  dest=self.root/'distribution';result=exporter.export(self.root,self.config,dest)
  self.assertFalse(result['deployed']);rows=json.loads((dest/'catalog.json').read_text())
  self.assertEqual(rows[0]['name'],self.record['file']);self.assertEqual(rows[0]['sha256'],self.record['sha256'])
  self.assertEqual((dest/rows[0]['name']).read_bytes(),b'x'*127)
 def test_existing_destination_preserved(self):
  dest=self.root/'distribution';dest.mkdir();(dest/'catalog.json').write_text('prior')
  with self.assertRaises(FileExistsError):exporter.export(self.root,self.config,dest)
  self.assertEqual((dest/'catalog.json').read_text(),'prior')
 def test_invalid_source_does_not_create_distribution(self):
  dest=self.root/'distribution';(self.root/self.record['file']).write_bytes(b'z'*127)
  with self.assertRaises(ValueError):exporter.export(self.root,self.config,dest)
  self.assertFalse(dest.exists())
if __name__=='__main__':unittest.main()
