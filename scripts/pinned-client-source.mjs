import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
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
 return {head:git(folder,['rev-parse','HEAD']),dirty:git(folder,['status','--porcelain'])!==''};
}
function requirePinned(folder,ref){
 const state=inspect(folder);
 if(!state||state.head!==ref||state.dirty||!existsSync(path.join(folder,'app','package.json')))throw new Error('Client source must match clients.source.json exactly and have a clean working tree');
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
 // Keep the legacy single checkout read-only. It may contain useful local
 // work or generated catalog pages; never fetch/checkout over that directory.
 const legacy=path.join(root,'.client-source');
 const legacyState=inspect(legacy);
 if(legacyState?.head===source.ref&&!legacyState.dirty)return requirePinned(legacy,source.ref);

 // Use one immutable cache per source ref, so a dirty older checkout cannot
 // block packaging and a ref change never overwrites another local snapshot.
 const cacheRoot=path.join(root,'.client-source-cache');
 mkdirSync(cacheRoot,{recursive:true});
 // Reuse only an immutable, clean checkout. Preserve invalid or interrupted
 // cache entries instead of deleting or fetching into a user's existing path.
 const cacheNames=readdirSync(cacheRoot,{withFileTypes:true})
  .filter(entry=>entry.isDirectory()&&(entry.name===source.ref||entry.name.startsWith(`${source.ref}.candidate-`)))
  .map(entry=>entry.name);
 for(const name of cacheNames){
  const candidate=path.join(cacheRoot,name);
  try{
   const state=inspect(candidate);
   if(state?.head===source.ref&&!state.dirty)return requirePinned(candidate,source.ref);
  }catch{
   // A failed or malformed cache is retained; try a new isolated candidate.
  }
 }
 const candidate=mkdtempSync(path.join(cacheRoot,`${source.ref}.candidate-`));
 try{
  git(candidate,['init']);
  git(candidate,['fetch','--depth','1',source.repository,source.ref]);
  git(candidate,['checkout','--detach','FETCH_HEAD']);
  return requirePinned(candidate,source.ref);
 }catch(error){
  // This path was created exclusively by this invocation, so only its own
  // partial download is safe to remove. Existing caches remain untouched.
  rmSync(candidate,{recursive:true,force:true});
  throw error;
 }
}

export function resolveLocalClientPreviewSource(root,source,previewRoot=process.env.HIKING_CLIENT_PREVIEW_ROOT){
 if(process.env.HIKING_CLIENT_PREVIEW!=='1')throw new Error('Local client preview requires HIKING_CLIENT_PREVIEW=1');
 if(process.env.CI==='true'||process.env.GITHUB_ACTIONS==='true')throw new Error('Local client preview is disabled in CI and GitHub Actions');
 if(typeof previewRoot!=='string'||!previewRoot.trim())throw new Error('Local client preview requires HIKING_CLIENT_PREVIEW_ROOT');
 const folder=path.resolve(root,previewRoot);
 const state=inspect(folder);
 if(!state||!existsSync(path.join(folder,'app','package.json')))throw new Error('Local client preview must point to a client repository checkout');
 const remote=git(folder,['remote','get-url','origin']);
 const expected=new URL(source?.repository);
 const normalizedRemote=remote.replace(/\.git$/,'');
 const normalizedExpected=expected.href.replace(/\.git$/,'');
 if(expected.protocol!=='https:'||expected.username||expected.password||expected.port||normalizedRemote!==normalizedExpected){
  throw new Error('Local client preview repository does not match clients.source.json');
 }
 return folder;
}
