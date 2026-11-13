const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=path.join(root,'shared/models/gear'),dest=path.join(root,'app/cloudfunctions/gear-scan');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'source.json'),'utf8'));
for(const record of manifest.files){if(!/^(model\.json|group1-shard[1-5]of5)$/.test(record.name))throw Error('Invalid asset name');const data=fs.readFileSync(path.join(source,record.name));if(data.length!==record.bytes||crypto.createHash('sha256').update(data).digest('hex')!==record.sha256)throw Error('Model asset mismatch');}
fs.mkdirSync(path.join(dest,'model'),{recursive:true});
for(const name of [...manifest.files.map(r=>r.name),'source.json','NOTICE','LICENSE'])fs.copyFileSync(path.join(source,name),path.join(dest,'model',name));
fs.copyFileSync(path.join(root,'shared/vision/cpu-detector.cjs'),path.join(dest,'cpu-detector.cjs'));
console.log('Prepared hash-verified model and detector for gear-scan');
