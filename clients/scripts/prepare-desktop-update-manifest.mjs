import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const [metadataFile,directory,output,sourceCommit]=process.argv.slice(2);
if(!metadataFile||!directory||!output||!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw new Error('Usage: metadata.json artifacts output.json source-commit');
const release=JSON.parse(readFileSync(metadataFile,'utf8'));
const config=JSON.parse(readFileSync(new URL('../desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'));
if(release.draft!==true||release.target_commitish!==sourceCommit||!Array.isArray(release.assets))throw new Error('Expected draft release pinned to source commit');
const clientVersion=typeof config.version==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(config.version);
if(!clientVersion||!clientVersion.slice(1).every(part=>Number.isSafeInteger(Number(part)))||release.tag_name!==`v${config.version}`)throw new Error('Release tag must match the client-supported Tauri version');
const platforms={};
const specs=[
 ['windows-x86_64','.msi',()=>true],
 ['darwin-aarch64','.app.tar.gz',name=>/_aarch64\.app\.tar\.gz$/.test(name)],
 ['darwin-x86_64','.app.tar.gz',name=>/_x64\.app\.tar\.gz$/.test(name)],
 ['linux-x86_64','.AppImage',()=>true],
];
for(const [platform,suffix,matchesArchitecture] of specs){
 const candidates=release.assets.filter(a=>typeof a.name==='string'&&a.name.endsWith(suffix)&&matchesArchitecture(a.name));
 if(candidates.length!==1)throw new Error(`Expected one ${platform} update artifact`);
 const artifact=candidates[0],signature=release.assets.find(a=>a.name===artifact.name+'.sig');
 if(!signature)throw new Error(`Missing ${platform} signature`);
 for(const item of [artifact,signature]){
  if(path.basename(item.name)!==item.name)throw new Error('Invalid artifact filename');
  const bytes=readFileSync(path.join(directory,item.name));
  if(bytes.length!==item.size||item.digest!=='sha256:'+createHash('sha256').update(bytes).digest('hex'))throw new Error('Remote and local artifact digest differ');
 }
 const verification=spawnSync(process.execPath,[fileURLToPath(new URL('./verify-desktop-updater.mjs',import.meta.url)),path.join(directory,artifact.name)],{encoding:'utf8'});
 if(verification.status!==0)throw new Error(`Invalid ${platform} signature`);
 if(typeof artifact.browser_download_url!=='string'||!artifact.browser_download_url.startsWith('https://github.com/hiking-earth/clients/releases/download/'))throw new Error('Unexpected updater origin');
 // GitHub draft assets may expose an untagged temporary URL. The installed
 // updater must retain the final release tag after the draft is published.
 platforms[platform]={url:`https://github.com/hiking-earth/clients/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(artifact.name)}`,signature:readFileSync(path.join(directory,signature.name),'utf8').trim()};
}
writeFileSync(output,JSON.stringify({version:config.version,notes:'Candidate; full platform acceptance required before public release.',pub_date:release.created_at,platforms},null,2)+'\n');
console.log('Prepared verified four-platform updater manifest; release remains draft.');
