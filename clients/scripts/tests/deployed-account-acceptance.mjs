// Isolated accounts only. Never logs tokens, passwords, recovery codes or coordinates.
import crypto from 'node:crypto';
import fs from 'node:fs';
const siteMode=process.argv.includes('--site');
const reportOption=process.argv.find(arg=>arg.startsWith('--report='));
const reportPath=reportOption?.slice('--report='.length)||`docs/release/deployed-account${siteMode?'-site':''}-acceptance-2026-10-07.json`;
if(!/^docs\/release\/[a-zA-Z0-9._-]+\.json$/.test(reportPath))throw new Error('Report must be a JSON file inside docs/release');
const api=siteMode?'https://hiking-earth.nanyu20050927.chatgpt.site/api/client-api':'https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const records=[],accounts=[];
async function request(action,data={},token){
 const response=await fetch(api,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(30000)});
 return {status:response.status,payload:await response.json()};
}
function check(name,condition){records.push({name,passed:!!condition});if(!condition)throw new Error(name+' failed');}
let failure='';
try{
 for(let i=0;i<2;i++){
  const username='accept-'+crypto.randomBytes(8).toString('hex'),password=crypto.randomBytes(24).toString('hex');
  const r=await request('auth.register',{username,password,nickname:'自动验收隔离账号'});
  check('register isolated account '+i,r.status===200&&r.payload.ok&&typeof r.payload.data?.token==='string');
  accounts.push({username,password,...r.payload.data});
 }
 const [a,b]=accounts;
 const started=await request('auth.qr.start',{deviceLabel:'隔离验收设备'});
 check('QR start',started.payload.ok&&typeof started.payload.data?.challenge==='string');
 const challenge=started.payload.data;
 const waiting=await request('auth.qr.claim',challenge);
 check('QR pending without login',waiting.payload.ok&&waiting.payload.data.status==='pending');
 const unauthorizedConfirm=await request('auth.qr.confirm',{challenge:challenge.challenge,confirmed:true});
 check('QR confirmation needs authentication',unauthorizedConfirm.status===401);
 const approved=await request('auth.qr.confirm',{challenge:challenge.challenge,confirmed:true},a.token);
 check('QR authenticated approval',approved.payload.ok);
 const wrongClaim=await request('auth.qr.claim',{...challenge,claimSecret:'0'.repeat(64)});
 check('QR wrong claim secret denied',!wrongClaim.payload.ok);
 const claimed=await request('auth.qr.claim',challenge);
 check('QR one time claim',claimed.payload.ok&&claimed.payload.data.session?.openid===a.openid);
 const qrToken=claimed.payload.data.session.token;
 const replay=await request('auth.qr.claim',challenge);
 check('QR replay denied',!replay.payload.ok);
 const qrProfile=await request('auth.profile',{},qrToken);
 check('QR issued session valid',qrProfile.payload.ok&&qrProfile.payload.data.openid===a.openid);
 const qrOut=await request('auth.sign-out',{},qrToken);
 check('QR session cleanup',qrOut.payload.ok);

 const initial=await request('library-manage',{action:'get'},a.token);
 check('library read',initial.payload.ok&&initial.payload.data.version===0);
 const saved=await request('library-manage',{action:'save',favorites:['acceptance-fixture'],plans:[],version:0},a.token);
 check('library versioned save',saved.payload.ok&&saved.payload.data.version===1);
 const other=await request('library-manage',{action:'get'},b.token);
 check('library account isolation',other.payload.ok&&other.payload.data.version===0&&other.payload.data.favorites.length===0);
 const newer=await request('library-manage',{action:'save',favorites:['acceptance-newer'],plans:[],version:1},a.token);
 check('library next revision',newer.payload.ok&&newer.payload.data.version===2);
 const stale=await request('library-manage',{action:'save',favorites:[],plans:[],version:1},a.token);
 check('reject stale library snapshot',!stale.payload.ok);
 const restore=await request('library-manage',{action:'get'},a.token);
 check('retain newer library snapshot',restore.payload.ok&&restore.payload.data.version===2&&restore.payload.data.favorites[0]==='acceptance-newer');
 const invalid=await request('library-manage',{action:'save',favorites:['dup','dup'],plans:[],version:2},a.token);
 check('reject malformed duplicate library',!invalid.payload.ok);
 const noSession=await request('library-manage',{action:'get'});
 check('unauthenticated data denied',noSession.status===401&&!noSession.payload.ok);
 const signed=await request('auth.sign-in',{username:a.username,password:a.password});
 check('second device session',signed.payload.ok&&signed.payload.data.openid===a.openid);
 a.secondToken=signed.payload.data.token;
 const diary=await request('social-manage',{action:'diaries.save',id:'private-acceptance',routeId:'acceptance-fixture',body:'私有隔离验收资料',visibility:'private',version:0},a.token);
 check('private diary creation',diary.payload.ok&&diary.payload.data.status==='private'&&diary.payload.data.version===1);
 const diaryId=diary.payload.data.id;
 const ownDiary=await request('social-manage',{action:'diaries.list'},a.secondToken);
 check('private diary cross-session recovery',ownDiary.payload.ok&&ownDiary.payload.data.items.some(row=>row._id===diaryId&&row.mine===true));
 const otherDiary=await request('social-manage',{action:'diaries.list'},b.token);
 check('private diary account isolation',otherDiary.payload.ok&&!otherDiary.payload.data.items.some(row=>row._id===diaryId));
 const deniedDelete=await request('social-manage',{action:'documents.remove',id:diaryId},b.token);
 check('other account cannot delete diary',!deniedDelete.payload.ok);
 const changedDiary=await request('social-manage',{action:'diaries.save',id:'private-acceptance',routeId:'acceptance-fixture',body:'私有隔离验收资料第二版',visibility:'private',version:1},a.secondToken);
 check('private diary next revision',changedDiary.payload.ok&&changedDiary.payload.data.version===2);
 const staleDiary=await request('social-manage',{action:'diaries.save',id:'private-acceptance',routeId:'acceptance-fixture',body:'过期快照',visibility:'private',version:1},a.token);
 check('private diary stale revision denied',!staleDiary.payload.ok);
 const deniedModeration=await request('social-manage',{action:'moderation.list'},b.token);
 check('ordinary account cannot moderate',!deniedModeration.payload.ok);
 const removedDiary=await request('social-manage',{action:'documents.remove',id:diaryId},a.secondToken);
 check('private test diary cleanup',removedDiary.payload.ok&&removedDiary.payload.data.deleted===true);
 const createdTeam=await request('team-create',{name:'隔离验收小队',requestId:'team-acceptance'},a.token);
 check('create private test team',createdTeam.payload.ok&&typeof createdTeam.payload.data.teamId==='string');
 const team=createdTeam.payload.data;
 const replayTeam=await request('team-create',{name:'隔离验收小队',requestId:'team-acceptance'},a.token);
 check('team creation idempotency',replayTeam.payload.ok&&replayTeam.payload.data.teamId===team.teamId);
 const outsider=await request('social-manage',{action:'messages.list',teamId:team.teamId},b.token);
 check('nonmember cannot read team chat',!outsider.payload.ok);
 const joined=await request('team-join',{inviteCode:team.inviteCode},b.token);
 check('join private test team',joined.payload.ok);
 const notLeader=await request('team-manage',{action:'rename',teamId:team.teamId,name:'未经授权改名'},b.token);
 check('ordinary member cannot manage team',!notLeader.payload.ok);
 const sent=await request('social-manage',{action:'messages.send',teamId:team.teamId,id:'acceptance-message',body:'隔离队聊验收'},a.token);
 check('send private team message',sent.payload.ok&&sent.payload.data.sent===true);
 const repeated=await request('social-manage',{action:'messages.send',teamId:team.teamId,id:'acceptance-message',body:'隔离队聊验收'},a.token);
 check('team message idempotency',repeated.payload.ok&&repeated.payload.data.sent===true);
 const chat=await request('social-manage',{action:'messages.list',teamId:team.teamId},b.token);
 check('member receives message once',chat.payload.ok&&chat.payload.data.items.filter(row=>row.body==='隔离队聊验收').length===1);
 const removed=await request('team-manage',{action:'remove',teamId:team.teamId,memberId:b.openid},a.token);
 check('leader removes member',removed.payload.ok&&removed.payload.data.removed===true);
 const revoked=await request('social-manage',{action:'messages.list',teamId:team.teamId},b.token);
 check('removed member cannot read chat',!revoked.payload.ok);
 const revokedSend=await request('social-manage',{action:'messages.send',teamId:team.teamId,id:'revoked-message',body:'拒绝的消息'},b.token);
 check('removed member cannot send chat',!revokedSend.payload.ok);
 const disbanded=await request('team-manage',{action:'disband',teamId:team.teamId},a.token);
 check('private test team closed',disbanded.payload.ok&&disbanded.payload.data.disbanded===true);
 const closedJoin=await request('team-join',{inviteCode:team.inviteCode},b.token);
 check('closed team rejects admission',!closedJoin.payload.ok);
 // Explicit synthetic fixture near (0,0); never records device GPS or navigation data.
 const now=Date.now(),track={id:'synthetic-acceptance',name:'合成轨迹验收',state:'finished',startedAt:now-2000,endedAt:now,
  points:[{latitude:0,longitude:0,timestamp:now-2000},{latitude:0.001,longitude:0.001,timestamp:now}],distanceM:157,activeDurationMs:2000};
 const backup=await request('track-sync',{track,expectedVersion:0},a.token);
 check('synthetic track versioned backup',backup.payload.ok&&backup.payload.data.version===1);
 const recovered=await request('track-manage',{action:'get',trackId:track.id},a.secondToken);
 check('synthetic track cross-session restore',recovered.payload.ok&&recovered.payload.data.track.cloudVersion===1&&recovered.payload.data.track.points.length===2);
 const deniedTrack=await request('track-manage',{action:'get',trackId:track.id},b.token);
 check('other account cannot read track',!deniedTrack.payload.ok);
 const deniedTrackDelete=await request('track-manage',{action:'delete',trackId:track.id,expectedVersion:1},b.token);
 check('other account cannot delete track',!deniedTrackDelete.payload.ok);
 const trackUpdate=await request('track-sync',{track:{...track,name:'合成轨迹第二版'},expectedVersion:1},a.secondToken);
 check('synthetic track next revision',trackUpdate.payload.ok&&trackUpdate.payload.data.version===2);
 const staleTrack=await request('track-sync',{track,expectedVersion:1},a.token);
 check('stale track backup rejected',!staleTrack.payload.ok);
 const staleTrackDelete=await request('track-manage',{action:'delete',trackId:track.id,expectedVersion:1},a.token);
 check('stale track deletion rejected',!staleTrackDelete.payload.ok);
 const trackDeleted=await request('track-manage',{action:'delete',trackId:track.id,expectedVersion:2},a.secondToken);
 check('track deletion creates revision tombstone',trackDeleted.payload.ok&&trackDeleted.payload.data.version===3);
 const hiddenTrack=await request('track-manage',{action:'list',afterCursor:''},a.token);
 check('deleted track hidden from directory',hiddenTrack.payload.ok&&!hiddenTrack.payload.data.tracks.some(row=>row.trackId===track.id));
 const revival=await request('track-sync',{track,expectedVersion:3},a.token);
 check('automatic deleted track revival rejected',!revival.payload.ok);
 const explicitRestore=await request('track-sync',{track,expectedVersion:3,restoreDeleted:true},a.secondToken);
 check('explicit track rebackup allowed',explicitRestore.payload.ok&&explicitRestore.payload.data.version===4);
 const finalTrackDelete=await request('track-manage',{action:'delete',trackId:track.id,expectedVersion:4},a.secondToken);
 check('synthetic track cleanup',finalTrackDelete.payload.ok&&finalTrackDelete.payload.data.deleted===true);
 const cross=await request('library-manage',{action:'get'},a.secondToken);
 check('cross session recovery',cross.payload.ok&&cross.payload.data.version===2);
 const out=await request('auth.sign-out',{},a.token);
 check('session signout',out.payload.ok&&out.payload.data.signedOut===true);
 const expired=await request('auth.profile',{},a.token);
 check('signed out token rejected',expired.status===401&&!expired.payload.ok);
 a.token=a.secondToken;
}catch(error){failure=error.message;}finally{
 for(const account of accounts){
  try{
   let done=false;
   for(let i=0;i<10&&!done;i++){
    const deletion=await request('auth.delete',{password:account.password},account.token);
    if(!deletion.payload.ok)break;
    done=deletion.payload.data?.complete===true;
   }
   records.push({name:'isolated account cleanup',passed:done});
  }catch{records.push({name:'isolated account cleanup',passed:false});}
 }
 const report={schemaVersion:1,scope:(siteMode?'Sites same-origin':'CloudBase direct')+' HTTP account/library/private diary/team/chat/synthetic track workflow; excludes client UI and native/device permissions',checkedAt:new Date().toISOString(),passed:!failure&&records.every(r=>r.passed),failure,checks:records};
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
