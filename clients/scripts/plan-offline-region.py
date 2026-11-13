#!/usr/bin/env python3
"""Plan bounded regional extracts; emits configuration, never downloads maps."""
import argparse, hashlib, json, math, pathlib
MAX_LAT=85.05112878

def plan(latitude,longitude,radius_km,name):
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in (latitude,longitude,radius_km)):
        raise ValueError('coordinates and radius must be finite numbers')
    if not -MAX_LAT<latitude<MAX_LAT or not -180<=longitude<=180 or not 1<=radius_km<=10:
        raise ValueError('supported latitude is within Mercator bounds, radius 1..10 km')
    if not isinstance(name,str) or not name.strip() or len(name.strip())>65:
        raise ValueError('region name must contain 1..65 characters')
    # A conservative bounding box; near poles Mercator coverage ends explicitly.
    dy=radius_km/110.0
    south,north=latitude-dy,latitude+dy
    if south<=-MAX_LAT or north>=MAX_LAT:
        raise ValueError('requested region exceeds supported map latitude; choose another region')
    dx=radius_km/(110.0*math.cos(math.radians(max(abs(south),abs(north)))))
    west,east=longitude-dx,longitude+dx
    if west < -180: segments=[(west+360,180),(-180,east)]
    elif east > 180: segments=[(west,180),(-180,east-360)]
    else: segments=[(west,east)]
    rows=[]
    for left,right in segments:
        count=max(1,math.ceil((right-left)/0.49))
        for index in range(count):
            low=left+(right-left)*index/count;high=left+(right-left)*(index+1)/count
            # Identity describes the exact serialized geometry used by the builder.
            bbox=','.join(format(v,'.10f') for v in (low,south,high,north))
            token=bbox+',8,15'
            ident='custom-'+hashlib.sha256(token.encode()).hexdigest()[:16]
            rows.append({'id':ident,'name':name.strip()+f' · {len(rows)+1}','bbox':bbox,'minZoom':8,'maxZoom':15})
    if not rows or len(rows)>32:raise ValueError('region needs too many bounded extracts')
    return {'schemaVersion':1,'regions':rows}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--latitude',required=True,type=float);p.add_argument('--longitude',required=True,type=float)
    p.add_argument('--radius-km',type=float,default=5);p.add_argument('--name',required=True);p.add_argument('--output',required=True,type=pathlib.Path)
    a=p.parse_args();value=plan(a.latitude,a.longitude,a.radius_km,a.name)
    # Do not replace a previous request or following a symlink overwrite files.
    with a.output.open('x',encoding='utf-8') as f:f.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'regions':len(value['regions']),'configuration':str(a.output),'mapsDownloaded':False}))
if __name__=='__main__':main()
