const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
const ts=require('../../app/node_modules/typescript');
const registry=require('../../shared/data/content/official-sources.json');
const bundled=require('../../shared/data/content/official-news.json');
const folder='scripts/tests/fixtures/news-stale';
const manifest=JSON.parse(fs.readFileSync(`${folder}/manifest.json`));
const older={...manifest.metadata,items:JSON.parse(zlib.gunzipSync(fs.readFileSync(`${folder}/page-00000.json.gz`)))};
function harness(){const source=fs.readFileSync('app/src/services/news.ts','utf8');const validator=source.slice(source.indexOf('function officialUrl'),source.indexOf('apply(snapshot)'));const news={items:bundled.items,generatedAt:bundled.generatedAt,sources:[{id:'retained'}]};const box={registry,news,Date,Set,exports:{}};vm.runInNewContext(ts.transpile(validator+'\nexports.apply=apply;', {module:ts.ModuleKind.CommonJS}),box);return {news,apply:box.exports.apply};}
test('real previous published snapshot is valid but cannot downgrade newer local records',()=>{const {news,apply}=harness();const items=news.items,sources=news.sources;assert.equal(apply(older),'stale');assert.equal(news.items,items);assert.equal(news.sources,sources);assert.equal(news.generatedAt,bundled.generatedAt);news.generatedAt=null;assert.equal(apply(older),'applied');});
test('malformed old snapshot is rejected before stale classification',()=>{const {news,apply}=harness();const before=news.items;const bad=JSON.parse(JSON.stringify(older));bad.items[0].url='https://untrusted.invalid/article';assert.equal(apply(bad),false);assert.equal(news.items,before);});
test('equal or newer valid snapshot applies; stale refresh explicitly retains retry behavior',()=>{const {apply}=harness();assert.equal(apply(bundled),'applied');const source=fs.readFileSync('app/src/services/news.ts','utf8');assert.ok(source.includes("if(outcome==='stale')throw new Error('云端公告暂未更新"));assert.ok(source.includes('news.retryAt=Date.now()'));});
