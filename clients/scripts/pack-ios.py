#!/usr/bin/env python3
"""Cloud-build a real signed device IPA after the owner supplies Apple signing files.
Read passwords only from a private config; never include them in command arguments.
"""
import argparse,json,pathlib,os,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--signing-config',required=True);p.add_argument('--private-output',required=True);p.add_argument('--hbuilder',default='/Applications/HBuilderX.app/Contents/MacOS/cli');p.add_argument('--node',default='node');a=p.parse_args()
source=pathlib.Path(a.signing_config).resolve();output=pathlib.Path(a.private_output).resolve()
if ROOT in source.parents or ROOT in output.parents or output==source:raise SystemExit('Keep signing config and output outside the repository')
config=json.loads(source.read_text());ios=config.get('ios',{})
if ios.get('bundle')!='earth.hiking.app':raise SystemExit('Apple Bundle ID must match earth.hiking.app')
for key,suffix in [('certfile','.p12'),('profile','.mobileprovision')]:
 f=pathlib.Path(ios.get(key,'')).resolve()
 if not f.is_file() or f.suffix.lower()!=suffix:raise SystemExit('Owner signing file missing: '+key)
 if f==ROOT or ROOT in f.parents:raise SystemExit('Keep Apple signing files outside the repository')
if not isinstance(ios.get('certpassword'),str):raise SystemExit('Private config needs the p12 password')
config.update({'project':str(ROOT/'app'),'platform':'ios','safemode':True});ios.update({'channels':'phone','supporteddevice':'iPhone,iPad'})
subprocess.run([a.node,str(ROOT/'app/scripts/build-map-viewer.cjs')],cwd=ROOT/'app',check=True)
output.parent.mkdir(parents=True,exist_ok=True);os.chmod(output.parent,0o700)
fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(config,f,ensure_ascii=False)
r=subprocess.run([a.hbuilder,'pack','--config',str(output),'--project',config['project'],'--platform','ios','--safemode','true'],capture_output=True,text=True)
log=output.with_suffix('.log');fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(r.stdout+'\n'+r.stderr)
output_text=(r.stdout+'\n'+r.stderr).casefold()
failure_markers=['编译失败','打包失败','cannot find module','当前命令执行错误',
                 '未检测到已打开的hbuilderx','user not login','用户未登录','请先登录']
if r.returncode or any(marker.casefold() in output_text for marker in failure_markers):
 raise SystemExit('iOS build failed; private diagnostics retained')
print('iOS build command completed; verify IPA, entitlements and device distribution before release.')
