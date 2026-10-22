import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const disclosure = readFileSync(new URL('../app/privacy/page.tsx', import.meta.url), 'utf8');

assert.match(disclosure, /CloudBase/);
assert.match(disclosure, /GitHub Actions worker/);
assert.match(disclosure, /公开\s*GitHub Release/);
assert.match(disclosure, /90天/);
assert.match(disclosure, /实际删除可能延迟/);
assert.match(disclosure, /不会读取实时定位/);
assert.match(disclosure, /不会立即撤回已发布的公开地图包/);
