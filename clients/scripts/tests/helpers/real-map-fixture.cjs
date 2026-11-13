const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function regionFixture(id){
 const root=path.resolve(__dirname,'../../../app');
 const row=JSON.parse(fs.readFileSync(path.join(root,'src/data/basemap-packs.json'),'utf8')).find(r=>r.name.startsWith(id+'-'));
 if(!row||!/^[a-z0-9-]+\.pmtiles$/.test(row.name))throw Error('Required region fixture missing from catalog');
 const file=path.join(root,'map-assets/static/offline-maps',row.name),bytes=fs.readFileSync(file);
 if(bytes.length!==row.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('Region fixture bytes mismatch');
 return file;
};
