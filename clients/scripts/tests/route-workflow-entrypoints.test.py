import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    'route_workflow_entrypoints', ROOT / 'check-route-workflow-entrypoints.py'
)
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class WorkflowEntrypointTests(unittest.TestCase):
    def _run(self, files, workflow):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / '.github/workflows').mkdir(parents=True)
            (root / 'scripts').mkdir()
            for name, content in files.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding='utf-8')
            workflow_path = root / '.github/workflows/route-catalog-update.yml'
            workflow_path.write_text(workflow, encoding='utf-8')
            output = io.StringIO()
            with patch.object(CHECKER, 'ROOT', root), patch.object(CHECKER, 'WORKFLOW', workflow_path), \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                result = CHECKER.main()
            return result, output.getvalue()

    def test_detects_missing_workflow_entrypoint(self):
        result, output = self._run({}, 'run: python scripts/missing.py\n')
        self.assertEqual(result, 1)
        self.assertIn('scripts/missing.py', output)

    def test_detects_missing_transitive_local_import(self):
        files = {'scripts/collector.py': 'import hiking_earth_missing_helper_94731\n'}
        result, output = self._run(files, 'run: python scripts/collector.py\n')
        self.assertEqual(result, 1)
        self.assertIn('hiking_earth_missing_helper_94731', output)

    def test_accepts_existing_local_import_and_standard_library(self):
        files = {
            'scripts/collector.py': 'from local_helper import value\nimport json\n',
            'scripts/local_helper.py': 'value = 1\n',
        }
        result, output = self._run(files, 'run: python scripts/collector.py\n')
        self.assertEqual(result, 0)
        self.assertIn('static imports', output)

    def test_detects_missing_import_in_inline_python_block(self):
        files = {'scripts/collector.py': 'pass\n'}
        workflow = """run: |
  python scripts/collector.py
  python - <<'PY'
  import hiking_earth_missing_inline_helper_94731
  PY
"""
        result, output = self._run(files, workflow)
        self.assertEqual(result, 1)
        self.assertIn('hiking_earth_missing_inline_helper_94731', output)

    def test_accepts_existing_local_import_in_inline_python_block(self):
        files = {
            'scripts/collector.py': 'pass\n',
            'scripts/local_helper.py': 'value = 1\n',
        }
        workflow = """run: |
  python scripts/collector.py
  python - <<'PY'
  from local_helper import value
  import json
  PY
"""
        result, output = self._run(files, workflow)
        self.assertEqual(result, 0)
        self.assertIn('inline Python blocks', output)

    def test_rejects_path_outside_repository(self):
        files = {'outside.py': 'pass\n'}
        result, output = self._run(files, 'run: python scripts/../outside.py\n')
        self.assertEqual(result, 1)
        self.assertIn('scripts/../outside.py', output)

    def test_rejects_symlinked_entrypoint_outside_repository(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'repo'
            root.mkdir()
            (root / '.github/workflows').mkdir(parents=True)
            (root / 'scripts').mkdir()
            outside = Path(temporary) / 'outside.py'
            outside.write_text('pass\n', encoding='utf-8')
            (root / 'scripts/collector.py').symlink_to(outside)
            workflow = root / '.github/workflows/route-catalog-update.yml'
            workflow.write_text('run: python scripts/collector.py\n', encoding='utf-8')
            output = io.StringIO()
            with patch.object(CHECKER, 'ROOT', root), patch.object(CHECKER, 'WORKFLOW', workflow), \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                result = CHECKER.main()
        self.assertEqual(result, 1)
        self.assertIn('scripts/collector.py', output.getvalue())


if __name__ == '__main__':
    unittest.main()
