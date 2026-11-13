// Build-only candidate entry. Existing CI/acceptance and deployment gates stay separate.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.argv[2]&&path.resolve(process.argv[2]);
if(!output||existsSync(output)||output===root||root.startsWith(output+path.sep))throw new Error('Choose a new candidate output directory; existing paths are preserved');
function git(args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw new Error('Cannot identify candidate source');return r.stdout.trim();}
const sourceCommit=git(['rev-parse','HEAD']);
if(!/^[a-f0-9]{40}$/.test(sourceCommit)||git(['status','--porcelain']))throw new Error('Candidate source must be a clean exact checkout');
const client=JSON.parse(readFileSync(path.join(root,'clients.source.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(client.ref))throw new Error('Client must be pinned to an immutable commit');
mkdirSync(output,{recursive:true});
const record={sourceCommit,clientCommit:client.ref,candidate:true,tested:false,deployed:false,buildExit:null,files:[]};
const save=()=>writeFileSync(path.join(output,'candidate-source.json'),JSON.stringify(record,null,2)+'\n');save();
const command=process.platform==='win32'?process.execPath:'npm';
const args=process.platform==='win32'?[process.env.npm_execpath,'run','build']:['run','build'];
if(args.some(value=>!value))throw new Error('npm CLI path unavailable');
const build=spawnSync(command,args,{cwd:root,stdio:'inherit',env:{...process.env,HIKING_CLIENT_PREVIEW:'0'}});
record.buildExit=build.status;save();
if(build.error||build.status!==0)throw new Error('Website candidate compilation failed; preserve logs and source record');
const directory=path.join(root,'dist');
function walk(folder){for(const entry of readdirSync(folder,{withFileTypes:true})){const filename=path.join(folder,entry.name);const stat=lstatSync(filename);if(stat.isSymbolicLink())throw new Error('Candidate output must not contain symlinks');if(stat.isDirectory())walk(filename);else if(stat.isFile()){const bytes=readFileSync(filename);record.files.push({path:path.relative(directory,filename).split(path.sep).join('/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
walk(directory);if(!record.files.length)throw new Error('Website compiler output is empty');
save();
const archive=spawnSync('tar',['-czf',path.join(output,'website-candidate.tar.gz'),'-C',root,'dist'],{stdio:'inherit'});
if(archive.status!==0)throw new Error('Website archive failed');
const bytes=readFileSync(path.join(output,'website-candidate.tar.gz'));record.archive={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};save();
console.log('Website candidate compiled and archived; no functional tests, deployment or acceptance performed.');
