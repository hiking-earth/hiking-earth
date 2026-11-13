const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const p=require('../../shared/design/palette.json');
const colorKeys=['background','panel','surface','text','muted','accent','border'];
test('one generated palette feeds website, mini program and shared client styles',()=>{
 assert.equal(p.accent,'#b8f36b');
 const css=fs.readFileSync('shared/design/palette.css','utf8');
 const scss=fs.readFileSync('shared/design/palette.scss','utf8');
 for(const key of colorKeys){
  assert.ok(css.includes(`--he-color-${key}: ${p[key]};`),`CSS ${key}`);
  assert.ok(scss.includes(`$he-color-${key}: ${p[key]};`),`SCSS ${key}`);
 }
 assert.match(css,/:root, page\s*\{/,'shared CSS variables must be available to mini-program pages and the web root');
 const app=fs.readFileSync('app/src/App.vue','utf8');
 assert.ok(app.includes('@import "../../shared/design/palette.css";'));
 for(const [variable,token] of [['$uni-color-primary','$he-color-accent'],['$uni-color-success','$he-color-accent'],['$uni-text-color','$he-color-text'],['$uni-text-color-grey','$he-color-muted'],['$uni-bg-color','$he-color-background'],['$uni-bg-color-grey','$he-color-panel'],['$uni-bg-color-hover','$he-color-surface'],['$uni-border-color','$he-color-border']]){
  assert.ok(fs.readFileSync('app/src/uni.scss','utf8').includes(`${variable}: ${token};`),variable);
 }
 if(fs.existsSync('web/app/globals.css')){
  const web=fs.readFileSync('web/app/globals.css','utf8');
  assert.ok(web.includes('@import "./palette.css";'));
  assert.match(web,/--lime:\s*var\(--he-color-accent\)/);
  assert.match(web,/\.app-shell[^\{]*\{[^}]*background:\s*var\(--he-color-background\)/s);
  assert.equal(fs.readFileSync('web/app/theme-color.ts','utf8').match(/WEB_THEME_COLOR = '([^']+)'/)?.[1],p.background);
  assert.ok(fs.readFileSync('web/app/layout.tsx','utf8').includes('themeColor: WEB_THEME_COLOR'));
  const manifest=JSON.parse(fs.readFileSync('web/public/manifest.webmanifest','utf8'));
  assert.equal(manifest.background_color,p.background);
  assert.equal(manifest.theme_color,p.background);
 }
});
test('client page and component styles consume shared tokens instead of duplicating palette literals',()=>{
 const paletteValues=new Set(colorKeys.map(key=>p[key].toLowerCase()));
 function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory()){visit(file);continue;}
  if(!file.endsWith('.vue'))continue;
  const source=fs.readFileSync(file,'utf8');
  assert.ok(!/#48c9a8|#a7dfbf|#16a88c|#3b8b7b/i.test(source),file);
  for(const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)){
   const styles=match[1].toLowerCase();
   for(const value of paletteValues)assert.ok(!styles.includes(value),`${file} duplicates shared palette value ${value}`);
  }
  for(const tag of source.match(/<switch\b[^>]*>/g)||[])assert.ok(tag.includes(`color="${p.accent}"`),file);
 }}
 visit('app/src/pages');visit('app/src/components');
});
test('every client page and component rejects superseded green themes',()=>{
 function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())visit(path);else if(/\.(vue|scss|css|json)$/.test(path)){const source=fs.readFileSync(path,'utf8');assert.ok(!/#48c9a8|#a7dfbf|#16a88c|#3b8b7b/i.test(source),path);for(const tag of source.match(/<switch\b[^>]*>/g)||[])assert.ok(tag.includes(`color="${p.accent}"`),path);}}}
 visit('app/src/pages');visit('app/src/components');
});
test('website reference and shared client use identical accent',()=>{
 if(!fs.existsSync('web/app/globals.css'))return;
 const css=fs.readFileSync('web/app/globals.css','utf8');
 assert.equal(css.match(/--lime:\s*(#[0-9a-f]{6})/i)?.[1].toLowerCase(),p.accent);
 assert.match(css,/rgba\(184,243,107,/i,'website accent tints must use the published lime green');
 assert.doesNotMatch(css,/rgba\(167,223,191,/i,'superseded mint-green accent tints must not remain');
});
