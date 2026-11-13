const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=JSON.parse(fs.readFileSync(path.join(root,'app/src/manifest.json'),'utf8'))['mp-weixin'];
test('WeChat location description meets the upload character limit',()=>{
 const desc=source.permission['scope.userLocation'].desc;
 assert.ok(Array.from(desc).length>0&&Array.from(desc).length<=30);
 for(const purpose of ['授权','导航','轨迹','队伍'])assert.ok(desc.includes(purpose));
});
test('required private location APIs are declared',()=>{
 for(const api of ['getLocation','startLocationUpdate','onLocationChange'])assert.ok(source.requiredPrivateInfos.includes(api));
});
test('compiled mini-program preserves the source permission declaration',()=>{
 const compiled=JSON.parse(fs.readFileSync(path.join(root,'app/dist/build/mp-weixin/app.json'),'utf8'));
 assert.deepEqual(compiled.permission,source.permission);
 assert.deepEqual(compiled.requiredPrivateInfos,source.requiredPrivateInfos);
});
