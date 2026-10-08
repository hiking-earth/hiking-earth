import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';

function git(folder,args){
 const result=spawnSync('git',args,{cwd:folder,encoding:'utf8'});
 if(result.status!==0)throw new Error(`Client source Git operation failed: ${args[0]}`);
 return result.stdout.trim();
}
function inspect(folder){
 if(!existsSync(path.join(folder,'.git')))return null;
 const top=git(folder,['rev-parse','--show-toplevel']);
 if(path.resolve(top)!==path.resolve(folder))throw new Error('Client source must be the repository root');
 return {head:git(folder,['rev-parse','HEAD']),dirty:git(folder,['status','--porcelain','--untracked-files=no'])!==''};
}
function requirePinned(folder,ref){
 const state=inspect(folder);
 if(!state||state.head!==ref||state.dirty||!existsSync(path.join(folder,'app','package.json')))throw new Error('Client source must match clients.source.json exactly and have no tracked modifications');
 return folder;
}

export function resolvePinnedClientSource(root,source,override=process.env.HIKING_CLIENT_ROOT){
 if(!/^[a-f0-9]{40}$/.test(source?.ref))throw new Error('Client source requires an immutable commit');
 const repository=new URL(source.repository);
 if(repository.protocol!=='https:'||repository.username||repository.password||repository.port)throw new Error('Invalid client source repository URL');
 if(override)return requirePinned(path.resolve(override),source.ref);
 const adjacent=path.resolve(root,'..');
 if(existsSync(path.join(adjacent,'app','package.json'))){
  const state=inspect(adjacent);
  if(state?.head===source.ref&&!state.dirty)return requirePinned(adjacent,source.ref);
 }
 const cached=path.join(root,'.client-source');
 mkdirSync(cached,{recursive:true});
 if(!existsSync(path.join(cached,'.git')))git(cached,['init']);
 else if(git(cached,['status','--porcelain','--untracked-files=no']))throw new Error('Cached client source has tracked changes; preserve them before preparation');
 git(cached,['fetch','--depth','1',source.repository,source.ref]);
 git(cached,['checkout','--detach','FETCH_HEAD']);
 return requirePinned(cached,source.ref);
}
