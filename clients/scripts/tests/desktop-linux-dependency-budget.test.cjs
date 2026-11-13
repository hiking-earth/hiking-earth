const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const workflow=fs.readFileSync('.github/workflows/desktop-release.yml','utf8');
const step=workflow.split('- name: 安装 Linux 依赖')[1].split('- uses: dtolnay')[0];
test('Linux dependency setup has a finite step budget',()=>{assert.match(step,/timeout-minutes: 12/);assert.match(step,/if: matrix\.os == 'ubuntu-22\.04'/);});
test('both apt operations limit network waits and retry count',()=>{const commands=step.split('\n').filter(line=>line.includes('sudo apt-get'));assert.equal(commands.length,2);for(const line of commands){assert.match(line,/Acquire::Retries=2/);assert.match(line,/Acquire::http::Timeout=30/);assert.match(line,/Acquire::https::Timeout=30/);}assert.match(commands[0],/APT::Update::Error-Mode=any update/);assert.match(commands[1],/libwebkit2gtk-4\.1-dev libappindicator3-dev librsvg2-dev patchelf/);});
