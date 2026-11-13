import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../clients/app/src/services/updates.ts', import.meta.url), 'utf8');
const start = source.indexOf('function artifactUrl(');
const end = source.indexOf('function platformArtifactAvailable(', start);
const compiled = ts.transpileModule(source.slice(start, end), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const allowed = new Function(`${compiled}; return artifactUrl;`)();
test('updates accept only artifacts from the unified repository', () => {
 assert.equal(allowed('https://github.com/hiking-earth/hiking-earth/releases/download/desktop-50/client.zip'), true);
 for (const url of [
  'https://github.com/hiking-earth/clients/releases/download/desktop-50/client.zip',
  'https://github.com/other/hiking-earth/releases/download/v1/client.zip',
  'http://github.com/hiking-earth/hiking-earth/releases/download/v1/client.zip',
  'https://github.com/hiking-earth/hiking-earth/releases/download/v1/client.zip?redirect=bad',
 ]) assert.equal(allowed(url), false);
});
