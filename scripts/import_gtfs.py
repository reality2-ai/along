"""Import an official AT GTFS zip atomically. Python standard library only."""
import csv
import io
import json
from pathlib import Path
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def seconds(value):
    h, m, s = map(int, value.split(':'))
    return h * 3600 + m * 60 + s


def ingest(source, target):
    temp = target.with_suffix('.building.sqlite')
    temp.unlink(missing_ok=True)
    db = sqlite3.connect(temp)
    db.execute('PRAGMA temp_store=MEMORY')
    db.executescript('''
      CREATE TABLE stops(id TEXT PRIMARY KEY, code TEXT, name TEXT, lat REAL, lon REAL, parent TEXT, kind INTEGER);
      CREATE TABLE routes(id TEXT PRIMARY KEY, short TEXT, name TEXT, type INTEGER, color TEXT);
      CREATE TABLE trips(id TEXT PRIMARY KEY, route TEXT, service TEXT, headsign TEXT);
      CREATE TABLE calendar(service TEXT, start TEXT, end TEXT, days TEXT);
      CREATE TABLE exceptions(service TEXT, date TEXT, type INTEGER);
      CREATE TABLE transfers(origin TEXT, destination TEXT, type INTEGER, seconds INTEGER);
      CREATE TABLE connections(trip TEXT, origin TEXT, destination TEXT, departure INTEGER, arrival INTEGER, pickup INTEGER, dropoff INTEGER);
      CREATE TABLE connection_sequences(connection_rowid INTEGER PRIMARY KEY, origin_sequence INTEGER);
      CREATE TABLE metadata(value TEXT);
      CREATE TABLE accessibility(kind TEXT, id TEXT, value INTEGER);
    ''')
    with zipfile.ZipFile(source) as z:
        def rows(name):
            if name not in z.namelist():
                return
            with z.open(name) as raw:
                yield from csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig'))
        db.executemany('INSERT INTO stops VALUES (?,?,?,?,?,?,?)', (
            (r['stop_id'], r.get('stop_code', ''), r['stop_name'], float(r['stop_lat']), float(r['stop_lon']), r.get('parent_station', ''), int(r.get('location_type') or 0)) for r in rows('stops.txt')))
        db.executemany('INSERT INTO routes VALUES (?,?,?,?,?)', (
            (r['route_id'], r.get('route_short_name', ''), r.get('route_long_name', ''), int(r['route_type']), r.get('route_color', '')) for r in rows('routes.txt')))
        db.executemany('INSERT INTO trips VALUES (?,?,?,?)', (
            (r['trip_id'], r['route_id'], r['service_id'], r.get('trip_headsign', '')) for r in rows('trips.txt')))
        db.executemany('INSERT INTO accessibility VALUES (?,?,?)', (('stop',r['stop_id'],int(r.get('wheelchair_boarding') or 0)) for r in rows('stops.txt')))
        db.executemany('INSERT INTO accessibility VALUES (?,?,?)', (('trip',r['trip_id'],int(r.get('wheelchair_accessible') or 0)) for r in rows('trips.txt')))
        db.executemany('INSERT INTO calendar VALUES (?,?,?,?)', (
            (r['service_id'], r['start_date'], r['end_date'], ''.join(r[d] for d in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])) for r in rows('calendar.txt')))
        db.executemany('INSERT INTO exceptions VALUES (?,?,?)', ((r['service_id'], r['date'], int(r['exception_type'])) for r in rows('calendar_dates.txt')))
        db.executemany('INSERT INTO transfers VALUES (?,?,?,?)', ((r['from_stop_id'], r['to_stop_id'], int(r.get('transfer_type') or 0), int(r.get('min_transfer_time') or 120)) for r in rows('transfers.txt')))
        # A temporary indexed table supports feeds whose stop_times aren't sorted.
        db.execute('CREATE TABLE times(trip TEXT, stop TEXT, seq INTEGER, arrival INTEGER, departure INTEGER, pickup INTEGER, dropoff INTEGER)')
        db.executemany('INSERT INTO times VALUES (?,?,?,?,?,?,?)', (
            (r['trip_id'], r['stop_id'], int(r['stop_sequence']), seconds(r['arrival_time']), seconds(r['departure_time']), int(r.get('pickup_type') or 0), int(r.get('drop_off_type') or 0))
            for r in rows('stop_times.txt') if r.get('arrival_time') and r.get('departure_time')))
        db.execute('CREATE INDEX times_order ON times(trip,seq)')
        previous = None
        batch = []
        sequences = []
        connection_id = 0
        for row in db.execute('SELECT trip,stop,arrival,departure,pickup,dropoff,seq FROM times ORDER BY trip,seq'):
            if previous and previous[0] == row[0] and row[2] >= previous[3]:
                connection_id += 1
                sequences.append((connection_id, previous[6]))
                batch.append((row[0], previous[1], row[1], previous[3], row[2], previous[4], row[5]))
            previous = row
            if len(batch) >= 10000:
                db.executemany('INSERT INTO connections VALUES (?,?,?,?,?,?,?)', batch)
                db.executemany('INSERT INTO connection_sequences VALUES (?,?)', sequences)
                batch.clear()
                sequences.clear()
        db.executemany('INSERT INTO connections VALUES (?,?,?,?,?,?,?)', batch)
        db.executemany('INSERT INTO connection_sequences VALUES (?,?)', sequences)
        db.execute('DROP TABLE times')
        db.execute('CREATE INDEX departures ON connections(departure)')
        db.execute('CREATE INDEX trip_connections ON connections(trip,arrival)')
        info = next(rows('feed_info.txt'), {})
        info['imported_at'] = datetime.now(timezone.utc).isoformat()
        db.execute('INSERT INTO metadata VALUES (?)', (json.dumps(info),))
    db.commit()
    count = db.execute('SELECT count(*) FROM connections').fetchone()[0]
    db.close()
    temp.replace(target)
    print(f'Imported {count:,} timetable connections into {target}')


if __name__ == '__main__':
    ingest(Path(sys.argv[1]), ROOT / 'data' / 'transit.sqlite')
    from export_network import export
    export(ROOT/'data/transit.sqlite', ROOT/'data/network.json.gz')

    from export_route_geometry import export as export_geometry
    export_geometry(Path(sys.argv[1]), ROOT/'data/routes.json.gz')
