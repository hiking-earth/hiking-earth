#!/usr/bin/env python3
"""Fail before collection if workflow Python entrypoints/imports are missing."""
import ast
from pathlib import Path
import importlib.util
import re
import shlex
import sys
import textwrap


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/route-catalog-update.yml'
SCRIPT_COMMAND = re.compile(
    r'(?m)^\s*(?:run:\s*)?python3?\s+'
    r'(?P<path>scripts/[A-Za-z0-9_./-]+\.py)(?=\s|$)'
)
INLINE_PYTHON = re.compile(
    r"(?m)^\s*python3?\s+-\s+<<(?P<quote>['\"]?)(?P<tag>[A-Za-z_][A-Za-z0-9_]*)\1\s*$"
)
PIP_INSTALL = re.compile(
    r'^\s*(?:run:\s*)?(?:python(?:3(?:\.\d+)?)?\s+-m\s+)?'
    r'pip\s+install\b(?P<args>.*)$'
)
PIP_DISTRIBUTION = re.compile(
    r'^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)'
    r'(?:\[[A-Za-z0-9._,-]+\])?'
    r'(?:\s*(?:===|==|!=|~=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+)?$'
)
PIP_FLAGS_WITHOUT_VALUES = {
    '--disable-pip-version-check', '--no-input', '--pre', '--no-deps',
    '--no-build-isolation', '--use-pep517', '--no-use-pep517',
    '--require-hashes', '--prefer-binary', '--ignore-installed',
}
WORKFLOW_CHECK_COMMAND = re.compile(
    r'(?m)^\s*(?:run:\s*)?python3?\s+'
    r'scripts/check-route-workflow-entrypoints\.py(?:\s|$)'
)


def workflow_installed_imports(text):
    """Return normalized import names explicitly installed before this check."""
    check = WORKFLOW_CHECK_COMMAND.search(text)
    before_check = text[:check.start()] if check else ''
    installed = set()
    for line in before_check.splitlines():
        match = PIP_INSTALL.search(line)
        if not match:
            continue
        try:
            arguments = shlex.split(match.group('args'))
        except ValueError:
            continue
        line_imports = set()
        for argument in arguments:
            if argument in PIP_FLAGS_WITHOUT_VALUES:
                continue
            if argument.startswith('-'):
                # Unknown options may consume a following value; do not infer
                # package availability from the rest of an unfamiliar command.
                line_imports.clear()
                break
            requirement = PIP_DISTRIBUTION.fullmatch(argument)
            if requirement is None:
                # URLs, requirement-file paths and editable installs do not
                # prove a distribution-to-import-name mapping here.
                line_imports.clear()
                break
            line_imports.add(re.sub(r'[-.]+', '_', requirement.group('name')).lower())
        installed.update(line_imports)
    return installed


def inline_python_sources(text):
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = INLINE_PYTHON.match(line)
        if not match:
            continue
        tag = match.group('tag')
        body = []
        for end in range(index + 1, len(lines)):
            if re.fullmatch(rf"\s*{re.escape(tag)}\s*", lines[end]):
                yield tag, textwrap.dedent('\n'.join(body))
                break
            body.append(lines[end])
        else:
            yield tag, ''


def publication_expiry_contract_errors():
    """Refuse route collection unless official notices are bounded and retired."""
    policy_path = ROOT / 'scripts/official_content_policy.py'
    updater_path = ROOT / 'scripts/update-official-content.py'
    try:
        policy_tree = ast.parse(policy_path.read_text(encoding='utf-8'), filename=str(policy_path))
        updater_tree = ast.parse(updater_path.read_text(encoding='utf-8'), filename=str(updater_path))
    except (OSError, SyntaxError) as error:
        return [f'official notice expiry sources are unavailable or invalid: {error}']

    errors = []
    policy_functions = {node.name: node for node in policy_tree.body
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    review = policy_functions.get('review_metadata')
    replace = policy_functions.get('review_and_replace_source_snapshot')
    if review is None or replace is None:
        errors.append('official notice publication expiry and source replacement helpers are required')
        return errors

    expiry_age = None
    for node in policy_tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                                                and target.id == 'MAX_PUBLICATION_AGE'
                                                for target in node.targets):
            expiry_age = node.value
            break
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) \
                and node.target.id == 'MAX_PUBLICATION_AGE':
            expiry_age = node.value
            break
    age_is_bounded = False
    if isinstance(expiry_age, ast.Call):
        duration = expiry_age.func
        is_timedelta = isinstance(duration, ast.Attribute) and duration.attr == 'timedelta'
        days = next((keyword.value for keyword in expiry_age.keywords if keyword.arg == 'days'), None)
        age_is_bounded = (is_timedelta and isinstance(days, ast.Constant)
                          and type(days.value) in (int, float) and 0 < days.value <= 3650)
    if not age_is_bounded:
        errors.append('MAX_PUBLICATION_AGE must be a positive bounded timedelta')

    review_names = {node.id for node in ast.walk(review) if isinstance(node, ast.Name)}
    review_strings = {node.value for node in ast.walk(review)
                      if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    if 'MAX_PUBLICATION_AGE' not in review_names or 'publication-expired' not in review_strings:
        errors.append('official notice review must classify publications beyond MAX_PUBLICATION_AGE')

    replace_calls = {node.func.id for node in ast.walk(replace)
                     if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
    replace_strings = {node.value for node in ast.walk(replace)
                       if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    if 'review_metadata' not in replace_calls or 'publication-expired' not in replace_strings:
        errors.append('successful source refresh must retire expired notices before snapshot replacement')

    imported = any(isinstance(node, ast.ImportFrom) and node.module == 'official_content_policy'
                   and any(alias.name == 'review_and_replace_source_snapshot' for alias in node.names)
                   for node in updater_tree.body)
    updater_calls = {node.func.id for node in ast.walk(updater_tree)
                     if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
    if not imported or 'review_and_replace_source_snapshot' not in updater_calls:
        errors.append('official notice updater must use the reviewed source snapshot replacement')
    return errors


def main():
    try:
        text = WORKFLOW.read_text(encoding='utf-8')
    except OSError as error:
        print(f'Cannot read route workflow: {error}', file=sys.stderr)
        return 1

    scripts = sorted(set(SCRIPT_COMMAND.findall(text)))
    if not scripts:
        print('No repository Python entrypoints were found in route workflow.', file=sys.stderr)
        return 1

    sys.path.insert(0, str(ROOT))
    workflow_imports = workflow_installed_imports(text)
    missing = []
    missing_imports = []
    parsed = set()

    def source_for(module):
        parts = module.split('.')
        for base in (ROOT / 'scripts', ROOT):
            candidate = base.joinpath(*parts).with_suffix('.py')
            package = base.joinpath(*parts, '__init__.py')
            if candidate.is_file():
                return candidate
            if package.is_file():
                return package
        return None

    def inspect_source(label, source, identity=None):
        if identity is not None:
            identity = identity.resolve()
            if identity in parsed:
                return
            parsed.add(identity)
        try:
            tree = ast.parse(source, filename=label)
        except SyntaxError as error:
            missing_imports.append((label, f'cannot parse: {error}'))
            return

        modules = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules.add(node.module)
        for module in sorted(modules):
            local = source_for(module)
            if local is not None:
                inspect_imports(local)
                continue
            top_level = module.split('.', 1)[0]
            if top_level in sys.stdlib_module_names:
                continue
            if top_level.lower() in workflow_imports:
                continue
            try:
                available = importlib.util.find_spec(module) is not None
            except (ImportError, ModuleNotFoundError, ValueError):
                available = False
            if not available:
                missing_imports.append((label, module))

    def inspect_imports(script):
        script = script.resolve()
        if script in parsed:
            return
        try:
            label = str(script.relative_to(ROOT.resolve()))
        except ValueError:
            missing_imports.append((str(script), 'local import resolves outside repository'))
            return
        try:
            source = script.read_text(encoding='utf-8')
        except OSError as error:
            missing_imports.append((label, f'cannot parse: {error}'))
            return
        inspect_source(label, source, identity=script)

    for value in scripts:
        path = Path(value)
        resolved = (ROOT / path).resolve()
        if (path.is_absolute() or '..' in path.parts
                or not resolved.is_relative_to(ROOT.resolve()) or not resolved.is_file()):
            missing.append(value)
            continue
        inspect_imports(resolved)

    workflow_label = str(WORKFLOW.relative_to(ROOT))
    for tag, source in inline_python_sources(text):
        inspect_source(f'{workflow_label} inline Python heredoc {tag}', source)

    if missing:
        print('Route workflow references missing or unsafe scripts:', file=sys.stderr)
        for value in missing:
            print(f'- {value}', file=sys.stderr)
    if missing_imports:
        print('Route workflow scripts have missing imports or unreadable local dependencies:', file=sys.stderr)
        for source, module in sorted(set(missing_imports)):
            print(f'- {source}: {module}', file=sys.stderr)
    expiry_errors = publication_expiry_contract_errors()
    if expiry_errors:
        print('Official notice expiry contract is incomplete; route collection is blocked:', file=sys.stderr)
        for error in expiry_errors:
            print(f'- {error}', file=sys.stderr)
    if missing or missing_imports or expiry_errors:
        return 1

    print(f'Verified {len(scripts)} route workflow entrypoints, inline Python blocks, and static imports.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
