const test=require('node:test'),assert=require('node:assert/strict');
const babel=require('../../app/node_modules/@babel/core');
const lock=require('../../app/package-lock.json');
test('Babel 7 patched core is locked and compiles TypeScript with DCloud plugin generation',()=>{
 assert.equal(require('../../app/package.json').overrides['@babel/core'],'7.29.7');
 assert.equal(babel.version,'7.29.7');assert.equal(lock.packages['node_modules/@babel/core'].version,babel.version);
 const result=babel.transformSync('const title: string = "徒步地球";', {filename:'acceptance.ts',plugins:[require.resolve('../../app/node_modules/@babel/plugin-transform-typescript')],configFile:false,babelrc:false});
 assert.ok(result.code.includes('徒步地球'));assert.ok(!result.code.includes(': string'));
});
