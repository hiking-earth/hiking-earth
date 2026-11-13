#!/usr/bin/env python3
"""Record compiled client resources; not an installable package or acceptance result."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);p.add_argument('--platform',choices=['h5','mp-weixin','app'],required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--expected-commit',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
if head!=a.expected_commit or len(head)!=40 or any(c not in '0123456789abcdef' for c in head):raise ValueError('Candidate source commit does not match expected input')
folder=a.directory.resolve();expected=root/'app/dist/build'/a.platform
if folder!=expected.resolve() or not folder.is_dir() or a.output.exists():raise ValueError('Unexpected output directory or existing record; preserve it')
files=[];total=0
for path in sorted(folder.rglob('*')):
 if path.is_symlink():raise ValueError('Candidate resource symlinks are not allowed')
 if not path.is_file():continue
 size=path.stat().st_size;total+=size
 if total>=500000000:raise ValueError('Candidate resources exceed 500 MB hard ceiling')
 digest=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
 files.append({'path':path.relative_to(folder).as_posix(),'bytes':size,'sha256':digest.hexdigest()})
if not files:raise ValueError('No compiled resources found')
a.output.parent.mkdir(parents=True,exist_ok=True)
record={'schemaVersion':1,'candidate':True,'sourceCommit':head,'platform':a.platform,'bytes':total,'under200MB':total<200000000,'tested':False,'deployed':False,'installable':False,'files':files,'note':'Compiled resources only. app resources are not APK/IPA; mp-weixin resources are not an uploaded or approved mini-program.'}
with a.output.open('x',encoding='utf8') as stream:json.dump(record,stream,ensure_ascii=False,indent=2);stream.write('\n')
print('Recorded bounded client compiler output; no runtime acceptance claimed.')
