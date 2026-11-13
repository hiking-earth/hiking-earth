import json,math

def validated_route_lines(paths,object_id,max_points=150):
    if not isinstance(paths,list) or not paths:
        raise ValueError(f'AFCD named route {object_id} has no polyline paths')
    lines=[]
    for path in paths:
        if not isinstance(path,list) or len(path)<2:
            raise ValueError(f'AFCD named route {object_id} has an invalid path')
        for point in path:
            if not isinstance(point,(list,tuple)) or len(point)<2:
                raise ValueError(f'AFCD named route {object_id} has an invalid coordinate pair')
            lon,lat=point[:2]
            if any(not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value) for value in (lon,lat)):
                raise ValueError(f'AFCD named route {object_id} has a non-finite coordinate')
            if abs(lon)>180 or abs(lat)>90:
                raise ValueError(f'AFCD named route {object_id} coordinate is outside WGS84 bounds')
    for path in paths:
        step=max(1,math.ceil(len(path)/max_points))
        line=[list(point[:2]) for point in path[::step]]
        endpoint=list(path[-1][:2])
        if line[-1]!=endpoint:line.append(endpoint)
        lines.append(line)
    return lines

def offline_bytes(catalog):
    features=[{'type':'Feature','properties':{'name':row['name'],'sourceId':row['id']},'geometry':{'type':'MultiLineString','coordinates':row['referencePaths']}} for row in catalog['routes']]
    pack={'sourceGeneratedAt':catalog['generatedAt'],'format':'hiking-earth-offline-v1','name':'香港郊野公园官方步道参考线','attribution':catalog['attribution'],'license':'DATA.GOV.HK 使用条款 1.2 · https://data.gov.hk/en/terms-and-conditions','geometry':{'type':'FeatureCollection','features':features}}
    return (json.dumps(pack,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode('utf-8')
