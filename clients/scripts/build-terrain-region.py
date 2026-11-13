#!/usr/bin/env python3
"""Build an opt-in bounded Terrarium ZIP candidate; never publish or overwrite."""
import argparse,datetime,hashlib,json,math,pathlib,re,ssl,struct,time,urllib.error,urllib.request,zipfile
BASE='https://elevation-tiles-prod.s3.amazonaws.com/terrarium/'
LICENSE='https://github.com/tilezen/joerd/blob/master/docs/attribution.md'
MAX_BYTES=32*1024*1024
# Required source credits accompany every regional pack, even where not all apply.
ATTRIBUTION='''Mapzen Terrain Tiles. ArcticDEM DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736. Australia: © Commonwealth of Australia (Geoscience Australia) 2017. Austria: © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich. Canada: Contains information licensed under the Open Government Licence – Canada. Europe: Produced using Copernicus data and information funded by the European Union - EU-DEM layers. Global ETOPO1: U.S. National Oceanic and Atmospheric Administration. Mexico: Source INEGI, Continental relief, 2016. New Zealand: Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved). Norway: © Kartverket. United Kingdom: © Environment Agency copyright and/or database right 2015. All rights reserved. United States 3DEP and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.'''

def tiles_for(bounds,zoom):
    west,south,east,north=bounds;n=2**zoom
    x=lambda lon:max(0,min(n-1,math.floor((lon+180)/360*n)))
    y=lambda lat:max(0,min(n-1,math.floor((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)))
    left,right=x(west),x(math.nextafter(east,west));top,bottom=y(north),y(math.nextafter(south,north))
    if (right-left+1)*(bottom-top+1)>256:raise ValueError('More than 256 tiles; reduce area or zoom')
    return [(zoom,i,j) for i in range(left,right+1) for j in range(top,bottom+1)]

def fetch_tile(z,x,y,deadline):
    for attempt in range(3):
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('Terrain candidate exceeded time budget')
        try:
            request=urllib.request.Request(f'{BASE}{z}/{x}/{y}.png',headers={'User-Agent':'HikingEarth/0.2 terrain-candidate'})
            with urllib.request.urlopen(request,timeout=min(30,remaining)) as response:
                if response.url!=request.full_url:raise ValueError('Unexpected terrain redirect')
                data=response.read(1024*1024+1)
            if not 33<=len(data)<=1024*1024 or data[:8]!=b'\x89PNG\r\n\x1a\n' or data[12:16]!=b'IHDR' or struct.unpack('>II',data[16:24])!=(256,256) or data[24]!=8 or data[25] not in (2,6):raise ValueError('Unexpected terrain PNG')
            return data
        except urllib.error.HTTPError as error:
            if error.code not in (408,429,500,502,503,504) or attempt==2:raise
        except (urllib.error.URLError,TimeoutError) as error:
            if isinstance(getattr(error,'reason',None),ssl.SSLCertVerificationError) or attempt==2:raise
        if time.monotonic()+2**attempt>=deadline:raise TimeoutError('Terrain retry exceeds time budget')
        time.sleep(2**attempt)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--id',required=True);p.add_argument('--bbox',required=True);p.add_argument('--zoom',type=int,default=10);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',a.id) or not 0<=a.zoom<=14:p.error('Invalid ID or zoom')
    bounds=tuple(float(v) for v in a.bbox.split(','))
    if len(bounds)!=4 or not all(math.isfinite(v) for v in bounds) or not(-180<=bounds[0]<bounds[2]<=180 and -85.05112878<=bounds[1]<bounds[3]<=85.05112878):p.error('Invalid bounds; split antimeridian regions')
    tiles=tiles_for(bounds,a.zoom);a.output.mkdir(parents=True,exist_ok=False);rows=[];total=0;deadline=time.monotonic()+900
    archive=a.output/'terrain.zip'
    with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_STORED) as zf:
        for z,x,y in tiles:
            data=fetch_tile(z,x,y,deadline);total+=len(data)
            if total>MAX_BYTES:raise ValueError('Terrain exceeds32 MiB; partial candidate retained, not published')
            name=f'tiles/{z}/{x}/{y}.png';zf.writestr(name,data);rows.append(dict(z=z,x=x,y=y,path=name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
        manifest=dict(schemaVersion=1,kind='hiking-terrain-terrarium',encoding='terrarium',id=a.id,bounds=bounds,zoom=a.zoom,source=BASE,attribution=ATTRIBUTION,licenseUrl=LICENSE,navigationSuitable=False,tiles=rows)
        zf.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False));zf.writestr('ATTRIBUTION.txt',ATTRIBUTION+'\n'+LICENSE)
    record=dict(sourceRegistry='https://registry.opendata.aws/terrain-tiles/',builtAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),bytes=archive.stat().st_size,sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),candidate=True,tested=False,published=False,tiles=len(rows))
    (a.output/'candidate.json').write_text(json.dumps(record,indent=2))
if __name__=='__main__':main()
