import importlib.util,json,pathlib,unittest
root=pathlib.Path(__file__).parents[1]
fixture_spec=importlib.util.spec_from_file_location('fixture',root/'tests/offline-map-inventory.test.py')
fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)
spec=importlib.util.spec_from_file_location('installer',root/'install-offline-map-batch.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

class InstallTests(fixture.InventoryTests):
    def setUp(self):
        super().setUp();self.repo=self.root/'repo';self.assets=self.repo/'app/map-assets/static/offline-maps';self.assets.mkdir(parents=True)
        self.index=self.repo/'app/src/data/basemap-packs.json';self.index.parent.mkdir(parents=True);self.index.write_text('[]\n')
    def test_install_and_repeat(self):
        installer.install(self.root,self.repo,self.config,lambda path:None);saved=self.index.read_bytes()
        installer.install(self.root,self.repo,self.config,lambda path:None)
        self.assertEqual(self.index.read_bytes(),saved);self.assertEqual(len(list(self.assets.glob('*.pmtiles'))),1)
    def test_install_prunes_unreferenced_historical_packs(self):
        (self.assets/'example-20261005.pmtiles').write_bytes(b'o'*127)
        (self.assets/'other-region-20261005.pmtiles').write_bytes(b'o'*127)
        installer.install(self.root,self.repo,self.config,lambda path:None)
        self.assertEqual(sorted(path.name for path in self.assets.glob('*.pmtiles')),
                         ['example-20261006.pmtiles'])
    def test_verify_failure_keeps_catalog(self):
        before=self.index.read_bytes()
        def fail(path):raise ValueError('invalid structure')
        with self.assertRaises(ValueError):installer.install(self.root,self.repo,self.config,fail)
        self.assertEqual(self.index.read_bytes(),before);self.assertFalse(list(self.assets.glob('*.pmtiles')))
    def test_collision_preserves_bytes(self):
        path=self.assets/self.record['file'];path.write_bytes(b'y'*127)
        with self.assertRaises(ValueError):installer.install(self.root,self.repo,self.config,lambda path:None)
        self.assertEqual(path.read_bytes(),b'y'*127);self.assertEqual(self.index.read_text(),'[]\n')
    def test_symlink_rejected(self):
        (self.assets/self.record['file']).symlink_to(self.root/self.record['file'])
        with self.assertRaises(ValueError):installer.install(self.root,self.repo,self.config,lambda path:None)

if __name__=='__main__':unittest.main()
