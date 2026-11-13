import importlib.util,pathlib,unittest,json,tempfile,sys
from unittest.mock import patch
PATH=pathlib.Path(__file__).resolve().parents[1]/'promote-desktop-release.py'
sys.path.insert(0,str(PATH.parent))
from release_acceptance import IPHONE_CHECKS
spec=importlib.util.spec_from_file_location('promotion',PATH)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Platforms(unittest.TestCase):
 def test_stable_version_must_advance_across_every_page(self):
  prior={'draft':False,'prerelease':False,'tag_name':'v0.2.2'}
  module.require_version_advance('0.2.3',[[prior]])
  for version in ['0.2.2','0.2.1']:
   with self.assertRaisesRegex(SystemExit,'must advance'):module.require_version_advance(version,[[],[prior]])
  module.require_version_advance('0.2.3',[[{**prior,'tag_name':'v9.0.0','draft':True},{**prior,'tag_name':'v8.0.0','prerelease':True}]])
 def test_ambiguous_stable_inventory_rejected(self):
  for pages in [{},[{}],[[{}]],[[{'draft':False,'prerelease':False,'tag_name':'desktop-21'}]]]:
   with self.assertRaises(SystemExit):module.require_version_advance('0.2.3',pages)
 def test_every_reported_desktop_architecture_is_verified(self):
  self.assertEqual(set(module.PLATFORMS),set(module.DESKTOP_REPORT_KEYS))
  self.assertEqual(set(module.PLATFORMS),{'windows-x86_64','darwin-aarch64','darwin-x86_64','linux-x86_64'})
  for key in module.DESKTOP_REPORT_KEYS.values():self.assertIn(key,module.REQUIRED_ACCEPTANCE)
 def test_mac_architectures_pin_separate_evidence(self):
  self.assertEqual(module.PLATFORMS['darwin-x86_64'],'.app.tar.gz')
  self.assertNotEqual(module.DESKTOP_REPORT_KEYS['darwin-x86_64'],module.DESKTOP_REPORT_KEYS['darwin-aarch64'])
 def test_missing_intel_update_never_publishes(self):
  sha='a'*40
  report={'schemaVersion':1,'complete':True,'sourceCommit':sha,'version':'0.2.1',
          'platforms':{key:{'status':'passed','evidence':['fixture-only'],'updaterArtifactSha256':'b'*64} for key in module.REQUIRED_ACCEPTANCE}}
  report['platforms']['ios']={'status':'passed','evidence':['fixture-only'],'delivery':'pwa','device':'physical-iphone','checks':{key:{'status':'passed','evidence':['fixture-only']} for key in IPHONE_CHECKS}}
  calls=[]
  def api(*args):
   calls.append(args)
   if '/commits/' in args[0]:return {'sha':sha}
   if '/releases/tags/' in args[0]:return {'draft':True,'prerelease':False,'assets':[{'name':'latest.json'}]}
   self.fail('Unexpected publication call')
  def run(command,**kwargs):
   if command[0]=='gh' and 'latest.json' in command:
    root=pathlib.Path(command[command.index('--dir')+1]);(root/'latest.json').write_text(json.dumps({'version':'0.2.1','platforms':{}}));return
   self.fail('Unexpected artifact or publication operation')
  with tempfile.TemporaryDirectory() as root:
   file=pathlib.Path(root)/'report.json';file.write_text(json.dumps(report))
   with patch.object(sys,'argv',['promotion','v0.2.1','--acceptance-report',str(file)]),patch.object(module,'gh_json',side_effect=api),patch.object(module.subprocess,'run',side_effect=run),patch.object(module,'PLATFORMS',{'darwin-x86_64':'.app.tar.gz'}):
    with self.assertRaisesRegex(SystemExit,'missing for darwin-x86_64'):module.main()
  self.assertEqual(len(calls),2)
if __name__=='__main__':unittest.main()
