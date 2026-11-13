const fs = require('node:fs');
const path = require('node:path');

// Conservative decimal limit also fits the platform's 2 MiB package limit.
const PACKAGE_LIMIT = 2_000_000;
function inspectBudget(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const roots = (manifest.subPackages || manifest.subpackages || []).map(row => {
    const value = row.root?.replace(/\/$/, '');
    if (!value || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid subpackage root');
    return value;
  }).sort((a, b) => b.length - a.length);
  if (new Set(roots).size !== roots.length) throw new Error('Duplicate subpackage root');
  const bytes = Object.fromEntries(['main', ...roots].map(key => [key, 0]));
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlink in mini-program output');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        const bucket = roots.find(value => relative.startsWith(value + '/')) || 'main';
        bytes[bucket] += fs.statSync(file).size;
      }
    }
  }
  visit(root);
  const packages = Object.entries(bytes).map(([name, size]) => ({name, bytes: size, passed: size < PACKAGE_LIMIT}));
  return {limitBytes: PACKAGE_LIMIT, packages, passed: packages.every(row => row.passed), scope: 'Conservative local files; official upload analysis remains required'};
}
module.exports = {inspectBudget};
if (require.main === module) {
  const result = inspectBudget(path.resolve(process.argv[2] || 'dist/build/mp-weixin'));
  const output = JSON.stringify(result, null, 2) + '\n';
  const reportPath = process.argv[3];
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), output, {encoding: 'utf8', flag: 'wx'});
  process.stdout.write(output);
  if (!result.passed) process.exitCode = 1;
}
