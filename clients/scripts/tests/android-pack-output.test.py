import ast,unittest
from pathlib import Path
source=Path(__file__).resolve().parents[1]/'pack-android.py'
tree=ast.parse(source.read_text())
function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='pack_output_failure')
namespace={};exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
failure=namespace['pack_output_failure']
class PackOutputTests(unittest.TestCase):
 def test_zero_exit_login_failure(self):
  for output in ['10:30 user not login','User Not Login','用户未登录','请先登录']:self.assertTrue(failure(0,output))
 def test_compile_and_process_failure(self):
  self.assertTrue(failure(0,'打包失败'));self.assertTrue(failure(1,''));self.assertTrue(failure(0,'Cannot find module'))
 def test_no_false_submission_claim(self):
  self.assertFalse(failure(0,'completed'));self.assertIn('Submission is unverified',source.read_text())
if __name__=='__main__':unittest.main()
