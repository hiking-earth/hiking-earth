import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const client=path.join(root,'dist','client');
const worker=path.join(client,'sw.js');
const digest=createHash('sha256');
const relevantExtensions=new Set(['.css','.html','.js','.webmanifest']);
let included=0;
const source=readFileSync(worker,'utf8').replace(/^\/\/ hiking-earth-build:[^\n]*\n/gm,'');
const shellDeclaration=source.match(/^const APP_SHELL = (\[[^\n]*\]);$/m);
if(!shellDeclaration)throw new Error('Cannot stamp PWA update: service worker app shell was not found');
const appShell=JSON.parse(shellDeclaration[1]);
if(!Array.isArray(appShell)||appShell.length===0||appShell.some(url=>typeof url!=='string'||!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]*$/.test(url)||url.split('/').includes('..'))){
  throw new Error('Cannot stamp PWA update: service worker app shell is invalid');
}

function visit(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true}).sort((left,right)=>left.name<right.name?-1:left.name>right.name?1:0)){
    const absolute=path.join(directory,entry.name);
    if(entry.isDirectory())visit(absolute);
    else if(entry.isFile()&&absolute!==worker&&(relevantExtensions.has(path.extname(entry.name))||(relativePath(absolute).startsWith('route-catalog/')&&(entry.name==='manifest.json'||entry.name.endsWith('.bin'))))){
      const relative=relativePath(absolute);
      const bytes=readFileSync(absolute);
      digest.update(relative);digest.update('\0');digest.update(String(bytes.length));digest.update('\0');digest.update(bytes);digest.update('\0');
      included++;
    }
  }
}

visit(client);
if(included===0)throw new Error('Cannot stamp PWA update: no built client assets were found');
let shellIncluded=0;
for(const url of appShell){
  const relative=url==='/'?'index.html':url.slice(1);
  const absolute=path.resolve(client,relative);
  if(absolute!==client&&!absolute.startsWith(`${client}${path.sep}`))throw new Error(`Cannot stamp PWA update: app shell path escapes client output (${url})`);
  digest.update('app-shell-resource\0');digest.update(url);digest.update('\0');
  if(!existsSync(absolute)){
    if(url==='/'&&existsSync(path.join(root,'dist','server','index.js'))&&existsSync(path.join(root,'dist','server','BUILD_ID'))){
      digest.update('runtime-ssr-route\0');
      digest.update(readFileSync(path.join(root,'dist','server','BUILD_ID'),'utf8').trim());
      digest.update('\0');
      shellIncluded++;
      continue;
    }
    if(url==='/')throw new Error('Cannot stamp PWA update: required app shell page or server-rendered route is missing');
    digest.update('missing\0');continue;
  }
  const bytes=readFileSync(absolute);
  digest.update(String(bytes.length));digest.update('\0');digest.update(bytes);digest.update('\0');
  shellIncluded++;
}
const cacheLine=/^const CACHE_NAME = "[^"]+";$/m;
if(!cacheLine.test(source))throw new Error('Cannot stamp PWA update: service worker cache declaration was not found');
digest.update('service-worker-source\0');
digest.update(source.replace(cacheLine,'const CACHE_NAME = "__BUILD_ID__";'));
digest.update('\0');
const buildId=digest.digest('hex');
const stamped=source.replace(cacheLine,`const CACHE_NAME = "hiking-earth-${buildId}";`);
writeFileSync(worker,`// hiking-earth-build:${buildId}\n${stamped}`,'utf8');
console.log(`Stamped PWA service worker for ${included} built assets, ${shellIncluded} app shell resources and its own source (${buildId}).`);

function relativePath(absolute){
  return path.relative(client,absolute).split(path.sep).join('/');
}
