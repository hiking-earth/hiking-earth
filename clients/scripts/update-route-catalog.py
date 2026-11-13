#!/usr/bin/env python3
"""Fetch named OSM hiking relations. ODbL snapshot; never infers access permission."""
import argparse, datetime, hashlib, json, math, pathlib, re, tempfile, time, urllib.request, urllib.parse, urllib.error, os
ROOT = pathlib.Path(__file__).resolve().parents[1]
REGIONS = {'china': (18,73,54,135), 'europe': (35,-11,71,35), 'north-america': (24,-130,60,-60), 'japan': (30,129,46,146), 'oceania': (-48,110,-10,179), 'south-america': (-56,-82,13,-34), 'africa': (-35,-18,37,52), 'south-asia': (5,65,36,100)}
# PBF country extracts may add Asian discovery records without enabling a
# broad public Overpass bounding-box scan of the continent.
DISCOVERY_REGIONS = set(REGIONS) | {'asia'}
MAX_DAILY_BYTES = 8 * 1024 * 1024
MAX_DAILY_QUERIES = 64
MAX_RESPONSE_BYTES = 1024 * 1024

class FetchFailure(RuntimeError):
    def __init__(self, message, bytes_read=None):
        super().__init__(message)
        self.bytes_read = bytes_read

class BudgetPersistenceFailure(RuntimeError):
    pass

def acquire_catalog_run_lock():
    root_hash=hashlib.sha256(str(ROOT.resolve()).encode()).hexdigest()[:20]
    lock_path=pathlib.Path(tempfile.gettempdir())/f'hiking-earth-osm-{root_hash}.lock'
    lock=lock_path.open('a+b')
    try:
        if os.name=='nt':
            import msvcrt
            lock.seek(0,os.SEEK_END)
            if lock.tell()==0:lock.write(b'0');lock.flush()
            lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
            unlock=lambda:(lock.seek(0),msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1))
        else:
            import fcntl
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            unlock=lambda:fcntl.flock(lock.fileno(),fcntl.LOCK_UN)
    except (OSError,BlockingIOError) as exc:
        lock.close()
        raise SystemExit('Another OSM catalog update is already running for this worktree') from exc
    def release():
        try:unlock()
        finally:lock.close()
    return release

def serialized_catalog_run(function):
    def run(*args,**kwargs):
        release=acquire_catalog_run_lock()
        try:return function(*args,**kwargs)
        finally:release()
    return run

def atomic_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.tmp')
    try:
        with temp.open('w',encoding='utf-8') as output:
            json.dump(value,output,ensure_ascii=False,indent=2)
            output.write('\n');output.flush();os.fsync(output.fileno())
        os.replace(temp,path)
        try:
            descriptor=os.open(path.parent,os.O_RDONLY)
            try:os.fsync(descriptor)
            finally:os.close(descriptor)
        except OSError: pass
    except OSError as exc:
        try:temp.unlink(missing_ok=True)
        except OSError:pass
        raise BudgetPersistenceFailure(f'Cannot persist OSM request budget: {exc}') from exc

def read_daily_budget(raw, present, today, source):
    if not present:return {'dateUTC':today,'downloadedBytes':0,'queryCount':0}
    if not isinstance(raw,dict) or not raw:
        raise SystemExit(f'Invalid {source} OSM daily budget; refusing to reset the budget and query')
    budget_date=raw.get('dateUTC')
    try:
        if not isinstance(budget_date,str):raise ValueError()
        parsed=datetime.date.fromisoformat(budget_date)
        if parsed.isoformat()!=budget_date:raise ValueError()
    except ValueError:raise SystemExit(f'Invalid {source} OSM daily budget date; refusing to reset the budget and query')
    current=datetime.date.fromisoformat(today)
    if parsed>current:raise SystemExit(f'{source} OSM daily budget date is in the future; refusing to query')
    if parsed<current:return {'dateUTC':today,'downloadedBytes':0,'queryCount':0}
    if any(key not in raw for key in ('downloadedBytes','queryCount')):
        raise SystemExit(f'Incomplete {source} OSM daily budget; refusing to reset the budget and query')
    budget={'dateUTC':today,'downloadedBytes':raw['downloadedBytes'],'queryCount':raw['queryCount']}
    for key in ('downloadedBytes','queryCount'):
        if not isinstance(budget[key],int) or isinstance(budget[key],bool) or budget[key]<0:
            raise SystemExit(f'Invalid {source} OSM daily budget field {key}; refusing to reset the budget and query')
    if budget['queryCount']>MAX_DAILY_QUERIES or budget['downloadedBytes']>MAX_DAILY_BYTES:
        raise SystemExit(f'{source} OSM daily budget exceeds configured limit; refusing additional queries')
    return budget

def fetch(query, byte_limit=24 * 1024 * 1024):
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data':query}).encode(), headers={'User-Agent':'HikingEarthCatalog/1.0 (+https://github.com/hiking-earth/clients)'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read(byte_limit)
    except urllib.error.HTTPError as exc:
        try: consumed = len(exc.read(byte_limit))
        except Exception: consumed = None
        raise FetchFailure(f'HTTP {exc.code}: {exc.reason}', consumed) from exc
    except Exception as exc:
        partial=getattr(exc,'partial',b'')
        raise FetchFailure(str(exc),len(partial) if isinstance(partial,(bytes,bytearray)) and partial else None) from exc
    if len(raw) >= byte_limit:
        raise FetchFailure(f'Response reached byte budget ({byte_limit}); watermark retained', len(raw))
    try:
        data = json.loads(raw)
        if data.get('remark'): raise ValueError(data['remark'])
        return data, len(raw)
    except Exception as exc:
        raise FetchFailure(str(exc), len(raw)) from exc

def parse_time(value):
    parsed=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None: raise ValueError('Source timestamp has no timezone')
    return parsed.astimezone(datetime.timezone.utc)

def classify_region(region,lon,lat):
    if region=='china' and 113.75<=lon<=114.55 and 22.05<=lat<=22.65:return 'hong-kong'
    if region=='china' and 113.48<=lon<=113.60 and 22.10<=lat<=22.26:return 'macao'
    if region=='japan' and lon<=135 and lat>=41:return 'china'
    return region

def named_relation_center(tags,center,relation_id):
    name=tags.get('name')
    if not isinstance(name,str) or not name.strip():return None
    lon,lat=center.get('lon'),center.get('lat')
    if not all(isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) for value in (lon,lat)):
        raise ValueError(f'Named OSM relation {relation_id} has no valid center; region snapshot and cursor retained')
    if abs(lon)>180 or abs(lat)>90:
        raise ValueError(f'Named OSM relation {relation_id} center is out of range; region snapshot and cursor retained')
    return lon,lat

def validate_previous_snapshot(previous, path):
    if not isinstance(previous, dict) or not isinstance(previous.get('routes'), list):
        raise SystemExit(f'Invalid OSM catalog snapshot at {path}; previous snapshot retained')
    seen=set()
    allowed_regions=DISCOVERY_REGIONS|{'hong-kong','macao'}
    for index, route in enumerate(previous['routes']):
        if not isinstance(route, dict):
            raise SystemExit(f'Invalid OSM route at index {index}; previous snapshot retained')
        route_id=route.get('id')
        match=re.fullmatch(r'osm-relation-([1-9][0-9]*)', route_id) if isinstance(route_id,str) else None
        if not match or route_id in seen:
            raise SystemExit(f'Invalid or duplicate OSM route ID at index {index}; previous snapshot retained')
        seen.add(route_id)
        name, original_name, region = route.get('name'), route.get('originalName'), route.get('region')
        center, source_url, tags, fetched_at = route.get('center'), route.get('sourceUrl'), route.get('sourceTags'), route.get('fetchedAt')
        if (not isinstance(name,str) or not name.strip() or not isinstance(original_name,str) or not original_name.strip()
            or region not in allowed_regions or not isinstance(center,list) or len(center)!=2
            or any(not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value) for value in center)
            or abs(center[0])>180 or abs(center[1])>90
            or source_url!=f'https://www.openstreetmap.org/relation/{match.group(1)}'
            or not isinstance(tags,dict) or any(not isinstance(key,str) or not isinstance(value,str) for key,value in tags.items())
            or not isinstance(route.get('status'),str) or not isinstance(fetched_at,str)):
            raise SystemExit(f'Invalid OSM route fields at index {index} ({route_id}); previous snapshot retained')
        try:
            parse_time(fetched_at)
        except (TypeError,ValueError):
            raise SystemExit(f'Invalid OSM fetchedAt at index {index} ({route_id}); previous snapshot retained')
        if 'lastSeenCycle' in route and not isinstance(route['lastSeenCycle'],str):
            raise SystemExit(f'Invalid OSM reconciliation marker at index {index} ({route_id}); previous snapshot retained')
        if 'pbfSources' in route:
            sources=route['pbfSources']
            if (not isinstance(sources,list)
                or any(not isinstance(source,str) or not re.fullmatch(r'[a-z0-9][a-z0-9/_-]{0,99}',source) for source in sources)
                or len(set(sources))!=len(sources)):
                raise SystemExit(f'Invalid OSM PBF source provenance at index {index} ({route_id}); previous snapshot retained')

@serialized_catalog_run
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--regions',nargs='+',choices=list(REGIONS),default=list(REGIONS));parser.add_argument('--bootstrap-lookback-hours',type=int,default=24)
    args=parser.parse_args();dest=ROOT/'shared/data/catalog/osm.json'
    try: previous=json.loads(dest.read_text()) if dest.exists() else {'routes':[]}
    except (OSError,json.JSONDecodeError) as exc: raise SystemExit(f'Cannot safely read OSM catalog; previous snapshot retained: {exc}')
    validate_previous_snapshot(previous,dest)
    records={r['id']:r for r in previous['routes']}
    now_dt=datetime.datetime.now(datetime.timezone.utc);now=now_dt.isoformat(timespec='seconds').replace('+00:00','Z')
    failures=[];counts={};cursors=previous.get('sourceCursors',{})
    if not isinstance(cursors,dict):raise SystemExit('Invalid OSM source cursors; refusing to refresh without a trusted snapshot')
    today=now_dt.date().isoformat()
    snapshot_budget=read_daily_budget(previous.get('sourceBudget'), 'sourceBudget' in previous, today, 'snapshot')
    ledger_path=dest.with_name('osm-query-budget.json')
    try:
        ledger_raw=json.loads(ledger_path.read_text()) if ledger_path.exists() else None
    except (OSError,json.JSONDecodeError) as exc:raise SystemExit(f'Cannot safely read OSM request-budget ledger; refusing to query: {exc}')
    ledger=read_daily_budget(ledger_raw,ledger_path.exists(),today,'durable ledger')
    budget={'dateUTC':today,'downloadedBytes':max(snapshot_budget['downloadedBytes'],ledger['downloadedBytes']),'queryCount':max(snapshot_budget['queryCount'],ledger['queryCount']),'dailyByteLimit':MAX_DAILY_BYTES,'dailyQueryLimit':MAX_DAILY_QUERIES,'perResponseByteLimit':MAX_RESPONSE_BYTES}
    if budget['queryCount']>MAX_DAILY_QUERIES or budget['downloadedBytes']>MAX_DAILY_BYTES:
        raise SystemExit('Recorded OSM daily source budget exceeds configured limit; refusing additional queries')
    atomic_json(ledger_path,{key:budget[key] for key in ('dateUTC','downloadedBytes','queryCount')})
    state=previous.get('backfillState') or {}
    active_cycle=state.get('cycleStartedAt') if state.get('reconciliationVersion')==1 else None
    try:bootstrap=parse_time(previous['generatedAt'])-datetime.timedelta(hours=max(1,min(args.bootstrap_lookback_hours,168)))
    except (KeyError,TypeError,ValueError):bootstrap=now_dt-datetime.timedelta(hours=max(1,min(args.bootstrap_lookback_hours,168)))
    order=['china','japan','south-asia','europe','north-america','oceania','south-america','africa']
    ordered_regions=sorted(args.regions,key=lambda item:order.index(item))
    for index,region in enumerate(ordered_regions):
        if budget['queryCount']>=MAX_DAILY_QUERIES or budget['downloadedBytes']>=MAX_DAILY_BYTES:
            failures.append({'region':region,'error':'Daily public-source budget exhausted; watermark retained'})
            continue
        byte_limit=min(MAX_RESPONSE_BYTES,MAX_DAILY_BYTES-budget['downloadedBytes'])
        bbox=','.join(str(v) for v in REGIONS[region])
        reserved_bytes=0
        try:
            try:since=parse_time(cursors[region]) if isinstance(cursors.get(region),str) else bootstrap
            except (TypeError,ValueError):since=bootstrap
            if since>now_dt+datetime.timedelta(minutes=10):since=bootstrap
            since_text=since.isoformat(timespec='seconds').replace('+00:00','Z')
            query=f'[out:json][timeout:45];relation["type"="route"]["route"~"^(hiking|foot)$"]["name"]({bbox})(newer:"{since_text}");out tags center;'
            budget['queryCount']+=1
            budget['downloadedBytes']+=byte_limit
            reserved_bytes=byte_limit
            atomic_json(ledger_path,{key:budget[key] for key in ('dateUTC','downloadedBytes','queryCount')})
            data,bytes_read=fetch(query,byte_limit)
            budget['downloadedBytes']-=byte_limit-bytes_read
            reserved_bytes=0
            atomic_json(ledger_path,{key:budget[key] for key in ('dateUTC','downloadedBytes','queryCount')})
            elements=data.get('elements')
            if not isinstance(elements,list):raise ValueError('Missing source relation list')
            watermark=data.get('osm3s',{}).get('timestamp_osm_base')
            if not isinstance(watermark,str) or not watermark.strip():
                raise ValueError('Missing OSM source watermark; region snapshot and cursor retained')
            source_time=parse_time(watermark)
            if source_time>now_dt+datetime.timedelta(minutes=10):
                raise ValueError('OSM source watermark is too far in the future; region snapshot and cursor retained')
            next_cursor=source_time-datetime.timedelta(minutes=10)
            if next_cursor<since:next_cursor=since
            staged={}
            for item in elements:
                if not isinstance(item,dict) or item.get('type')!='relation':raise ValueError('Invalid OSM relation record')
                rid_value=item.get('id')
                if not isinstance(rid_value,int) or isinstance(rid_value,bool) or rid_value<=0:raise ValueError('Invalid OSM relation identity')
                tags=item.get('tags',{});center=item.get('center',{})
                if not isinstance(tags,dict) or not isinstance(center,dict):raise ValueError('Invalid OSM relation metadata')
                coordinates=named_relation_center(tags,center,rid_value)
                if coordinates is None:continue
                lon,lat=coordinates
                rid=f'osm-relation-{rid_value}';observed=classify_region(region,lon,lat)
                # Keep the first region from the deterministic preferred order
                # when a relation lies in overlapping discovery rectangles.
                if rid in staged:continue
                old=records.get(rid)
                old_region=old.get('region') if old else None
                chosen=old_region if old_region in DISCOVERY_REGIONS or old_region in ('hong-kong','macao') else observed
                old_status=old.get('status') if old and isinstance(old.get('status'),str) else '待核验'
                row={'id':rid,'name':tags.get('name:zh') or tags['name'],'originalName':tags['name'],'region':chosen,'center':[lon,lat], 'sourceUrl':f'https://www.openstreetmap.org/relation/{rid_value}','sourceTags':{k:v for k,v in tags.items() if k in ('distance','ascent','descent','network','operator','website','description','access','ref')},'fetchedAt':now,'status':old_status}
                if old and isinstance(old.get('pbfSources'),list):row['pbfSources']=old['pbfSources']
                if active_cycle:row['lastSeenCycle']=active_cycle
                staged[rid]=row
            records.update(staged);counts[region]=len(staged)
            if next_cursor:cursors[region]=next_cursor.isoformat(timespec='seconds').replace('+00:00','Z')
        except BudgetPersistenceFailure as exc:
            raise SystemExit(str(exc)) from exc
        except Exception as exc:
            if reserved_bytes:
                consumed=getattr(exc,'bytes_read',None)
                if isinstance(consumed,int) and not isinstance(consumed,bool) and 0<=consumed<=reserved_bytes:
                    budget['downloadedBytes']-=reserved_bytes-consumed
                atomic_json(ledger_path,{key:budget[key] for key in ('dateUTC','downloadedBytes','queryCount')})
            failures.append({'region':region,'error':str(exc)});print(region,'retained previous snapshot:',str(exc),flush=True)
        if index<len(ordered_regions)-1:time.sleep(3)
    snapshot=dict(previous);snapshot.update({'schemaVersion':1,'lastUpdateAttemptAt':now,'sourceBudget':budget,'sourceCursors':cursors,'failures':failures})
    if counts:
        # These are records returned by this incremental refresh, not a count
        # of all catalog records in a region or a measure of geographic coverage.
        snapshot.update({'generatedAt':now,'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','licenseUrl':'https://www.openstreetmap.org/copyright','lastRefreshCounts':counts,'coverage':counts,'routes':sorted(records.values(),key=lambda r:r['id'])})
    dest.parent.mkdir(parents=True,exist_ok=True);temp=dest.with_suffix('.tmp');temp.write_text(json.dumps(snapshot,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n');os.replace(temp,dest)
    result={'catalogCount':len(records),'lastRefreshCounts':counts,'coverage':counts,'sourceCursors':cursors,'failures':len(failures),'sourceBudget':budget}
    print(json.dumps(result,ensure_ascii=False))
    if not counts:raise SystemExit('No OSM regions refreshed; query budget and failure state saved without advancing source watermarks')
if __name__=='__main__': main()
