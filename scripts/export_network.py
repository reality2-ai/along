"""Compact, gzip-compressed browser timetable. No runtime Python dependency offline."""
import gzip
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]


def export(db_path, output):
    with sqlite3.connect(db_path) as db:
        has_access=db.execute("SELECT 1 FROM sqlite_master WHERE name='accessibility'").fetchone()
        access={(kind,id):value for kind,id,value in db.execute('SELECT * FROM accessibility')} if has_access else {}
        stops = [(*r,access.get(('stop',r[0]),0)) for r in db.execute('SELECT * FROM stops')]
        routes = list(db.execute('SELECT * FROM routes'))
        stop_index = {s[0]: i for i,s in enumerate(stops)}
        route_index = {r[0]: i for i,r in enumerate(routes)}
        trips = [(tid,route_index[route],service,headsign,access.get(('trip',tid),0)) for tid,route,service,headsign in db.execute('SELECT * FROM trips')]
        trip_index = {t[0]:i for i,t in enumerate(trips)}
        connections = []
        sequences = []
        has_sequences=db.execute("SELECT 1 FROM sqlite_master WHERE name='connection_sequences'").fetchone()
        query=('SELECT c.*,s.origin_sequence FROM connections c LEFT JOIN connection_sequences s ON c.rowid=s.connection_rowid ORDER BY c.departure,c.arrival,c.rowid' if has_sequences else 'SELECT *,NULL FROM connections ORDER BY departure,arrival,rowid')
        for trip,a,b,dep,arr,pickup,dropoff,sequence in db.execute(query):
            if a in stop_index and b in stop_index:
                sequences.append(sequence)
                connections.extend((trip_index[trip],stop_index[a],stop_index[b],dep,arr,pickup,dropoff))
        network = dict(version=1,accessibilityVersion=1 if has_access else 0,metadata=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0]),stops=stops,routes=routes,trips=trips,calendar=list(db.execute('SELECT * FROM calendar')),exceptions=list(db.execute('SELECT * FROM exceptions')),transfers=list(db.execute('SELECT * FROM transfers')),connections=connections)
        if has_sequences: network['connectionSequences']=sequences
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='route_agencies'").fetchone():
            agencies=dict(db.execute('SELECT * FROM route_agencies'))
            network['routeAgencies']=[agencies.get(r[0]) for r in routes]
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='trip_directions'").fetchone():
            directions=dict(db.execute('SELECT * FROM trip_directions'))
            network['tripDirections']=[directions.get(t[0]) for t in trips]
    temporary = output.with_suffix('.building.gz')
    with gzip.open(temporary,'wt',encoding='utf-8',compresslevel=6) as stream:
        json.dump(network,stream,separators=(',',':'))
    temporary.replace(output)
    print(f'Browser timetable: {output.stat().st_size/1024/1024:.1f} MB compressed')


if __name__ == '__main__':
    export(ROOT/'data/transit.sqlite',ROOT/'data/network.json.gz')
