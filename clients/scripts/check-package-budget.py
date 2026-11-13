#!/usr/bin/env python3
"""Reject installer or inspected installed contents >= 500 decimal MB."""
import argparse,json,pathlib,tarfile,zipfile
LIMIT=500_000_000
OPTIMIZATION_TARGET=200_000_000
ZIP_SUFFIXES={'.aab','.apk','.ipa','.zip'}
TAR_SUFFIXES={'.tar','.tgz','.tar.gz'}

def directory_payload_bytes(root):
 root=root.resolve(strict=True);pending=[root];visited_dirs=set();visited_files=set();total=0
 while pending:
  path=pending.pop()
  try:target=path.resolve(strict=True)
  except (OSError,RuntimeError) as error:raise ValueError(f'Broken or inaccessible package symlink/path: {path}') from error
  if not target.is_relative_to(root):raise ValueError(f'Package symlink escapes inspected directory: {path}')
  if target.is_dir():
   if target in visited_dirs:continue
   visited_dirs.add(target);pending.extend(target.iterdir())
  elif target.is_file():
   if target not in visited_files:visited_files.add(target);total+=target.stat().st_size
  else:raise ValueError(f'Unsupported non-file package entry: {path}')
 return total

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('paths',nargs='+');parser.add_argument('--report')
args=parser.parse_args();rows=[];failed=False
for value in args.paths:
 input_path=pathlib.Path(value)
 p=input_path.resolve()
 row={'path':str(p),'limitBytes':LIMIT,'optimizationTargetBytes':OPTIMIZATION_TARGET,'passed':False,'optimizationTargetStatus':'unknown'}
 try:
  p=input_path.resolve(strict=True)
  row['path']=str(p)
  if p.is_dir():
   size=directory_payload_bytes(p)
   row.update(installedBytes=size,coverage='directory contents, internal symlink targets resolved and counted once')
  else:
   size=p.stat().st_size;row.update(downloadBytes=size,coverage='download only')
  suffixes=input_path.name.lower()
  is_zip=zipfile.is_zipfile(p)
  expects_zip=any(suffixes.endswith(suffix) for suffix in ZIP_SUFFIXES)
  if expects_zip and not is_zip:raise ValueError(f'Invalid ZIP package: {p}')
  if is_zip:
   with zipfile.ZipFile(p) as z:unpacked=sum(i.file_size for i in z.infolist())
   row.update(installedBytes=unpacked,coverage='ZIP declared unpacked file sizes');size=max(size,unpacked)
  elif any(suffixes.endswith(suffix) for suffix in TAR_SUFFIXES):
   with tarfile.open(p) as t:unpacked=sum(i.size for i in t if i.isfile())
   row.update(installedBytes=unpacked,coverage='TAR unpacked regular file sizes');size=max(size,unpacked)
  row['passed']=size<LIMIT
  row['optimizationTargetStatus']='met' if size<OPTIMIZATION_TARGET else 'review'
  if not row['passed']:row['error']='Inspected payload is at or above the decimal 500 MB limit'
 except (OSError,RuntimeError,ValueError,tarfile.TarError,zipfile.BadZipFile) as error:
  row['error']=str(error)
 rows.append(row)
 failed|=not row['passed']
report={'schemaVersion':1,'optimizationTargetBytes':OPTIMIZATION_TARGET,'limitBytes':LIMIT,'passed':not failed,'optimizationNote':'200 MB is an advisory optimization target; packages above it remain eligible if below the hard limit and should be reviewed for removable bundled maps, models, debug symbols, and duplicate assets.','files':rows,'note':'Installed payload of DMG/MSI/AppImage/DEB requires separate directory measurement; runtime user data is excluded.'}
text=json.dumps(report,ensure_ascii=True,indent=2)
if args.report:pathlib.Path(args.report).write_text(text+'\n',encoding='utf-8')
print(text);raise SystemExit(1 if failed else 0)
