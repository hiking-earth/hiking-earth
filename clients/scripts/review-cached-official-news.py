#!/usr/bin/env python3
"""Reapply current metadata/expiry policy without claiming a new feed fetch."""
import datetime as dt
from pathlib import Path
from official_content_policy import (validate_official_source_registry,
    synchronize_source_states, apply_bounded_metadata_policy, bounded_withheld_history)
from official_content_io import read_json_bounded, encode_json_bounded
ROOT=Path(__file__).resolve().parents[1]
TARGET=ROOT/'shared/data/content/official-news.json'
def main():
    registered,_=validate_official_source_registry(read_json_bounded(ROOT/'shared/data/content/official-sources.json',1024*1024,'source registry'))
    data=read_json_bounded(TARGET,16*1024*1024,'official news')
    now=dt.datetime.now(dt.timezone.utc)
    visible,withheld=apply_bounded_metadata_policy(data['items'],registered,now,500)
    data['sources']=synchronize_source_states(registered,data.get('sources',[]))
    data['items']=visible
    data['generatedAt']=now.isoformat()
    data['collectionStatus']={'state':'cached-review-only','reviewedAt':now.isoformat(),
        'attemptedSourceCount':0,'failedSourceCount':0,'cachedItemsRevalidated':True}
    data['publicationPolicy']={'version':1,'scope':'metadata-links-only','maxFreshnessAgeDays':90,
        'maxPublicationAgeDays':90,'reviewedAt':now.isoformat(),'withheldCount':len(withheld),
        'expiredCount':sum(x['reason']=='publication-expired' for x in withheld),'accessVerified':False}
    data['withheldItems']=bounded_withheld_history(data.get('withheldItems',[])+withheld,500)
    payload=encode_json_bounded(data,16*1024*1024,'reviewed official news')
    temporary=TARGET.with_suffix('.review.tmp')
    try:temporary.write_bytes(payload);temporary.replace(TARGET)
    finally:temporary.unlink(missing_ok=True)
    print(f'Cached metadata reviewed: {len(visible)} public, {len(withheld)} withheld; no feed fetch was performed.')
if __name__=='__main__':main()
