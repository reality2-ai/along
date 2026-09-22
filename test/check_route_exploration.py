"""Independently compare representative route views with the original GTFS ZIP."""
import csv,io,json,subprocess,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
code="""
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {Planner} from './public/planner.js';import {routeDetails} from './public/explore.js';
const read=n=>JSON.parse(gunzipSync(readFileSync(`data/${n}.json.gz`)));
const p=new Planner(read('network')),g=read('routes'),out=[];
for(const mode of ['bus','train','ferry']){
 const active=p.active('2026-09-23'),running=new Set(p.data.trips.filter(t=>active.has(t[2])).map(t=>t[1]));
 const route=p.data.routes.find((r,i)=>running.has(i)&&p.mode(i)===mode&&(mode!=='bus'||r[1]==='70'));
 const details=routeDetails(p,{routeId:route[0],date:'2026-09-23',time:'09:00'},g);
 const v=details.variants[0];out.push({mode,route:details.id,number:details.number,date:details.date,trip:v.selectedTrip,stops:v.stops,shape:v.shape});
}
console.log(JSON.stringify(out));
"""
views=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT))
def seconds(value):
    h,m,s=map(int,value.split(':'));return h*3600+m*60+s
with zipfile.ZipFile(ROOT/'data/gtfs.zip') as z:
    def rows(name):return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'))
    ids={v['trip'] for v in views}
    trips={r['trip_id']:r for r in rows('trips.txt') if r['trip_id'] in ids}
    times={tid:[] for tid in ids}
    for row in rows('stop_times.txt'):
        if row['trip_id'] in times:times[row['trip_id']].append(row)
    wanted={r['shape_id'] for r in trips.values()};shapes={s:[] for s in wanted}
    for row in rows('shapes.txt'):
        if row['shape_id'] in shapes:shapes[row['shape_id']].append(row)
    evidence=[]
    for view in views:
        trip=trips[view['trip']];assert trip['route_id']==view['route']
        source=sorted(times[view['trip']],key=lambda r:int(r['stop_sequence']))
        assert [r['stop']['id'] for r in view['stops']]==[r['stop_id'] for r in source]
        expected=[seconds(r['departure_time']) for r in source[:-1]]+[seconds(source[-1]['arrival_time'])]
        assert [r['time'] for r in view['stops']]==expected
        geometry=[[round(float(r['shape_pt_lat']),5),round(float(r['shape_pt_lon']),5)] for r in sorted(shapes[trip['shape_id']],key=lambda r:int(r['shape_pt_sequence']))]
        assert view['shape']==geometry
        evidence.append({'mode':view['mode'],'route':view['number'],'trip':view['trip'],'stops':len(source),'shapePoints':len(geometry),'checks':['route ID','full ordered stop sequence','departure/terminal arrival times','published shape coordinates']})
(ROOT/'docs/evidence/route-exploration.json').write_text(json.dumps({'serviceDate':'2026-09-23','source':'Original preserved AT GTFS ZIP','examples':evidence},indent=2)+'\n')
print('PASS: bus, train and ferry route views match raw GTFS stops, times and shape geometry.')
