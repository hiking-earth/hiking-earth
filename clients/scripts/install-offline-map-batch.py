#!/usr/bin/env python3
"""Install a complete verified batch; commit its client catalog last."""
import argparse, hashlib, importlib.util, json, os, pathlib, shutil, subprocess, uuid
SPEC=importlib.util.spec_from_file_location('inventory',pathlib.Path(__file__).with_name('export-offline-map-inventory.py'))
inventory=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(inventory)

def install(source,repo,config,verify):
    catalog=inventory.export(source,config)
    target=repo/'app/map-assets/static/offline-maps'
    index=repo/'app/src/data/basemap-packs.json'
    if not target.is_dir() or target.is_symlink() or index.is_symlink():raise ValueError('invalid map target')
    prior=json.loads(index.read_text())
    if not isinstance(prior,list) or len(prior)>128:raise ValueError('invalid client catalog')
    prefixes=tuple(row['id']+'-' for row in config['regions'])
    keep=[]
    for row in prior:
        if not isinstance(row,dict) or not isinstance(row.get('name'),str) or not inventory.re.fullmatch(r'[a-z0-9-]{1,80}\.pmtiles',row['name']):raise ValueError('invalid client entry')
        if not row['name'].startswith(prefixes):
            path=target/row['name']
            if row.get('url')!='static/offline-maps/'+row['name'] or not isinstance(row.get('sha256'),str) or not inventory.re.fullmatch(r'[a-f0-9]{64}',row['sha256']) or type(row.get('bytes')) is not int or not 127<=row['bytes']<=64*1024*1024:raise ValueError('invalid retained client entry')
            if path.is_symlink() or not path.is_file() or path.stat().st_size!=row['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('retained map bytes mismatch')
            if not row.get('attribution') or row.get('license')!='ODbL-1.0 Produced Work':raise ValueError('retained map attribution missing')
            verify(path);keep.append(row)
    added=[]
    for row in catalog['maps']:
        path=target/row['file']
        if path.is_symlink():raise ValueError('map target is a symbolic link')
        verify(source/row['file'])
        if path.exists():
            if path.stat().st_size!=row['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('immutable map name collision')
        added.append({'name':row['file'],'label':row['name'],'url':'static/offline-maps/'+row['file'],'bytes':row['bytes'],'sha256':row['sha256'],'attribution':row['attribution'],'license':row['license'],'bounds':row['bounds']})
    next_catalog=keep+added
    catalog_bytes=sum(row['bytes'] for row in next_catalog)
    if catalog_bytes>500_000_000:raise ValueError('referenced map assets exceed 500 MB')
    token=uuid.uuid4().hex
    for row in catalog['maps']:
        path=target/row['file']
        if path.exists():continue
        temp=target/(row['file']+'.'+token+'.partial')
        try:
            shutil.copyfile(source/row['file'],temp)
            if temp.stat().st_size!=row['bytes'] or hashlib.sha256(temp.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('copied map bytes mismatch')
            # Link creates the immutable name without replacing a concurrent writer.
            os.link(temp,path)
        finally:temp.unlink(missing_ok=True)
    text=json.dumps(next_catalog,ensure_ascii=False,indent=2)+'\n'
    public_index=target/'catalog.json'
    if public_index.is_symlink():raise ValueError('invalid public map catalog')
    if not public_index.exists() or public_index.read_text()!=text:
        temp=public_index.with_name(public_index.name+'.'+token+'.partial')
        try:temp.write_text(text);temp.replace(public_index)
        finally:temp.unlink(missing_ok=True)
    if index.read_text()!=text:
        temp=index.with_name(index.name+'.'+token+'.partial')
        try:temp.write_text(text);temp.replace(index)
        finally:temp.unlink(missing_ok=True)
    referenced={row['name'] for row in next_catalog}
    for path in target.glob('*.pmtiles'):
        if path.name in referenced:continue
        if (path.is_symlink() or not path.is_file()
                or not inventory.re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}-20\d{6}\.pmtiles',path.name)):
            raise ValueError('unreferenced map asset is not a safe generated pack')
        path.unlink()
    return {'maps':len(added),'bytes':catalog['bytes'],'build':catalog['build']}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',required=True,type=pathlib.Path);parser.add_argument('--repo',type=pathlib.Path,default=pathlib.Path('.'));parser.add_argument('--regions',required=True,type=pathlib.Path);parser.add_argument('--pmtiles',required=True,type=pathlib.Path);args=parser.parse_args()
    raw=args.regions.read_bytes()
    if len(raw)>256*1024:raise ValueError('region configuration too large')
    def verify(path):subprocess.run([str(args.pmtiles),'verify',str(path)],check=True,timeout=120,capture_output=True)
    print(json.dumps(install(args.input,args.repo,json.loads(raw),verify)))

if __name__=='__main__':main()
