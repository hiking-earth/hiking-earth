import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {exportEarthTexture} from '../scripts/export-earth-texture.mjs';
const reviewedAsset=new URL('../public/static/earth/blue-marble-mercator-4096.webp',import.meta.url);
const reviewedMetadata=new URL('../public/static/earth/blue-marble-mercator-4096.webp.provenance.json',import.meta.url);
function fixture(){
  const root=mkdtempSync(path.join(os.tmpdir(),'he-earth-'));
  const component=path.join(root,'app/src/components'),earth=path.join(root,'shared/design/earth');
  mkdirSync(component,{recursive:true});mkdirSync(earth,{recursive:true});
  copyFileSync(reviewedMetadata,path.join(component,'earth-texture.provenance.json'));
  copyFileSync(reviewedAsset,path.join(earth,'blue-marble-mercator-4096.webp'));
  copyFileSync(reviewedMetadata,path.join(earth,'blue-marble-mercator-4096.webp.provenance.json'));
  return {root,component,earth};
}
test('export preserves reviewed full-color 4K image and projection, under cache budget',()=>{
  const f=fixture();try{
    const output=path.join(f.root,'public/earth.webp');
    const result=exportEarthTexture(path.join(f.component,'earth-texture.json'),output);
    assert.equal(result.width,4096);assert.equal(result.height,4096);assert.ok(result.bytes<8*1024*1024);
    assert.deepEqual(readFileSync(output),readFileSync(path.join(f.earth,'blue-marble-mercator-4096.webp')));
    const p=JSON.parse(readFileSync(`${output}.provenance.json`));assert.equal(p.projection,'EPSG:3857');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('corrupted image cannot silently replace the reviewed satellite texture',()=>{
  const f=fixture();try{
    const source=path.join(f.earth,'blue-marble-mercator-4096.webp');const bytes=readFileSync(source);bytes[100]^=1;writeFileSync(source,bytes);
    assert.throws(()=>exportEarthTexture(path.join(f.component,'earth-texture.json'),path.join(f.root,'earth.webp')),/invalid/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('geographic projection metadata cannot regress to an equirectangular image',()=>{
  const f=fixture();try{
    const file=path.join(f.earth,'blue-marble-mercator-4096.webp.provenance.json');const p=JSON.parse(readFileSync(file));p.projection='EPSG:4326';writeFileSync(file,JSON.stringify(p));
    assert.throws(()=>exportEarthTexture(path.join(f.component,'earth-texture.json'),path.join(f.root,'earth.webp')),/invalid/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
