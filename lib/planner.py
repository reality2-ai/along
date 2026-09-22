"""Scheduled stop-to-stop connection scan, up to two transfers.

Only explicit GTFS transfers and platforms sharing a parent station are linked.
No straight-line walking across roads, harbour, or railway tracks is inferred.
"""
from collections import defaultdict
from datetime import datetime, timedelta
import json
import sqlite3


class Planner:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            self.stops = {r[0]: dict(zip(['id','code','name','lat','lon','parent','kind'], r)) for r in db.execute('SELECT * FROM stops')}
            self.routes = {r[0]: dict(zip(['id','short','name','type','color'], r)) for r in db.execute('SELECT * FROM routes')}
            self.trips = {r[0]: (r[1], r[2], r[3]) for r in db.execute('SELECT * FROM trips')}
            self.calendar = list(db.execute('SELECT * FROM calendar'))
            self.exceptions = list(db.execute('SELECT * FROM exceptions'))
            self.metadata = json.loads(db.execute('SELECT value FROM metadata').fetchone()[0])
            self.transfer_rules = {(a, b): (kind, seconds) for a,b,kind,seconds in db.execute('SELECT * FROM transfers')}
        self.groups = defaultdict(list)
        for stop in self.stops.values():
            self.groups[stop['parent'] or stop['id']].append(stop['id'])
        self.links = defaultdict(dict)
        for group in self.groups.values():
            for a in group:
                for b in group:
                    if a != b:
                        self.links[a][b] = 180
        for (a,b),(kind,seconds) in self.transfer_rules.items():
            if a != b:
                if kind == 3:
                    self.links[a].pop(b, None)
                else:
                    self.links[a][b] = max(120, seconds)

    def connect(self):
        return sqlite3.connect(f'file:{self.path}?mode=ro', uri=True)

    def active(self, date):
        key = date.strftime('%Y%m%d')
        services = {service for service,start,end,days in self.calendar if start <= key <= end and days[date.weekday()] == '1'}
        for service,day,kind in self.exceptions:
            if day == key:
                (services.add if kind == 1 else services.discard)(service)
        return services

    def search(self, query):
        words = query.casefold().split()
        if not words:
            return []
        matches = [s for s in self.stops.values() if all(w in (s['name']+' '+s['code']).casefold() for w in words)]
        return sorted(matches, key=lambda s: (s['code'] != query, s['kind'] != 1, len(s['name']), s['code']))[:15]

    def group(self, stop_id):
        stop = self.stops[stop_id]
        # A selected station covers all its platforms. A bus stop stays directional.
        return self.groups[stop_id] if stop['kind'] == 1 else [stop_id]

    def plan(self, origin, destination, date, seconds, modes):
        if origin not in self.stops or destination not in self.stops:
            raise ValueError('Choose an origin and destination from the stop suggestions.')
        if origin == destination:
            raise ValueError('Choose two different stops.')
        date_key = date.strftime('%Y%m%d')
        if not (self.metadata.get('feed_start_date', '00000000') <= date_key <= self.metadata.get('feed_end_date', '99999999')):
            raise ValueError('This date is outside the downloaded timetable. Refresh the AT feed or choose another date.')
        starts, ends = self.group(origin), set(self.group(destination))
        if set(starts) & ends:
            raise ValueError('These stops belong to the same station.')
        horizon = seconds + 4 * 3600
        connections = []
        with self.connect() as db:
            # Include prior service day's 24:xx trips and next day's midnight trips.
            for offset in [-1,0,1]:
                active = self.active(date + timedelta(days=offset))
                shift = offset * 86400
                for trip,a,b,dep,arr,pickup,dropoff in db.execute('SELECT * FROM connections WHERE departure >= ? AND departure <= ? ORDER BY departure,arrival', (seconds-shift, horizon-shift)):
                    route,service,_ = self.trips[trip]
                    if service in active and self.mode(route) in modes:
                        connections.append((dep+shift, arr+shift, trip, a, b, pickup, dropoff, offset))
        connections.sort()
        results = []
        # Separate rounds retain alternatives with fewer changes.
        previous = {s: (seconds, [], 0) for s in starts}
        for boardings in range(1,4):
            current = {}
            onboard = {}
            for dep,arr,trip,a,b,pickup,dropoff,offset in connections:
                if arr > horizon:
                    continue
                trip_key = (trip,offset)
                base = previous.get(a)
                rider = onboard.get(trip_key)
                rule = self.transfer_rules.get((a,a), (0,120))
                buffer = 0 if boardings == 1 else max(120,rule[1])
                if pickup == 0 and base and base[0]+buffer <= dep and (boardings == 1 or rule[0] != 3):
                    if rider is None:
                        route,_,headsign = self.trips[trip]
                        leg = dict(mode=self.mode(route), route=self.routes[route]['short'] or self.routes[route]['name'], routeId=route, headsign=headsign, trip=trip, origin=a, destination=b, departure=dep, arrival=arr, stops=1)
                        rider = (base[1],leg,base[2])
                if rider:
                    path,leg,walk = rider
                    leg = dict(leg, destination=b, arrival=arr, stops=leg['stops']+(1 if trip_key in onboard else 0))
                    onboard[trip_key] = (path,leg,walk)
                    if dropoff == 0 and (b not in current or arr < current[b][0]):
                        new_path = path+[leg]
                        current[b] = (arr,new_path,walk)
                        for linked,duration in self.links[b].items():
                            ready = arr+duration
                            if linked not in current or ready < current[linked][0]:
                                walking = dict(mode='walk', origin=b, destination=linked, departure=arr, arrival=ready)
                                current[linked] = (ready,new_path+[walking],walk+duration)
            candidates = [current[s] for s in ends if s in current]
            if candidates:
                arrival,path,walk = min(candidates,key=lambda c:c[0])
                results.append(dict(departure=path[0]['departure'], arrival=arrival, duration=arrival-path[0]['departure'], wait=path[0]['departure']-seconds, transfers=boardings-1, walking=walk, legs=path))
            previous = current
        # Remove options slower than a journey with fewer transfers.
        options = []
        for result in results:
            if not any(r['arrival'] <= result['arrival'] and r['transfers'] <= result['transfers'] for r in options):
                options.append(result)
        for result in options:
            for leg in result['legs']:
                leg['from'] = self.stops[leg['origin']]
                leg['to'] = self.stops[leg['destination']]
        return sorted(options,key=lambda r:r['arrival'])

    def mode(self, route):
        kind = self.routes[route]['type']
        return 'train' if kind in (0,1,2) else 'ferry' if kind == 4 else 'bus'
