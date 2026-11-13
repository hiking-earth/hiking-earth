#!/usr/bin/env python3
"""Resume a bounded regional map batch; preserve verified packs and failed partials."""
import argparse,hashlib,importlib.util,json,pathlib,subprocess,sys
MAX_TOTAL_BYTES=500_000_000
MAX_PACK_BYTES=64*1024*1024
MAX_CUSTOM_MAP_PAYLOAD_BYTES=191*1024*1024
SPEC=importlib.util.spec_from_file_location('region_builder',pathlib.Path(__file__).with_name('build-offline-region.py'))
builder=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(builder)

def distribution_budget(max_total_bytes,custom_delivery=False):
    if type(max_total_bytes) is not int or not 127<=max_total_bytes<=MAX_TOTAL_BYTES:raise ValueError('max-total-bytes must be between 127 and 500,000,000 bytes')
    return min(max_total_bytes,MAX_CUSTOM_MAP_PAYLOAD_BYTES) if custom_delivery else max_total_bytes

def validate_regions(value):
    if (not isinstance(value,dict) or type(value.get('schemaVersion')) is not int
            or value.get('schemaVersion')!=1 or not isinstance(value.get('regions'),list)
            or not 1<=len(value['regions'])<=32):raise ValueError('invalid region batch')
    ids=set();result=[]
    for row in value['regions']:
        if not isinstance(row,dict):raise ValueError('invalid region')
        ident=row.get('id');name=row.get('name');bbox=row.get('bbox');low=row.get('minZoom',8);high=row.get('maxZoom',15);scope=row.get('scope')
        if not isinstance(ident,str) or not builder.re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',ident) or ident in ids:raise ValueError('invalid duplicate region id')
        if not isinstance(name,str) or not name.strip() or len(name)>80 or not isinstance(bbox,str):raise ValueError('invalid region description')
        global_overview=scope=='global-overview'
        if scope not in (None,'global-overview'):raise ValueError('unsupported offline map scope')
        builder.parse_bounds(bbox,global_overview=global_overview)
        if type(low) is not int or type(high) is not int or not 0<=low<=high<=15:raise ValueError('invalid zoom range')
        if global_overview and (ident!='world-overview' or low!=0 or high>5):raise ValueError('global overview must be world-overview at zoom 0..5')
        if not global_overview and ident=='world-overview':raise ValueError('world-overview requires global-overview scope')
        ids.add(ident);normalized=dict(id=ident,name=name.strip(),bbox=bbox,minZoom=low,maxZoom=high)
        if global_overview:normalized['scope']=scope
        result.append(normalized)
    return result

def verified_pack(output,row,key):
    stem=row['id']+'-'+key.removesuffix('.pmtiles');manifest=output/(stem+'.json');pack=output/(stem+'.pmtiles')
    if not manifest.exists() or not pack.exists():return False
    try:record=json.loads(manifest.read_text());size=pack.stat().st_size
    except (ValueError,OSError):return False
    if (not isinstance(record,dict) or type(record.get('schemaVersion')) is not int
            or record.get('schemaVersion')!=1 or not isinstance(record.get('upstream'),dict)):
        return False
    global_overview=row.get('scope')=='global-overview'
    if record.get('id')!=row['id'] or record.get('scope')!=row.get('scope') or record.get('upstream',{}).get('build')!=key or record.get('bounds')!=list(builder.parse_bounds(row['bbox'],global_overview=global_overview)) or record.get('minZoom')!=row['minZoom'] or record.get('maxZoom')!=row['maxZoom'] or record.get('bytes')!=size or not 127<=size<=builder.MAX_BYTES:return False
    return hashlib.sha256(pack.read_bytes()).hexdigest()==record.get('sha256')

def validate_checkpoint(state):
    if (not isinstance(state,dict) or type(state.get('schemaVersion')) is not int
            or state.get('schemaVersion')!=1 or not isinstance(state.get('regions'),dict)):
        raise ValueError('invalid batch checkpoint')
    return state

def checkpoint(path,value):
    temp=path.with_suffix('.json.partial');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--regions',required=True,type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);parser.add_argument('--pmtiles',required=True,type=pathlib.Path);parser.add_argument('--max-total-bytes',type=int,default=MAX_TOTAL_BYTES,help='Maximum complete batch size (at most 500 MB)');parser.add_argument('--custom-delivery',action='store_true',help='Reserve ZIP metadata space under the 192 MiB client archive limit');args=parser.parse_args()
    try:args.max_total_bytes=distribution_budget(args.max_total_bytes,args.custom_delivery)
    except ValueError as error:parser.error(str(error))
    raw=args.regions.read_bytes()
    if len(raw)>256*1024:raise ValueError('region batch exceeds 256KiB')
    rows=validate_regions(json.loads(raw));fingerprint=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest();args.output.mkdir(parents=True,exist_ok=True);state_path=args.output/'batch.json'
    if state_path.exists():
        state=validate_checkpoint(json.loads(state_path.read_text()))
        if state.get('configSha256')!=fingerprint:raise ValueError('batch configuration changed; use a separate output directory')
        key=state.get('build')
        if not isinstance(key,str) or not builder.re.fullmatch(r'20\d{6}\.pmtiles',key):raise ValueError('invalid batch checkpoint')
    else:
        key=builder.latest_build()['key'];state={'schemaVersion':1,'configSha256':fingerprint,'build':key,'regions':{}};checkpoint(state_path,state)
    failed=[];completed_bytes=0
    for row in rows:
        ident=row['id']
        if verified_pack(args.output,row,key):
            pack=args.output/(ident+'-'+key.removesuffix('.pmtiles')+'.pmtiles')
            try:check=subprocess.run([str(args.pmtiles),'verify',str(pack)],timeout=120,capture_output=True)
            except subprocess.TimeoutExpired:check=None
            if check is not None and check.returncode==0:
                completed_bytes+=pack.stat().st_size
                if completed_bytes>args.max_total_bytes:raise ValueError('verified maps exceed configured total distribution budget')
                state['regions'][ident]='complete';checkpoint(state_path,state);continue
        remaining=args.max_total_bytes-completed_bytes
        if remaining<127:
            state['regions'][ident]='failed';checkpoint(state_path,state);failed.append(ident);print(json.dumps({'id':ident,'status':'failed','reason':'distribution-budget-exhausted'}),flush=True);break
        state['regions'][ident]='running';checkpoint(state_path,state)
        command=[sys.executable,str(pathlib.Path(__file__).with_name('build-offline-region.py')),'--pmtiles',str(args.pmtiles),'--id',ident,'--name',row['name'],'--bbox='+row['bbox'],'--minzoom',str(row['minZoom']),'--maxzoom',str(row['maxZoom']),'--build-key',key,'--max-bytes',str(min(MAX_PACK_BYTES,remaining)),'--output',str(args.output)]
        if row.get('scope')=='global-overview':command.append('--global-overview')
        try:result=subprocess.run(command,timeout=480,capture_output=True,text=True)
        except subprocess.TimeoutExpired:
            state['regions'][ident]='failed';checkpoint(state_path,state);failed.append(ident);print(json.dumps({'id':ident,'status':'failed','reason':'timeout'}),flush=True);continue
        if result.returncode:
            with (args.output/(ident+'.stderr.log')).open('a') as log:log.write(result.stderr[-20000:]+'\n')
        good=result.returncode==0 and verified_pack(args.output,row,key);state['regions'][ident]='complete' if good else 'failed'
        if good:completed_bytes+=(args.output/(ident+'-'+key.removesuffix('.pmtiles')+'.pmtiles')).stat().st_size
        checkpoint(state_path,state)
        print(json.dumps({'id':ident,'status':state['regions'][ident]},ensure_ascii=False),flush=True)
        if not good:failed.append(ident)
    if failed:raise RuntimeError('regional batch incomplete: '+', '.join(failed)+'; inspect retained files before retry')
if __name__=='__main__':main()
