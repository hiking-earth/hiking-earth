#!/usr/bin/env python3
"""Export a verified custom batch as a standalone static download directory."""
import argparse, hashlib, importlib.util, json, pathlib, shutil
spec=importlib.util.spec_from_file_location('inventory',pathlib.Path(__file__).with_name('export-offline-map-inventory.py'))
inventory=importlib.util.module_from_spec(spec);spec.loader.exec_module(inventory)

def export(source,config,target):
    catalog=inventory.export(source,config)
    # New destination only: never replace a live directory or existing catalog.
    target.mkdir(parents=False,exist_ok=False)
    rows=[]
    try:
        for row in catalog['maps']:
            dest=target/row['file']
            shutil.copyfile(source/row['file'],dest)
            if dest.stat().st_size!=row['bytes'] or hashlib.sha256(dest.read_bytes()).hexdigest()!=row['sha256']:
                raise ValueError('copied distribution map mismatch')
            rows.append(dict(name=row['file'],label=row['name'],url='static/offline-maps/'+row['file'],bytes=row['bytes'],sha256=row['sha256'],attribution=row['attribution'],license=row['license'],bounds=row['bounds']))
        # Catalog last; incomplete output remains without a publishable catalog.
        (target/'source-inventory.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
        (target/'catalog.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    except Exception:
        # Preserve copied bytes for diagnosis, but invalidate the delivery marker.
        (target/'catalog.json').unlink(missing_ok=True)
        raise
    return {'maps':len(rows),'bytes':catalog['bytes'],'deployed':False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',required=True,type=pathlib.Path);p.add_argument('--regions',required=True,type=pathlib.Path);p.add_argument('--output',required=True,type=pathlib.Path)
    a=p.parse_args();raw=a.regions.read_bytes()
    if len(raw)>256*1024:raise ValueError('region configuration too large')
    print(json.dumps(export(a.input,json.loads(raw),a.output)))
if __name__=='__main__':main()
