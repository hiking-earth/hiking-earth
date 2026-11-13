import importlib.util,pathlib,tempfile,subprocess,unittest
from unittest.mock import patch
p=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publisher',p/'publish-public-catalog.py')
import sys
sys.path.insert(0,str(p))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PublicationTests(unittest.TestCase):
 def test_isolated_index_preserves_checkout_and_unrelated_production_code(self):
  with tempfile.TemporaryDirectory() as folder:
   base=pathlib.Path(folder);remote=base/'remote.git';repo=base/'repo'
   def command(*args):return subprocess.check_output(['git',*args],cwd=repo,text=True,stderr=subprocess.DEVNULL).strip()
   subprocess.check_call(['git','init','--bare',str(remote)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   repo.mkdir();command('init','-b','main');command('config','user.email','test@example.invalid');command('config','user.name','Test')
   for path,value in [('production.txt','keep'),('shared/releases/stable.json','not-ready'),('shared/public-catalog/test.json','old'),('shared/data/content/test.json','old'),('shared/data/offline/hk-afcd.json','old')]:
    target=repo/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(value)
   command('add','.');command('commit','-m','baseline');command('remote','add','origin',str(remote));command('push','origin','main');command('checkout','-b','development')
   (repo/'production.txt').write_text('unreleased-code');(repo/'shared/releases/stable.json').write_text('do-not-promote');(repo/'shared/public-catalog/test.json').write_text('new');command('add','production.txt')
   before=command('status','--porcelain')
   with patch.object(m,'ROOT',repo),patch.object(m,'validate',lambda:None):m.publish()
   self.assertEqual(command('status','--porcelain'),before)
   self.assertEqual(command('branch','--show-current'),'development')
   self.assertEqual(command('show','origin/main:production.txt'),'keep')
   self.assertEqual(command('show','origin/main:shared/releases/stable.json'),'not-ready')
   self.assertEqual(command('show','origin/main:shared/public-catalog/test.json'),'new')
 def test_newer_production_snapshot_cannot_be_downgraded(self):
  import json
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);target=root/'shared/public-catalog/news/manifest.json';target.parent.mkdir(parents=True)
   target.write_text(json.dumps({'metadata':{'generatedAt':'2026-10-07T17:00:00Z'}}))
   def fake(*args,**kwargs):
    if args[0]=='ls-tree':return args[-1] if '/news/' in args[-1] else ''
    return json.dumps({'metadata':{'generatedAt':'2026-10-08T17:00:00Z'}})
   with patch.object(m,'ROOT',root),patch.object(m,'git',fake):
    with self.assertRaisesRegex(ValueError,'production snapshot is newer'):m.ensure_not_older('parent')
 def test_publication_timestamp_requires_timezone(self):
  import json
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);target=root/'shared/public-catalog/news/manifest.json';target.parent.mkdir(parents=True)
   target.write_text(json.dumps({'metadata':{'generatedAt':'2026-10-08T17:00:00'}}))
   def fake(*args,**kwargs):
    if args[0]=='ls-tree':return args[-1] if '/news/' in args[-1] else ''
    return json.dumps({'metadata':{'generatedAt':'2026-10-07T17:00:00Z'}})
   with patch.object(m,'ROOT',root),patch.object(m,'git',fake):
    with self.assertRaisesRegex(ValueError,'needs timezone'):m.ensure_not_older('parent')
if __name__=='__main__':unittest.main()
