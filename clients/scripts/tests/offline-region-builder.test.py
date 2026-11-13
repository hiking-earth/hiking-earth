import importlib.util,pathlib,tempfile,unittest,sys
spec=importlib.util.spec_from_file_location('offline_builder',pathlib.Path(__file__).parents[1]/'build-offline-region.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class BuilderTests(unittest.TestCase):
 def test_valid_region(self):self.assertEqual(builder.parse_bounds('113.92,22.20,113.99,22.26'),(113.92,22.2,113.99,22.26))
 def test_fixed_world_overview_only(self):self.assertEqual(builder.parse_bounds('-180,-85.05112878,180,85.05112878',global_overview=True),(-180.0,-85.05112878,180.0,85.05112878))
 def test_global_overview_requires_fixed_world_bounds(self):
  with self.assertRaises(ValueError):builder.parse_bounds('-180,-85,180,85',global_overview=True)
 def test_invalid_regions(self):
  for value in ['nan,0,1,1','0,0,180,85','180,0,-180,1','0,85,0.1,86','1,0,1,1','0,0,1']:
   with self.subTest(value=value),self.assertRaises(ValueError):builder.parse_bounds(value)
 def test_failed_command_preserves_partial(self):
  with tempfile.TemporaryDirectory() as d:
   partial=pathlib.Path(d)/'pack';partial.write_bytes(b'x'*127)
   with self.assertRaises(RuntimeError):builder.bounded_extract([sys.executable,'-c','raise SystemExit(1)'],partial,pathlib.Path(d)/'log')
   self.assertTrue(partial.exists())
 def test_empty_output_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(ValueError):builder.bounded_extract([sys.executable,'-c','pass'],pathlib.Path(d)/'missing',pathlib.Path(d)/'log')
 def test_oversize_output_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   partial=pathlib.Path(d)/'pack'
   with partial.open('wb') as f:f.truncate(builder.MAX_BYTES+1)
   with self.assertRaises(ValueError):builder.bounded_extract([sys.executable,'-c','pass'],partial,pathlib.Path(d)/'log')
if __name__=='__main__':unittest.main()
