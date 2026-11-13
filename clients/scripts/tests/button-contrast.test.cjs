const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
for(const page of ['offline/offline','moderation/moderation']){
 test(`${page} accent button has explicit dark text`,()=>{
  const source=readFileSync(resolve(__dirname,`../../app/src/pages/${page}.vue`),'utf8');
  assert.match(source,/button\{[^}]*background:#b8f36b;color:#01030a/);
 });
}
test('social normal and selected buttons use opposite contrast',()=>{
 const source=readFileSync(resolve(__dirname,'../../app/src/pages/companion/social.vue'),'utf8');
 assert.match(source,/button\{margin:0;color:#f4f8f2\}/);
 assert.match(source,/button\.selected\{color:#01030a\}/);
});
