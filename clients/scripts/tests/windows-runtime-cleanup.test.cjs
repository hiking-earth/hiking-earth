const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('.github/workflows/desktop-windows-runtime.yml','utf8');
test('candidate cleanup has no unbounded process wait',()=>{assert.doesNotMatch(source,/\.WaitForExit\(\)/);assert.equal((source.match(/WaitForExit\(5000\)/g)||[]).length,2);assert.match(source,/WaitForExit\(20000\)/);});
test('cleanup failures invalidate pass and retain evidence',()=>{assert.match(source,/catch \{\s*\$record\.passed=\$false\s*\$record\.cleanupSucceeded=\$false\s*throw\s*\} finally \{\s*\$record \| ConvertTo-Json/);assert.match(source,/if: always\(\)/);});
