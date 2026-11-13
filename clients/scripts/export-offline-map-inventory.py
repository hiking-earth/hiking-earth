#!/usr/bin/env python3
"""Export only a complete, byte-verified regional batch for distribution."""
import argparse, hashlib, importlib.util, json, pathlib, re
SPEC=importlib.util.spec_from_file_location("batch",pathlib.Path(__file__).with_name("build-offline-regions.py"))
batch=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(batch)

def export(root,config):
    configured=batch.validate_regions(config)
    fingerprint=hashlib.sha256(json.dumps(configured,sort_keys=True).encode()).hexdigest()
    expected={row["id"]:row for row in configured}
    state=json.loads((root/'batch.json').read_text())
    if (not isinstance(state,dict) or type(state.get('schemaVersion')) is not int
            or state.get('schemaVersion')!=1 or not isinstance(state.get('regions'),dict)
            or not 1<=len(state['regions'])<=32):
        raise ValueError('invalid batch inventory')
    if state.get('configSha256')!=fingerprint or set(state['regions'])!=set(expected):raise ValueError('batch does not cover configured regions')
    build=state.get('build')
    if not isinstance(build,str) or not re.fullmatch(r'20\d{6}\.pmtiles',build):raise ValueError('invalid upstream snapshot')
    rows=[];total=0
    for ident,status in sorted(state['regions'].items()):
        if not isinstance(ident,str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',ident) or status!='complete':raise ValueError('batch incomplete')
        stem=ident+'-'+build.removesuffix('.pmtiles')
        record=json.loads((root/(stem+'.json')).read_text())
        pack=root/(stem+'.pmtiles')
        if (not isinstance(record,dict) or type(record.get('schemaVersion')) is not int
                or record.get('schemaVersion')!=1 or not isinstance(record.get('upstream'),dict)
                or record.get('id')!=ident or record.get('file')!=pack.name
                or record['upstream'].get('build')!=build):raise ValueError('map identity mismatch')
        region=expected[ident]
        global_overview=region.get('scope')=='global-overview'
        if record.get('bounds')!=list(batch.builder.parse_bounds(region['bbox'],global_overview=global_overview)) or record.get('minZoom')!=region['minZoom'] or record.get('maxZoom')!=region['maxZoom'] or record.get('name')!=region['name'] or record.get('scope')!=region.get('scope'):raise ValueError('map region mismatch')
        size=pack.stat().st_size
        if not 127<=size<=64*1024*1024 or record.get('bytes')!=size or hashlib.sha256(pack.read_bytes()).hexdigest()!=record.get('sha256'):raise ValueError('map bytes mismatch')
        if record.get('license')!='ODbL-1.0 Produced Work' or not record.get('attribution') or not record.get('sourcePolicy'):raise ValueError('map attribution missing')
        total+=size;rows.append(record)
    if total>500_000_000:raise ValueError('distribution exceeds 500 MB')
    return {'schemaVersion':1,'build':build,'bytes':total,'maps':rows,'accessVerified':False,'terrainIncluded':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',required=True,type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);parser.add_argument('--regions',required=True,type=pathlib.Path);args=parser.parse_args()
    raw=args.regions.read_bytes()
    if len(raw)>256*1024:raise ValueError('region batch exceeds 256KiB')
    value=export(args.input,json.loads(raw));temporary=args.output.with_suffix('.json.partial');temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temporary.replace(args.output)
    print(json.dumps({'maps':len(value['maps']),'bytes':value['bytes'],'build':value['build']}))

if __name__=='__main__':main()
