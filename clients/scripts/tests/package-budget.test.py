import pathlib,subprocess,tempfile,unittest,zipfile,json,os,sys
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'check-package-budget.py'
class BudgetTests(unittest.TestCase):
 def check(self,path):
  result=subprocess.run([sys.executable,str(SCRIPT),str(path)],capture_output=True,text=True)
  return result.returncode,json.loads(result.stdout)
 def test_chinese_path_under_windows_encoding(self):
  with tempfile.TemporaryDirectory() as root:
   path=pathlib.Path(root)/'徒步地球.msi';path.write_bytes(b'candidate')
   result=subprocess.run([sys.executable,str(SCRIPT),str(path)],capture_output=True,env=dict(os.environ,PYTHONIOENCODING='cp1252'))
   self.assertEqual(result.returncode,0,result.stderr)
   self.assertEqual(json.loads(result.stdout.decode('ascii'))['files'][0]['path'],str(path.resolve()))
 def test_decimal_limit(self):
  with tempfile.TemporaryDirectory() as root:
   path=pathlib.Path(root)/'candidate.bin'
   with path.open('wb') as f:f.truncate(499_999_999)
   self.assertEqual(self.check(path)[0],0)
   with path.open('wb') as f:f.truncate(500_000_000)
   self.assertEqual(self.check(path)[0],1)
 def test_compressed_payload_limit(self):
  with tempfile.TemporaryDirectory() as root:
   path=pathlib.Path(root)/'candidate.apk'
   with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as archive:
    with archive.open('payload','w') as stream:
     for _ in range(500):stream.write(b'\0'*1_000_000)
   code,report=self.check(path)
   self.assertLess(path.stat().st_size,1_000_000)
   self.assertEqual(code,1)
   self.assertEqual(report['files'][0]['installedBytes'],500_000_000)
if __name__=='__main__':unittest.main()
