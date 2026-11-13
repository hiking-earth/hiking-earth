#!/usr/bin/env python3
"""Prepare a fresh scenic catalog from explicit human approvals; no network or publication."""
import argparse,datetime as dt,hashlib,json,re
from pathlib import Path
from urllib.parse import urlsplit,parse_qs,unquote
LICENSES={'CC BY 4.0':'https://creativecommons.org/licenses/by/4.0/','CC BY-SA 4.0':'https://creativecommons.org/licenses/by-sa/4.0/','CC BY 3.0':'https://creativecommons.org/licenses/by/3.0/','CC BY-SA 3.0':'https://creativecommons.org/licenses/by-sa/3.0/','CC0 1.0':'https://creativecommons.org/publicdomain/zero/1.0/'}
def url(value,host):
 if not isinstance(value,str):raise ValueError('missing source URL')
 parsed=urlsplit(value)
 if parsed.scheme!='https' or parsed.hostname!=host or parsed.username or parsed.password or parsed.port or parsed.fragment:raise ValueError('invalid source URL')
 return parsed

def timestamp(value):
 if not isinstance(value,str):raise ValueError('missing review date')
 result=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
 if result.tzinfo is None:raise ValueError('review dates require timezone')
 return result

def prepare(data,reviewer,now):
 if not isinstance(data,dict) or data.get('schemaVersion')!=1 or not isinstance(data.get('candidates'),list) or len(data['candidates'])>5000:raise ValueError('invalid candidate queue')
 if not isinstance(reviewer,str) or not reviewer.strip() or len(reviewer)>128:raise ValueError('expected reviewer is required')
 result=[];seen=set();skipped=[]
 for item in data['candidates']:
  if not isinstance(item,dict):raise ValueError('invalid candidate record')
  ident=item.get('id')
  if not isinstance(ident,str) or not re.fullmatch(r'commons-[0-9]+-[a-f0-9]{12}',ident) or ident in seen:raise ValueError('invalid/duplicate candidate id')
  seen.add(ident)
  if item.get('reviewStatus')!='approved':skipped.append({'id':ident,'reason':'not-approved'});continue
  if item.get('reviewedBy')!=reviewer:raise ValueError('approved record reviewer does not match expected owner')
  reviewed=timestamp(item.get('reviewedAt')).astimezone(dt.timezone.utc);expires=timestamp(item.get('expiresAt')).astimezone(dt.timezone.utc)
  if reviewed>now or expires<=reviewed or expires>reviewed+dt.timedelta(days=90):raise ValueError('invalid approval validity window')
  if expires<=now:skipped.append({'id':ident,'reason':'expired'});continue
  if not isinstance(item.get('rightsConfirmed'),list) or set(item['rightsConfirmed'])!={'source-author','region-match','license-attribution','privacy-other-rights'}:raise ValueError('explicit human rights confirmations required')
  if item.get('reviewInvalidatedAt') and timestamp(item['reviewInvalidatedAt']+'T00:00:00Z')>reviewed:raise ValueError('source change needs a new review')
  revision=url(item.get('approvedSourceRevision'),'commons.wikimedia.org');query=parse_qs(revision.query)
  if revision.path!='/w/index.php' or not re.fullmatch(r'[1-9][0-9]*',query.get('oldid',[''])[0]) or not query.get('title',[''])[0].startswith('File:'):raise ValueError('approval requires immutable Commons file revision')
  original=url(item.get('sourceUrl'),'commons.wikimedia.org')
  if not original.path.startswith('/wiki/File:') or unquote(original.path[len('/wiki/'):]).replace('_',' ')!=query['title'][0].replace('_',' '):raise ValueError('approval revision must belong to the discovered file')
  url(item.get('imageUrl'),'upload.wikimedia.org')
  if item.get('license') not in LICENSES or item.get('licenseUrl')!=LICENSES[item['license']]:raise ValueError('unsupported license metadata')
  if not isinstance(item.get('fileSha1'),str) or not re.fullmatch(r'[a-f0-9]{40}',item['fileSha1']) or not ident.endswith(item['fileSha1'][:12]):raise ValueError('source content identity mismatch')
  for key in ['region','title','author','changes']:
   if not isinstance(item.get(key),str) or not item[key].strip() or len(item[key])>1200:raise ValueError('missing bounded attribution field')
  if not isinstance(item.get('matchRegions'),list) or not item['matchRegions'] or len(item['matchRegions'])>100 or any(not isinstance(v,str) or not v or len(v)>200 for v in item['matchRegions']):raise ValueError('invalid region mapping')
  row={k:item[k] for k in ['id','region','title','imageUrl','author','license','licenseUrl','changes','matchRegions','fileSha1']}
  row.update(sourceUrl=item['approvedSourceRevision'],checkedAt=reviewed.date().isoformat(),reviewStatus='approved',expiresAt=expires.isoformat())
  # Day precision in clients uses midnight, so never exceed its conservative ceiling.
  midnight=reviewed.replace(hour=0,minute=0,second=0,microsecond=0)
  row['expiresAt']=min(expires,midnight+dt.timedelta(days=90)).isoformat()
  result.append(row)
 return {'schemaVersion':1,'items':result},skipped

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidates',type=Path,required=True);p.add_argument('--reviewer',required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 if args.output.exists() or args.output.resolve()==args.candidates.resolve():raise ValueError('choose a new output; existing catalogs and review history are preserved')
 if args.candidates.stat().st_size>16*1024*1024:raise ValueError('candidate queue exceeds budget')
 raw=args.candidates.read_bytes();catalog,skipped=prepare(json.loads(raw),args.reviewer,dt.datetime.now(dt.timezone.utc))
 args.output.parent.mkdir(parents=True,exist_ok=True)
 # Exclusive creation prevents a concurrent run from replacing a prepared catalog.
 with args.output.open('x',encoding='utf8') as f:json.dump(catalog,f,ensure_ascii=False,indent=2);f.write('\n')
 receipt=args.output.with_suffix(args.output.suffix+'.receipt.json')
 with receipt.open('x',encoding='utf8') as f:json.dump({'sourceSha256':hashlib.sha256(raw).hexdigest(),'outputSha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'prepared':len(catalog['items']),'skipped':skipped,'published':False},f,ensure_ascii=False,indent=2);f.write('\n')
if __name__=='__main__':main()
