"""Build a compact offline pedestrian graph and OSM address index for Auckland.

Preprocessing only: pip install osmium in .venv. No extra runtime dependency.
"""
import gzip
import json
import math
from pathlib import Path
from datetime import datetime, timezone
import sys
import osmium

ROOT = Path(__file__).resolve().parents[1]
WALKABLE = {'residential','living_street','unclassified','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link','service','footway','pedestrian','path','steps','track','corridor','cycleway'}
ALLOW = {'yes','designated','permissive','destination'}


def walkable(tags):
    foot = tags.get('foot', '')
    if foot in {'no','private','use_sidepath'} or tags.get('foot:conditional'):
        return False
    if tags.get('access') in {'no','private','customers'} and foot not in ALLOW:
        return False
    highway = tags.get('highway', '')
    if highway not in WALKABLE and not (highway in {'trunk','trunk_link'} and foot in ALLOW):
        return False
    if highway == 'cycleway' and foot not in ALLOW:
        return False
    return tags.get('area') != 'yes' and tags.get('construction') is None


def distance(a,b):
    lat=(a[0]+b[0])/2*math.pi/180
    return math.hypot((a[0]-b[0])*111195, (a[1]-b[1])*111195*math.cos(lat))


class Streets(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes={}
        self.edges=[]
        self.names=['Unnamed path']
        self.name_index={'Unnamed path':0}
        self.addresses=[]
        self.blocked=set()
        self.barriers=set()
        self.flags=[]

    def address(self, entity, lat, lon, prefix):
        tags=entity.tags
        number,street=tags.get('addr:housenumber'),tags.get('addr:street')
        if number and street:
            locality=tags.get('addr:suburb') or tags.get('addr:city') or ''
            self.addresses.append([f'osm:{prefix}{entity.id}',f'{number} {street}'+(f', {locality}' if locality else ''),round(lat,6),round(lon,6),street])

    def node(self,node):
        if not node.location.valid(): return
        self.address(node,node.location.lat,node.location.lon,'n')
        tags=node.tags
        if tags.get('wheelchair')=='no' or tags.get('barrier') in {'stile','turnstile','kissing_gate'} or tags.get('kerb')=='raised':self.barriers.add(node.id)
        if tags.get('foot') in {'no','private'} or (tags.get('access') in {'no','private'} and tags.get('foot') not in ALLOW) or tags.get('barrier') in {'wall','fence','retaining_wall'}:
            self.blocked.add(node.id)

    def way(self,way):
        tags=dict(way.tags)
        if tags.get('addr:housenumber') and tags.get('addr:street'):
            valid=[n for n in way.nodes if n.location.valid()]
            if valid:self.address(way,sum(n.lat for n in valid)/len(valid),sum(n.lon for n in valid)/len(valid),'w')
        if not walkable(tags): return
        name=tags.get('name') or ('Steps' if tags.get('highway')=='steps' else 'Footpath' if tags.get('highway') in {'footway','path','pedestrian','corridor'} else 'Unnamed street')
        if name not in self.name_index:self.name_index[name]=len(self.names);self.names.append(name)
        name_id=self.name_index[name]
        forward=tags.get('oneway:foot')!='-1' and tags.get('foot:forward')!='no'
        backward=tags.get('oneway:foot') not in {'yes','1','true'} and tags.get('foot:backward')!='no'
        speed=0.8 if tags.get('highway')=='steps' else 1.25
        restricted=tags.get('highway')=='steps' or tags.get('wheelchair')=='no'
        try:restricted=restricted or abs(float(tags.get('incline','0').rstrip('%')))>8 or float(tags.get('width','99'))<0.9
        except ValueError:pass
        for a,b in zip(way.nodes, list(way.nodes)[1:]):
            if not a.location.valid() or not b.location.valid() or a.ref in self.blocked or b.ref in self.blocked:continue
            ac=(a.lat,a.lon);bc=(b.lat,b.lon)
            metres=distance(ac,bc)
            if metres>2000:continue
            for node,coords in [(a,ac),(b,bc)]:
                if node.ref not in self.nodes:self.nodes[node.ref]=(len(self.nodes),coords)
            ai,bi=self.nodes[a.ref][0],self.nodes[b.ref][0]
            cost=max(1,math.ceil(metres/speed))
            flag=int(restricted or a.ref in self.barriers or b.ref in self.barriers)
            if forward:self.edges.extend((ai,bi,cost,name_id));self.flags.append(flag)
            if backward:self.edges.extend((bi,ai,cost,name_id));self.flags.append(flag)


def build(source):
    handler=Streets()
    handler.apply_file(str(source),locations=True,idx='flex_mem')
    coords=[]
    for _,(lat,lon) in handler.nodes.values():coords.extend((round(lat*1e6),round(lon*1e6)))
    data={'version':1,'accessibilityVersion':1,'metadata':{'source':'OpenStreetMap contributors / BBBike Auckland extract','imported':datetime.now(timezone.utc).isoformat(),'bounds':[174.45,-37.15,175.05,-36.66],'license':'ODbL-1.0'},'coords':coords,'edges':handler.edges,'flags':handler.flags,'names':handler.names,'addresses':[] if (ROOT/'data/addresses.json.gz').exists() else handler.addresses}
    target=ROOT/'data/streets.json.gz';temp=target.with_suffix('.building.gz')
    with gzip.open(temp,'wt',encoding='utf-8') as f:json.dump(data,f,separators=(',',':'),ensure_ascii=False)
    temp.replace(target)
    print(f'{len(handler.nodes):,} walk nodes, {len(handler.edges)//4:,} directed edges, {len(handler.addresses):,} addresses; {target.stat().st_size/1024/1024:.1f} MB',flush=True)


if __name__=='__main__':build(Path(sys.argv[1] if len(sys.argv)>1 else ROOT/'data/auckland.osm.pbf'))
