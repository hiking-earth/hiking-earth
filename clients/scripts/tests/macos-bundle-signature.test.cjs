const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('free macOS bundles request full ad-hoc signing',()=>{
 const config=JSON.parse(fs.readFileSync('desktop/src-tauri/tauri.conf.json','utf8'));
 assert.equal(config.bundle.macOS.signingIdentity,'-');
 assert.equal(config.bundle.createUpdaterArtifacts,true);
});
test('macOS release builds verify the application resource seal',()=>{
 const workflow=fs.readFileSync('.github/workflows/desktop-release.yml','utf8');
 assert.match(workflow,/Verify full macOS application code signature[\s\S]*?if: matrix\.os == 'macos-latest'[\s\S]*?codesign --verify --deep --strict/);
 assert.match(workflow,/Verify updater signatures against pinned public key/);
});
