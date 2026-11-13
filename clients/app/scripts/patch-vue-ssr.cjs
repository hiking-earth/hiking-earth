// Backport GHSA-g2v6-rqmx-r4w6 without changing DCloud's Vue runtime contract.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=require('./vue-ssr-patch.json');
const base=path.join(root,'node_modules/@vue/shared');
if(JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8')).version!==manifest.packageVersion)throw new Error('Review SSR backport for changed Vue version');
const before=String.raw`const unsafeAttrCharRE = /[>/="'\u0009\u000a\u000c\u0020]/;`;
const after=before.replace(String.raw`\u000c\u0020`,String.raw`\u000c\u000d\u0020`);
const pending=[];
for(const [name,expected] of Object.entries(manifest.files)){
 const target=path.join(base,'dist',name),text=fs.readFileSync(target,'utf8');
 const original=text.includes(after)?text.replace(after,before):text;
 if(crypto.createHash('sha256').update(original).digest('hex')!==expected||original.split(before).length!==2)throw new Error('Unexpected SSR dependency bytes: '+name);
 pending.push([target,original.replace(before,after)]);
}
for(const [target,text] of pending)fs.writeFileSync(target,text);
console.log('Verified Vue SSR CR backport in '+pending.length+' distributions');
