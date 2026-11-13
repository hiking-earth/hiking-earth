#!/usr/bin/env python3
"""Publish only validated public data to the production read branch.
An isolated index preserves the caller's checkout and unrelated production code.
Push is fast-forward only; concurrent production changes stop publication.
"""
import argparse,os,subprocess,tempfile,json,hashlib,zlib
from datetime import datetime
from pathlib import Path
from catalog_publication_validation import validate_news_catalog,validate_route_catalog
from catalog_sources import PUBLIC_CATALOG_FILES, PUBLIC_CATALOG_SOURCES
ROOT=Path(__file__).resolve().parents[1]
MAX_PAGE_COMPRESSED_BYTES=2*1024*1024
MAX_PAGE_UNCOMPRESSED_BYTES=4*1024*1024
MAX_INDEX_COMPRESSED_BYTES=8*1024*1024
MAX_INDEX_UNCOMPRESSED_BYTES=32*1024*1024
MAX_MANIFEST_BYTES=1024*1024
MAX_SOURCE_CATALOG_BYTES=128*1024*1024
def encode(value):
 return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
def read_bounded_bytes(path,max_bytes,label):
 path=Path(path)
 if path.is_symlink() or not path.is_file():raise ValueError(f'{label}: expected a regular file')
 with path.open('rb') as handle:
  payload=handle.read(max_bytes+1)
 if len(payload)>max_bytes:raise ValueError(f'{label}: size exceeds budget')
 return payload
def read_bounded_gzip(path,max_compressed_bytes,max_uncompressed_bytes,label):
 path=Path(path)
 if path.is_symlink() or not path.is_file():raise ValueError(f'{label}: expected a regular gzip file')
 with path.open('rb') as handle:
  packed=handle.read(max_compressed_bytes+1)
 if len(packed)>max_compressed_bytes:raise ValueError(f'{label}: compressed size exceeds budget')
 try:
  decoder=zlib.decompressobj(16+zlib.MAX_WBITS)
  payload=decoder.decompress(packed,max_uncompressed_bytes+1)
 except zlib.error as error:
  raise ValueError(f'{label}: invalid gzip payload') from error
 if len(payload)>max_uncompressed_bytes or decoder.unconsumed_tail:
  raise ValueError(f'{label}: decompressed size exceeds budget')
 if not decoder.eof:raise ValueError(f'{label}: incomplete gzip payload')
 if decoder.unused_data:raise ValueError(f'{label}: trailing data or multiple gzip members')
 return payload
def git(*args,env=None,max_output_bytes=None):
 command=['git',*args]
 if max_output_bytes is None:
  return subprocess.check_output(command,cwd=ROOT,env=env,text=True).strip()
 process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 output=process.stdout.read(max_output_bytes+1)
 if len(output)>max_output_bytes:
  process.kill()
  process.communicate()
  raise ValueError('git output exceeds size budget')
 remaining,errors=process.communicate()
 output+=remaining
 if len(output)>max_output_bytes:raise ValueError('git output exceeds size budget')
 if process.returncode:
  raise subprocess.CalledProcessError(process.returncode,command,output=output,stderr=errors)
 try:return output.decode('utf-8').strip()
 except UnicodeDecodeError as error:raise ValueError('git output is not valid UTF-8') from error
def selected_sources(source_filter=None,excluded_sources=None):
 selected=set(PUBLIC_CATALOG_SOURCES if source_filter is None else source_filter)
 excluded=set(excluded_sources or ())
 unknown=(selected|excluded)-set(PUBLIC_CATALOG_SOURCES)
 if unknown:raise ValueError('unknown public catalog source requested')
 selected-=excluded
 if not selected:raise ValueError('at least one public catalog source must be selected')
 return tuple(source for source in PUBLIC_CATALOG_SOURCES if source in selected)
def publication_paths(sources):
 selected=set(sources)
 paths=['shared/public-catalog/collection-status.json']
 paths.extend(f'shared/public-catalog/{source}' for source in PUBLIC_CATALOG_SOURCES if source in selected)
 if 'news' in selected:paths.append('shared/data/content')
 if 'hk' in selected:paths.append('shared/data/offline/hk-afcd.json')
 return paths
def validate(source_filter=None,excluded_sources=None):
 sources=selected_sources(source_filter,excluded_sources)
 for source in sources:
  base=ROOT/'shared/public-catalog'/source
  manifest=json.loads(read_bounded_bytes(base/'manifest.json',MAX_MANIFEST_BYTES,f'{source}: manifest'))
  if (type(manifest.get('schemaVersion')) is not int or manifest.get('schemaVersion')!=1
      or type(manifest.get('pageSize')) is not int or manifest.get('pageSize')!=400):raise ValueError('Invalid manifest')
  version=manifest['snapshot']
  if len(version)!=64 or any(c not in '0123456789abcdef' for c in version):raise ValueError('Invalid snapshot')
  source_path=ROOT/'shared'/PUBLIC_CATALOG_FILES[source]
  source_bytes=read_bounded_bytes(source_path,MAX_SOURCE_CATALOG_BYTES,f'{source}: source catalog')
  if hashlib.sha256(source_bytes).hexdigest()!=version:
   raise ValueError(f'{source}: snapshot hash does not match the authoritative source catalog')
  source_data=json.loads(source_bytes)
  key='items' if source=='news' else 'routes'
  if manifest.get('key')!=key:
   raise ValueError(f'{source}: manifest record key differs from the source catalog contract')
  source_metadata={k:v for k,v in source_data.items() if k not in ('routes','items','failures','withheldItems')}
  if encode(manifest.get('metadata'))!=encode(source_metadata):
   raise ValueError(f'{source}: manifest metadata differs from the authoritative source catalog')
  total=manifest.get('total')
  pages=manifest.get('pages')
  expected_page_count=max(1,(len(source_data.get(key,[]))+399)//400)
  if (isinstance(total,bool) or not isinstance(total,int) or total!=len(source_data.get(key,[]))
      or not isinstance(pages,list) or len(pages)!=expected_page_count):
   raise ValueError(f'{source}: manifest page count or total differs from the source catalog')
  rows=[]
  for index,digest in enumerate(pages):
   payload=read_bounded_gzip(base/version/f'page-{index:05d}.json.gz',
                            MAX_PAGE_COMPRESSED_BYTES,MAX_PAGE_UNCOMPRESSED_BYTES,
                            f'{source}: page {index}')
   if hashlib.sha256(payload).hexdigest()!=digest:raise ValueError('Page digest mismatch')
   source_page=source_data[key][index*400:(index+1)*400]
   if payload!=encode(source_page):
    raise ValueError(f'{source}: page bytes differ from the authoritative source catalog')
   rows.extend(source_page)
  if len(rows)!=total:
   raise ValueError(f'{source}: pages differ from the authoritative source catalog')
  packed_index=read_bounded_gzip(base/version/'index.json.gz',
                                 MAX_INDEX_COMPRESSED_BYTES,MAX_INDEX_UNCOMPRESSED_BYTES,
                                 f'{source}: search index')
  if hashlib.sha256(packed_index).hexdigest()!=manifest['indexHash']:raise ValueError('Index digest mismatch')
  expected_index=[[str(row.get('name','')),str(row.get('region','')),page,offset]
                  for page in range(max(1,(len(rows)+399)//400))
                  for offset,row in enumerate(rows[page*400:(page+1)*400])]
  if packed_index!=encode(expected_index):
   raise ValueError(f'{source}: search index differs from the published page records')
  data={**source_metadata,key:rows}
  if source=='news':validate_news_catalog(data)
  else:validate_route_catalog(source,data)
  print(source,len(rows))
def ensure_not_older(parent,source_filter=None,excluded_sources=None):
 for source in selected_sources(source_filter,excluded_sources):
  path=f'shared/public-catalog/{source}/manifest.json'
  if not git('ls-tree','--name-only',parent,'--',path):continue
  previous=json.loads(git('show',parent+':'+path,max_output_bytes=MAX_MANIFEST_BYTES))
  incoming=json.loads(read_bounded_bytes(ROOT/path,MAX_MANIFEST_BYTES,f'{source}: incoming manifest'))
  def timestamp(value):
   result=datetime.fromisoformat(value['metadata']['generatedAt'].replace('Z','+00:00'))
   if result.tzinfo is None:raise ValueError('Publication timestamp needs timezone')
   return result
  previous_time=timestamp(previous)
  incoming_time=timestamp(incoming)
  if incoming_time<previous_time:raise ValueError(f'{source}: production snapshot is newer; publication stopped')
  # Timestamps can have coarse precision or be copied from an upstream feed.
  # If equal timestamps point at different source snapshots, their ordering is
  # unknowable; stop instead of replacing production data nondeterministically.
  if incoming_time==previous_time and incoming.get('snapshot')!=previous.get('snapshot'):
   raise ValueError(f'{source}: production snapshot has the same timestamp but different content; publication stopped')
def publish(source_filter=None,excluded_sources=None):
 sources=selected_sources(source_filter,excluded_sources)
 validate(sources)
 git('fetch','origin','main')
 parent=git('rev-parse','origin/main')
 ensure_not_older(parent,sources)
 with tempfile.TemporaryDirectory(prefix='hiking-public-index-') as temporary:
  env={**os.environ,'GIT_INDEX_FILE':str(Path(temporary)/'index')}
  git('read-tree',parent,env=env)
  git('add','--',*publication_paths(sources),env=env)
  tree=git('write-tree',env=env)
  if tree==git('rev-parse',parent+'^{tree}'):
   print('Production public data already matches');return
  commit=git('commit-tree',tree,'-p',parent,'-m','data: publish validated public hiking snapshots',env=env)
  git('push','origin',commit+':refs/heads/main')
  remote=git('ls-remote','origin','refs/heads/main').split()[0]
  if remote!=commit:raise RuntimeError('Remote advanced after push; publication verification incomplete')
  print('Verified production commit',commit)
if __name__=='__main__':
 parser=argparse.ArgumentParser(description='Publish validated public catalog snapshots.')
 parser.add_argument('--source',action='append',choices=sorted(PUBLIC_CATALOG_SOURCES),help='Publish only this source; repeat for multiple sources.')
 parser.add_argument('--exclude-source',action='append',choices=sorted(PUBLIC_CATALOG_SOURCES),help='Skip this source while publishing all others; repeat as needed.')
 args=parser.parse_args()
 publish(set(args.source) if args.source else None,set(args.exclude_source or ()))
