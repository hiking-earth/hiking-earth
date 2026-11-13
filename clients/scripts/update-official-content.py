#!/usr/bin/env python3
"""Collect official RSS metadata only; preserve prior data on source failure.
No article bodies/images are copied and no item grants route opening permission.
Repeat --source-id to refresh a subset while leaving all other source snapshots intact.
"""
import datetime as dt
import argparse
import hashlib
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from official_content_policy import (apply_bounded_metadata_policy, bounded_withheld_history,
                                     build_official_news_snapshot,
                                     review_and_replace_source_snapshot,
                                     SourceSnapshotReviewError, synchronize_source_states,
                                     validate_official_source_registry)
from official_feed_xml import item_publication_date, parse_rss
from official_feed_transport import SameOriginHTTPSRedirectHandler
from official_content_io import encode_json_bounded, read_json_bounded
ROOT=pathlib.Path(__file__).resolve().parents[1]
TARGET=ROOT/'shared/data/content/official-news.json'
SOURCE_CONFIG=ROOT/'shared/data/content/official-sources.json'
MAX_SOURCE_REGISTRY_BYTES=1024*1024
MAX_EXISTING_SNAPSHOT_BYTES=8*1024*1024
MAX_OUTPUT_SNAPSHOT_BYTES=16*1024*1024
config=read_json_bounded(SOURCE_CONFIG,MAX_SOURCE_REGISTRY_BYTES,'official source registry')
SOURCES,MAX_ITEMS_PER_FEED=validate_official_source_registry(config)
parser=argparse.ArgumentParser(description='Refresh metadata-only outdoor notices from approved official RSS sources.')
parser.add_argument('--source-id',action='append',default=[],help='refresh only this registered source; repeat to select several sources')
args=parser.parse_args()
if len(args.source_id)!=len(set(args.source_id)):parser.error('--source-id values must be unique')
unknown_sources=set(args.source_id)-{source['id'] for source in SOURCES}
if unknown_sources:parser.error('unknown source id(s): '+', '.join(sorted(unknown_sources)))
selected_source_ids=set(args.source_id)
COLLECT_SOURCES=[source for source in SOURCES if not selected_source_ids or source['id'] in selected_source_ids]

def collect(source):
 req=urllib.request.Request(source['url'],headers={'User-Agent':'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)','Accept':'application/rss+xml, application/xml, text/xml'})
 opener=urllib.request.build_opener(SameOriginHTTPSRedirectHandler(source['url']))
 with opener.open(req,timeout=30) as response:
  redirect=urllib.parse.urlparse(response.url)
  if redirect.scheme!='https' or redirect.hostname!=urllib.parse.urlparse(source['url']).hostname or redirect.username or redirect.password or redirect.port:raise ValueError('unexpected redirect domain')
  data=response.read(2_000_001)
 if len(data)>2_000_000:raise ValueError('feed too large')
 tree=parse_rss(data)
 feed_items=tree.findall('./channel/item')
 if not feed_items:raise ValueError('empty official feed; prior source items retained')
 rows=[];seen=set();now=dt.datetime.now(dt.timezone.utc).isoformat()
 for item in feed_items[:source.get('maxItems',MAX_ITEMS_PER_FEED)]:
  title=' '.join((item.findtext('title') or '').split())[:300]
  if source.get('includeCategoriesInTitle'):
   categories=[]
   for category in item.findall('category'):
    value=' '.join((category.text or '').split())
    if value and len(value)<=100 and value not in categories and len(categories)<8:categories.append(value)
   if categories:title=' · '.join((*categories[:2],title))[:300]
  link=(item.findtext('link') or '').strip();parsed=urllib.parse.urlparse(link)
  if not title or parsed.scheme!='https' or parsed.hostname not in source['articleHosts'] or parsed.username or parsed.password or parsed.port:continue
  # Feeds may repeat the same article in more than one item (for example,
  # after changing categories). Keep the first valid occurrence instead of
  # discarding the entire source snapshot.
  if link in seen:continue
  seen.add(link)
  keywords=source.get('titleKeywords',[])
  if keywords and not any(word.casefold() in title.casefold() for word in keywords):continue
  published=item_publication_date(item)
  rows.append({'id':source['id']+'-'+hashlib.sha256(link.encode()).hexdigest()[:20],'title':title,'url':link,'region':source['region'],**({'center':source['center']} if 'center' in source else {}),'industry':'开放管理','importance':'中','publishedAt':published,'sourceLabel':source['label'],'sourceUrl':source['url'],'fetchedAt':now,'verified':True,'sourceId':source['id']})
 # A non-empty upstream feed with zero accepted rows is ambiguous: the source
 # may have changed its format, or our title filter may have become stale.
 # Keep the previous snapshot until at least one current record is reviewed.
 if feed_items and not rows:raise ValueError('no accepted official metadata; prior source snapshot retained')
 return rows
# Linux scheduled runners and macOS local collectors share a per-target OS lock.
# The kernel releases it on process exit, including crashes; do not unlink it.
import fcntl
import tempfile
lock_path=pathlib.Path(tempfile.gettempdir())/('hiking-news-'+hashlib.sha256(str(TARGET.resolve()).encode()).hexdigest()+'.lock')
lock_file=lock_path.open('a')
try:fcntl.flock(lock_file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:
 print('official content collection already running for this target; skipped',flush=True)
 sys.exit(0)
old=read_json_bounded(TARGET,MAX_EXISTING_SNAPSHOT_BYTES,'existing official-news snapshot') if TARGET.exists() else {'schemaVersion':1,'items':[],'sources':[]}
items={r['id']:r for r in old.get('items',[]) if isinstance(r,dict) and isinstance(r.get('id'),str)}
states={r['id']:r for r in synchronize_source_states(SOURCES,old.get('sources',[]))};failed=0
retired=[];source_withheld=[]
for source in COLLECT_SOURCES:
 rejected=[]
 try:
  rows=collect(source)
  reviewed_at=dt.datetime.now(dt.timezone.utc)
  visible,source_retired,rejected,expired_ids,expired_rows=review_and_replace_source_snapshot(
   list(items.values()),source['id'],rows,{source['id']:source},reviewed_at)
  items={row['id']:row for row in visible if isinstance(row,dict) and isinstance(row.get('id'),str)}
  retired_at=dt.datetime.now(dt.timezone.utc).isoformat()
  retired.extend({'record':row,'reason':'publication-expired' if row.get('id') in expired_ids else 'not-in-current-feed','reviewedAt':retired_at} for row in source_retired)
  source_withheld.extend(rejected)
  source_withheld.extend({'record':row,'reason':'publication-expired','reviewedAt':reviewed_at.isoformat()} for row in expired_rows)
  states[source['id']]={**source,'lastSuccess':dt.datetime.now(dt.timezone.utc).isoformat(),'lastAttempt':dt.datetime.now(dt.timezone.utc).isoformat(),'lastError':None,'lastCollectedCount':len(rows),'lastWithheldCount':len(rejected),'lastExpiredCount':len(expired_ids),'lastWithheldReasons':sorted({item['reason'] for item in rejected})}
  print(source['id'],len(rows),'official items',flush=True)
 except SourceSnapshotReviewError as e:
  failed+=1
  source_withheld.extend(e.rejected)
  reviewed_at=dt.datetime.now(dt.timezone.utc).isoformat()
  source_withheld.extend({'record':row,'reason':'publication-expired','reviewedAt':reviewed_at} for row in e.expired_rows)
  prior_state=states.get(source['id'],{})
  history={key:prior_state[key] for key in ('lastSuccess','lastCollectedCount') if key in prior_state}
  reasons={item['reason'] for item in e.rejected if isinstance(item,dict) and isinstance(item.get('reason'),str)}
  if e.expired_rows:reasons.add('publication-expired')
  states[source['id']]={**source,**history,'lastError':str(e),'lastAttempt':reviewed_at,'lastWithheldCount':len(e.rejected),'lastExpiredCount':len(e.expired_ids),'lastWithheldReasons':sorted(reasons)}
  print(source['id'],'failed review; prior snapshot retained:',str(e),file=sys.stderr,flush=True)
 except Exception as e:
  failed+=1;source_withheld.extend(rejected)
  prior_state=states.get(source['id'],{})
  history={key:prior_state[key] for key in ('lastSuccess','lastCollectedCount','lastWithheldCount','lastExpiredCount','lastWithheldReasons') if key in prior_state}
  states[source['id']]={**source,**history,'lastError':str(e),'lastAttempt':dt.datetime.now(dt.timezone.utc).isoformat(),**({'lastWithheldCount':len(rejected),'lastWithheldReasons':sorted({item['reason'] for item in rejected})} if rejected else {})}
  print(source['id'],'failed; prior snapshot retained:',str(e),file=sys.stderr,flush=True)
def order_time(row):
 value=row.get('publishedAt') or row.get('fetchedAt')
 try:
  stamp=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
  if stamp.tzinfo is None:stamp=stamp.replace(tzinfo=dt.timezone.utc)
  return stamp.timestamp()
 except (ValueError,TypeError,AttributeError,OverflowError):return 0
policy_now=dt.datetime.now(dt.timezone.utc)
ordered_items=sorted(items.values(),key=order_time,reverse=True)
published,withheld=apply_bounded_metadata_policy(ordered_items,SOURCES,policy_now,500)
result=build_official_news_snapshot(list(states.values()),published,policy_now,
                                    len(COLLECT_SOURCES),failed)
TARGET.parent.mkdir(parents=True,exist_ok=True)
# Keep withheld source metadata recoverable without exposing it as current news.
# This is a freshness policy for an index, never an automatic trail opening decision.
prior_withheld=old.get('withheldItems',[])
def history_key(item):
 record=item.get('record') if isinstance(item,dict) else None
 identity=record.get('id') if isinstance(record,dict) else None
 return f"{identity}:{item.get('reason','unknown')}" if identity else None
history={key:item for item in prior_withheld if (key:=history_key(item))}
newly_withheld=[*retired,*source_withheld,*withheld]
for item in newly_withheld:
 key=history_key(item)
 if key:history[key]=item
newly_withheld_keys={key for item in newly_withheld if (key:=history_key(item))}
for row in published:
 for key,item in list(history.items()):
  record=item.get('record',{})
  if record.get('id')==row.get('id') and key not in newly_withheld_keys:history.pop(key,None)
result['withheldItems']=bounded_withheld_history(list(history.values()),500)
result['publicationPolicy']={'version':1,'scope':'metadata-links-only','maxFreshnessAgeDays':90,'maxPublicationAgeDays':90,'reviewedAt':policy_now.isoformat(),'withheldCount':len(withheld)+len(source_withheld),'expiredCount':sum(1 for item in newly_withheld if item.get('reason')=='publication-expired'),'accessVerified':False}
output_payload=encode_json_bounded(result,MAX_OUTPUT_SNAPSHOT_BYTES,'official-news snapshot')
# Unique sibling temp file keeps incomplete writes separate from the snapshot.
with tempfile.NamedTemporaryFile(mode='wb',dir=TARGET.parent,prefix=TARGET.name+'.',suffix='.tmp',delete=False) as file:
 file.write(output_payload);temporary=pathlib.Path(file.name)
try:temporary.replace(TARGET)
finally:temporary.unlink(missing_ok=True)
if failed:
 status='all-attempted-sources-failed' if failed==len(COLLECT_SOURCES) else 'partial'
 print(f'official news refresh state: {status}; {failed}/{len(COLLECT_SOURCES)} feeds failed; '
       'the new snapshot contains only cached metadata that passed current expiry and source policy.',
       file=sys.stderr,flush=True)
