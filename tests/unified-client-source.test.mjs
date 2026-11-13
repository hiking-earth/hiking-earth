import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {resolvePinnedClientSource} from '../scripts/pinned-client-source.mjs';

test('builds use the editable in-repository source and reject a second checkout', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'hiking-source-'));
 try {
  assert.throws(() => resolvePinnedClientSource(root, {path: 'clients'}), /missing/);
  mkdirSync(path.join(root, 'clients/app'), {recursive: true});
  mkdirSync(path.join(root, 'clients/shared/design'), {recursive: true});
  writeFileSync(path.join(root, 'clients/app/package.json'), '{}');
  writeFileSync(path.join(root, 'clients/shared/design/palette.json'), '{}');
  assert.equal(resolvePinnedClientSource(root, {path: 'clients'}), path.join(root, 'clients'));
  writeFileSync(path.join(root, 'clients/app/package.json'), '{"modified":true}');
  assert.equal(resolvePinnedClientSource(root, {path: 'clients'}), path.join(root, 'clients'));
  assert.throws(() => resolvePinnedClientSource(root, {path: '../another-copy'}), /in-repository/);
  assert.throws(() => resolvePinnedClientSource(root, {path: 'clients'}, root), /External/);
 } finally { rmSync(root, {recursive: true, force: true}); }
});
