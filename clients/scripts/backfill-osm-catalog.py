#!/usr/bin/env python3
"""Resumable bounded spatial inventory; successful tiles revisit for updates.
Large tiles split rather than silently dropping older records at a result limit.
"""
import argparse,datetime,json,pathlib,time,os,math,atexit
from importlib.machinery import SourceFileLoader
SOURCE=SourceFileLoader('hiking_osm',str(pathlib.Path(__file__).with_name('update-route-catalog.py'))).load_module()
ROOT=pathlib.Path(__file__).resolve().parents[1];DEST=ROOT/'shared/data/catalog/osm.json';STATE=ROOT/'shared/data/catalog/osm-backfill-state.json'
REGION_PRIORITY=['china','japan','south-asia','europe','north-america','oceania','south-america','africa','asia']
# Approximate destination/city centers spread the first passes across more
# provinces; they affect queue order only and are not route/access assertions.
CHINA_HIKING_HOTSPOTS=[
 (39.9,116.4),(34.5,113.0),(34.2,108.9),(30.6,104.1),(29.3,110.5),
 (30.2,118.2),(25.0,102.7),(23.1,113.3),(24.8,110.5),(31.2,121.5),
 (29.7,91.1),(36.6,101.8),(36.1,103.8),(43.8,87.6),(42.0,128.0),
 (43.8,126.5),(38.9,121.6),(40.8,111.7),(40.1,94.7),(38.5,106.2),
 (26.6,106.7),(29.6,106.5),(29.6,103.3),(33.2,103.9),(32.4,111.0),
 (27.7,117.9),(28.2,112.9),(26.1,119.3),(30.3,120.1),(29.6,115.9),
 (22.5,114.1),(19.5,109.5),(26.9,100.2),(25.6,100.2),(31.1,110.0),
 (39.0,117.0),(36.7,117.0),(38.0,114.5),(34.5,110.0),(31.8,117.2)
]
def queue_priority(tile):
 region=tile.get('region')
 region_rank=REGION_PRIORITY.index(region) if region in REGION_PRIORITY else len(REGION_PRIORITY)
 if region!='china':return region_rank,0
 south,west,north,east=tile['bbox'];lat=(south+north)/2;lon=(west+east)/2
 # Favor well-known route areas while preserving deterministic spatial ordering.
 hotspot_distance=min(math.hypot(lat-target_lat,(lon-target_lon)*math.cos(math.radians(lat))) for target_lat,target_lon in CHINA_HIKING_HOTSPOTS)
 return region_rank,hotspot_distance
def classify_region(region,lon,lat):
 if region=='china' and 113.75<=lon<=114.55 and 22.05<=lat<=22.65:return 'hong-kong'
 if region=='china' and 113.48<=lon<=113.60 and 22.10<=lat<=22.26:return 'macao'
 # The rectangular Japan sweep overlaps Northeast China. Keep records found
 # there attached to China based on center coordinates, so repeated Japan
 # refreshes do not relabel the same relation back and forth.
 if region=='japan' and lon<=135 and lat>=41:return 'china'
 return region
def cells():
 out=[]
 for region,(south,west,north,east) in SOURCE.REGIONS.items():
  y=south
  while y<north:
   x=west
   while x<east:out.append({'region':region,'bbox':[y,x,min(y+4,north),min(x+4,east)]});x+=4
   y+=4
 # Seed a balanced queue; dispatch below prioritizes the requested China coverage.
 result=[];groups={r:[c for c in out if c['region']==r] for r in SOURCE.REGIONS}
 while any(groups.values()):
  for group in groups.values():
   if group:result.append(group.pop(0))
 return result
parser=argparse.ArgumentParser();parser.add_argument('--tiles',type=int,default=8);parser.add_argument('--allow-public-worldwide-overpass-scan',action='store_true',help='explicitly acknowledge this resumable grid scan queries most of the world using public Overpass; prefer regional extracts or an authorized service');args=parser.parse_args()
if not args.allow_public_worldwide_overpass_scan:raise SystemExit('Paused: public Overpass documentation discourages stitched worldwide bounding-box downloads. Preserve the checkpoint; migrate to regional extracts or an authorized sustainable service before resuming.')
atexit.register(SOURCE.acquire_catalog_run_lock())
previous=json.loads(DEST.read_text());state=previous.get('backfillState') or (json.loads(STATE.read_text()) if STATE.exists() else {'schemaVersion':1,'queue':cells(),'completed':[],'cycle':0})
if state.get('reconciliationVersion')!=1:
 state={'schemaVersion':1,'queue':cells(),'completed':[],'cycle':0,'reconciliationVersion':1}
 state['cycleStartedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
if not isinstance(state.get('cycleStartedAt'),str):raise SystemExit('Invalid membership cycle; previous catalog retained')
cycle=state['cycleStartedAt']
records={r['id']:r for r in previous['routes']}
for record in records.values():
 if record.get('region') in ('china','japan') and isinstance(record.get('center'),list) and len(record['center'])==2:record['region']=classify_region(record['region'],*record['center'])
success=0;failures=[];now=datetime.datetime.now(datetime.timezone.utc).isoformat();processed=0
state['queue'].sort(key=queue_priority)
for _ in range(max(1,min(args.tiles,24))):
 if not state['queue']:
  records={rid:row for rid,row in records.items() if row.get('lastSeenCycle')==cycle}
  state['queue']=state['completed'];state['completed']=[];state['cycle']+=1
  cycle=datetime.datetime.now(datetime.timezone.utc).isoformat();state['cycleStartedAt']=cycle
 if not state['queue']:break
 tile=state['queue'].pop(0);bbox=tile['bbox'];filter='' # Full membership is required to reconcile removed/retagged routes.
 country={'china':'CN','japan':'JP'}.get(tile['region']);area=f'area["ISO3166-1"="{country}"]["admin_level"="2"]->.country;' if country else '';inside='(area.country)' if country else ''
 query=f'[out:json][timeout:30];{area}relation["type"="route"]["route"~"^(hiking|foot)$"]["name"]{inside}({",".join(map(str,bbox))}){filter};out tags center 2000;'
 try:
  data=SOURCE.fetch(query);elements=data.get('elements')
  if not isinstance(elements,list):raise ValueError('Missing source membership list')
  staged={}
  for item in elements:
   if not isinstance(item,dict) or item.get('type')!='relation' or not isinstance(item.get('id'),int) or isinstance(item['id'],bool) or item['id']<=0:raise ValueError('Invalid relation identity')
   tags=item.get('tags',{});center=item.get('center',{});rid=f"osm-relation-{item['id']}"
   if not isinstance(tags,dict) or not isinstance(center,dict):raise ValueError('Invalid relation metadata')
   if rid in staged:raise ValueError('Duplicate source identity')
   if not isinstance(tags.get('name'),str) or not tags['name'].strip() or not all(isinstance(center.get(k),(int,float)) and not isinstance(center[k],bool) and math.isfinite(center[k]) for k in ('lon','lat')) or abs(center['lon'])>180 or abs(center['lat'])>90:raise ValueError('Invalid relation name or coordinates')
   if item.get('type')!='relation' or not tags.get('name') or 'lon' not in center or 'lat' not in center:continue
   region=classify_region(tile['region'],center['lon'],center['lat'])
   staged[rid]={'id':rid,'name':tags.get('name:zh') or tags['name'],'originalName':tags['name'],'region':region,'center':[center['lon'],center['lat']],'sourceUrl':f"https://www.openstreetmap.org/relation/{item['id']}",'sourceTags':{k:v for k,v in tags.items() if k in ('distance','ascent','descent','network','operator','website','description','access','ref')},'fetchedAt':now,'lastSeenCycle':cycle,'status':'待核验'}
  if len(elements)>=2000:
   south,west,north,east=bbox
   if north-south<0.125 and east-west<0.125:raise ValueError('Dense tile exceeds safe bound; retain and retry without advancing')
   midY=(south+north)/2;midX=(west+east)/2
   state['queue'].extend({'region':tile['region'],'bbox':b} for b in [[south,west,midY,midX],[south,midX,midY,east],[midY,west,north,midX],[midY,midX,north,east]])
  else:
   watermark=data.get('osm3s',{}).get('timestamp_osm_base')
   if watermark:
    parsed=datetime.datetime.fromisoformat(watermark.replace('Z','+00:00'))
    if parsed.tzinfo is None:raise ValueError('Source watermark missing timezone')
    tile['watermark']=(parsed-datetime.timedelta(minutes=10)).isoformat()
   state['completed'].append(tile)
  records.update(staged)
  success+=1;processed+=1;print(tile['region'],bbox,'records',len(elements),'catalog',len(records),flush=True)
 except Exception as e:
  tile['lastError']=str(e);state['queue'].append(tile);failures.append({'region':tile['region'],'bbox':bbox,'error':str(e)});print('Tile retained',tile['region'],str(e),flush=True)
 time.sleep(3)
if not success:raise SystemExit('All attempted tiles failed; snapshots and cursors retained')
if not state['queue']:
 removed=sum(row.get('lastSeenCycle')!=cycle for row in records.values())
 records={rid:row for rid,row in records.items() if row.get('lastSeenCycle')==cycle}
 state.update({'lastCompletedAt':now,'lastRemovedFromDiscovery':removed})
previous.update({'backfillState':state,'routes':sorted(records.values(),key=lambda r:r['id']),'generatedAt':now,'failures':failures,'backfill':{'completedTiles':len(state['completed']),'pendingTiles':len(state['queue']),'cycle':state['cycle'],'lastProcessedTiles':processed},'coverageNote':'Bounded full-membership spatial backfill and revisits; incomplete until the pending queue has been traversed. No opening or navigation permission implied.'})
# Snapshot includes the authoritative cursor; the separate state is a compatibility mirror.
for path,data in [(DEST,previous),(STATE,state)]:
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,indent=None if path==DEST else 2,separators=(',',':') if path==DEST else None,allow_nan=False)+'\n');os.replace(tmp,path)
