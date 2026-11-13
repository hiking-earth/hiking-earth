import importlib.util,pathlib,unittest
root=pathlib.Path(__file__).parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,root/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
planner=module('planner','plan-offline-region.py');batch=module('batch','build-offline-regions.py')
class Tests(unittest.TestCase):
 def test_global_centers_fit_existing_builder(self):
  for lat,lon in [(0,0),(51,-116),(-34,18),(84,20),(0,180),(0,-180),(30,179.99)]:
   cfg=planner.plan(lat,lon,10,'Selected area');self.assertEqual(len(batch.validate_regions(cfg)),len(cfg['regions']))
 def test_antimeridian_is_split(self):
  rows=planner.plan(0,179.99,5,'Date line')['regions'];self.assertEqual(len(rows),2)
  for row in rows:
   west,south,east,north=map(float,row['bbox'].split(','));self.assertLess(west,east);self.assertGreaterEqual(west,-180);self.assertLessEqual(east,180)
 def test_bad_and_polar_input_rejected(self):
  for args in [(True,0,5),(0,float('nan'),5),(0,181,5),(0,0,0),(0,0,11),(85.05,0,10)]:
   with self.assertRaises(ValueError):planner.plan(*args,'Name')
 def test_close_centers_have_distinct_geometry_ids(self):
  a=planner.plan(0,0,5,'A')['regions'][0];b=planner.plan(0,0.0000001,5,'B')['regions'][0]
  self.assertNotEqual(a['bbox'],b['bbox']);self.assertNotEqual(a['id'],b['id'])
 def test_deterministic_ids(self):
  self.assertEqual(planner.plan(84,20,10,'Area'),planner.plan(84,20,10,'Area'))
if __name__=='__main__':unittest.main()
