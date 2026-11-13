import importlib.util,pathlib,tempfile,json,hashlib,unittest
spec=importlib.util.spec_from_file_location('batch',pathlib.Path(__file__).parents[1]/'build-offline-regions.py');batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
class BatchTests(unittest.TestCase):
 def test_regions_world_and_negative_bounds(self):
  config=json.loads(pathlib.Path('shared/maps/regions.json').read_text());rows=batch.validate_regions(config);self.assertEqual({row['id'] for row in rows},{row['id'] for row in config['regions']});self.assertEqual(sum(row.get('scope')=='global-overview' for row in rows),1);self.assertEqual(rows[0]['scope'],'global-overview');self.assertTrue(any(row['bbox'].startswith('-') for row in rows))
 def test_invalid_and_duplicate(self):
  row={'id':'region','name':'Region','bbox':'1,2,1.1,2.1'}
  for config in [{},{'schemaVersion':1,'regions':[row,row]},{'schemaVersion':1,'regions':[{**row,'id':'../a'}]},{'schemaVersion':1,'regions':[{**row,'maxZoom':True}]},{'schemaVersion':1,'regions':[{**row,'bbox':'1,2,10,11'}]}]:
   with self.assertRaises(ValueError):batch.validate_regions(config)
  for invalid in [{**row,'id':'world-overview','scope':'global-overview'},{**row,'id':'world-overview','scope':'global-overview','bbox':'-180,-85.05112878,180,85.05112878','minZoom':0,'maxZoom':6},{**row,'id':'ordinary','scope':'global-overview','bbox':'-180,-85.05112878,180,85.05112878','minZoom':0,'maxZoom':5}]:
   with self.assertRaises(ValueError):batch.validate_regions({'schemaVersion':1,'regions':[invalid]})
 def test_existing_pack_sha_metadata_and_checkpoint(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);row=batch.validate_regions({'schemaVersion':1,'regions':[{'id':'a','name':'A','bbox':'1,2,1.1,2.1'}]})[0];key='20261006.pmtiles';data=bytes(127);(root/'a-20261006.pmtiles').write_bytes(data)
   record={'id':'a','upstream':{'build':key},'bounds':[1,2,1.1,2.1],'minZoom':8,'maxZoom':15,'bytes':127,'sha256':hashlib.sha256(data).hexdigest()};batch.checkpoint(root/'a-20261006.json',record);self.assertTrue(batch.verified_pack(root,row,key));(root/'a-20261006.pmtiles').write_bytes(b'x'*127);self.assertFalse(batch.verified_pack(root,row,key));self.assertFalse((root/'a-20261006.json.partial').exists())
if __name__=='__main__':unittest.main()
