"""Cache Auckland's public LINZ-derived address points for offline search.

Source: LINZ NZ Addresses public ArcGIS mirror (CC BY 4.0). Downloads pages
serially, using the service's advertised standard record count and stable OIDs.
"""
import gzip
import json
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
SOURCE='https://services.arcgis.com/xdsHIIxuCWByZiCB/ArcGIS/rest/services/LINZ_NZ_Addresses/FeatureServer/0/query'


def download():
    params={'f':'json','where':"territorial_authority = 'Auckland' AND address_lifecycle = 'Current'",'outFields':'OBJECTID,address_id,full_address,full_road_name,suburb_locality','outSR':4326,'returnGeometry':'true','resultType':'standard','resultRecordCount':16000,'orderByFields':'OBJECTID ASC','geometry':'174.45,-37.15,175.05,-36.66','geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects'}
    addresses=[]
    offset=0
    while True:
        params['resultOffset']=offset
        page=ROOT/'data'/f'addresses-{offset}.json'
        if page.exists():
            result=json.loads(page.read_text())
        else:
            for attempt in range(3):
                try:
                    request=Request(SOURCE+'?'+urlencode(params),headers={'User-Agent':'Along-Auckland-offline-import/1.0'})
                    with urlopen(request,timeout=90) as response:result=json.load(response)
                    if 'error' in result:raise RuntimeError(result['error'])
                    page.write_text(json.dumps(result,separators=(',',':')))
                    break
                except Exception:
                    if attempt==2:raise
                    time.sleep(2)
        rows=result.get('features',[])
        for row in rows:
            a,g=row['attributes'],row.get('geometry',{})
            if g and a.get('full_address'):
                addresses.append([f'linz:{a["address_id"]}',a['full_address'],round(g['y'],6),round(g['x'],6),a.get('full_road_name','')])
        offset+=len(rows)
        print(f'{offset:,} address points downloaded',flush=True)
        if not result.get('exceededTransferLimit'):break
        if not rows:raise RuntimeError('The address service returned an empty page before completion.')
        time.sleep(.15)
    if not addresses:raise RuntimeError('No addresses found; check the source layer and filters.')
    target=ROOT/'data/addresses.json.gz';temp=target.with_suffix('.building.gz')
    with gzip.open(temp,'wt',encoding='utf-8') as f:
        json.dump({'version':1,'source':SOURCE,'attribution':'Sourced from the LINZ Data Service and licensed for reuse under CC BY 4.0.','addresses':addresses},f,separators=(',',':'),ensure_ascii=False)
    temp.replace(target)
    print(f'{len(addresses):,} addresses, {target.stat().st_size/1024/1024:.1f} MB compressed',flush=True)


if __name__=='__main__':download()
