#!/usr/bin/env python3
"""Build bounded, attributable regional PMTiles packs from official free builds."""
import argparse,datetime,hashlib,json,math,pathlib,re,subprocess,time,urllib.request
MAX_BYTES=64*1024*1024

def parse_bounds(value, global_overview=False):
    try: bounds=tuple(float(x) for x in value.split(','))
    except ValueError: raise ValueError('bbox must contain four numbers')
    if len(bounds)!=4 or not all(math.isfinite(x) for x in bounds):raise ValueError('invalid bbox')
    west,south,east,north=bounds
    if not (-180<=west<east<=180 and -85.05112878<=south<north<=85.05112878):raise ValueError('bbox outside Web Mercator coverage; split antimeridian regions')
    if global_overview:
        if (west,south,east,north)!=(-180.0,-85.05112878,180.0,85.05112878):
            raise ValueError('global overview must cover the complete Web Mercator world')
    elif east-west>0.5 or north-south>0.5:raise ValueError('region must be at most 0.5 degrees per axis')
    return bounds

def latest_build(key=None):
    req=urllib.request.Request('https://build-metadata.protomaps.dev/builds.json',headers={'User-Agent':'HikingEarthOfflineBuilder/1.0'})
    with urllib.request.urlopen(req,timeout=30) as response:
        raw=response.read(2*1024*1024+1)
    if len(raw)>2*1024*1024:raise ValueError('build metadata exceeds budget')
    rows=json.loads(raw)
    valid=[r for r in rows if isinstance(r,dict) and re.fullmatch(r'20\d{6}\.pmtiles',str(r.get('key',''))) and str(r.get('version','')).startswith('4.') and isinstance(r.get('uploaded'),str)]
    if key is not None:
        valid=[row for row in valid if row['key']==key]
    if not valid:raise ValueError('no compatible official build')
    return max(valid,key=lambda r:r['uploaded'])

def bounded_extract(command,partial,log,max_bytes):
    with log.open('wb') as output:
        process=subprocess.Popen(command,stdout=output,stderr=output)
        started=time.monotonic()
        try:
            while process.poll() is None:
                if partial.exists() and partial.stat().st_size>max_bytes:raise ValueError('map pack exceeds remaining distribution budget')
                if time.monotonic()-started>300:raise TimeoutError('extraction exceeded five minutes')
                time.sleep(0.25)
            if process.returncode:raise RuntimeError('PMTiles extraction failed; inspect extraction log')
            if not partial.exists() or not 127<=partial.stat().st_size<=max_bytes:raise ValueError('map pack size invalid')
        except BaseException:
            if process.poll() is None:process.terminate();process.wait(timeout=10)
            raise

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pmtiles',required=True,type=pathlib.Path)
    parser.add_argument('--id',required=True)
    parser.add_argument('--name',required=True)
    parser.add_argument('--bbox',required=True)
    parser.add_argument('--minzoom',type=int,default=8)
    parser.add_argument('--maxzoom',type=int,default=15)
    parser.add_argument('--output',required=True,type=pathlib.Path)
    parser.add_argument('--build-key',help='Pin an official metadata-listed build for a reproducible batch')
    parser.add_argument('--global-overview',action='store_true',help='Build only the fixed whole-world low-zoom overview')
    parser.add_argument('--max-bytes',type=int,default=MAX_BYTES,help='Maximum bytes available to this extract (at most 64 MiB)')
    args=parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',args.id):parser.error('invalid region id')
    bounds=parse_bounds(args.bbox,args.global_overview)
    if not 0<=args.minzoom<=args.maxzoom<=15:parser.error('zoom range must be within 0..15')
    if args.global_overview and (args.id!='world-overview' or args.minzoom!=0 or args.maxzoom>5):parser.error('global overview must use world-overview ID and zoom 0..5')
    if not args.global_overview and args.id=='world-overview':parser.error('world-overview requires --global-overview')
    if not args.name.strip() or len(args.name)>80:parser.error('invalid region name')
    if args.build_key and not re.fullmatch(r'20\d{6}\.pmtiles',args.build_key):parser.error('invalid official build key')
    if type(args.max_bytes) is not int or not 127<=args.max_bytes<=MAX_BYTES:parser.error('max-bytes must be between 127 and 64 MiB')
    build=latest_build(args.build_key);source='https://build.protomaps.com/'+build['key']
    args.output.mkdir(parents=True,exist_ok=True)
    basename=args.id+'-'+build['key'].removesuffix('.pmtiles')
    target=args.output/(basename+'.pmtiles');manifest=args.output/(basename+'.json')
    if target.exists() or manifest.exists():raise FileExistsError('preserve prior pack; use a different output directory')
    partial=args.output/(basename+'.partial.pmtiles')
    if partial.exists():raise FileExistsError('existing partial download retained; inspect before retry')
    log=args.output/(basename+'.log')
    bounded_extract([str(args.pmtiles),'extract',source,str(partial),'--bbox='+','.join(map(str,bounds)),'--minzoom='+str(args.minzoom),'--maxzoom='+str(args.maxzoom),'--download-threads=2'],partial,log,args.max_bytes)
    subprocess.run([str(args.pmtiles),'verify',str(partial)],check=True,timeout=120)
    size=partial.stat().st_size;sha=hashlib.sha256(partial.read_bytes()).hexdigest()
    record={'schemaVersion':1,'id':args.id,'name':args.name.strip(),'bounds':bounds,'minZoom':args.minzoom,'maxZoom':args.maxzoom,'bytes':size,'sha256':sha,'file':target.name,'format':'pmtiles-v3','builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'upstream':{'url':source,'build':build['key'],'version':build['version'],'planetBlake3':build.get('b3sum'),'planetChecksumVerified':False},'license':'ODbL-1.0 Produced Work','attribution':'© OpenStreetMap contributors · Protomaps','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','sourcePolicy':'https://docs.protomaps.com/basemaps/downloads','note':'Whole-world low-zoom overview only; no terrain elevations or current trail access permission. Publish extracted file on our release channel; do not hotlink the planet.' if args.global_overview else 'Basemap; no terrain elevations or current trail access permission. Publish extracted file on our release channel; do not hotlink the planet.'}
    if args.global_overview:record['scope']='global-overview'
    partial.rename(target)
    temporary=manifest.with_suffix('.json.partial');temporary.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');temporary.rename(manifest)
    print(json.dumps(record,ensure_ascii=False))
if __name__=='__main__':main()
