import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

AUCKLAND = ZoneInfo('Pacific/Auckland')


def distance(lat, lon, stop):
    a,b = math.radians(lat), math.radians(stop['lat'])
    dlat = b-a
    dlon = math.radians(stop['lon']-lon)
    h = math.sin(dlat/2)**2+math.cos(a)*math.cos(b)*math.sin(dlon/2)**2
    return 6371000*2*math.asin(min(1, math.sqrt(h)))


def nearby(planner, realtime, lat, lon, destination=None, mode='all', now=None):
    now = now or datetime.now(AUCKLAND)
    day = now.date()
    seconds = now.hour*3600+now.minute*60+now.second
    stops = sorted(((distance(lat,lon,s),s) for s in planner.stops.values() if s['kind'] == 0),key=lambda p:p[0])
    stops = [(d,s) for d,s in stops if d <= 800][:18]
    if not stops:
        return {'stops': [], 'live': False, 'message': 'No stops found within 800 metres. Choose a nearby stop or station.'}
    stop_ids = {s['id'] for _,s in stops}
    ends = set(planner.group(destination)) if destination in planner.stops else None
    feed, predictions = realtime.predictions()
    found = {s['id']: [] for _,s in stops}
    with planner.connect() as db:
        for offset in [-1,0,1]:
            service_day = day+timedelta(days=offset)
            active = planner.active(service_day)
            shift = offset*86400
            # Include recent scheduled departures that may have a delayed prediction.
            query = 'SELECT c.trip,c.origin,c.departure,t.route,t.headsign,t.service FROM connections c JOIN trips t ON t.id=c.trip WHERE c.departure BETWEEN ? AND ? AND c.pickup=0 AND c.origin IN ('+','.join('?' for _ in stop_ids)+')'
            for trip,stop,departure,route,headsign,service in db.execute(query,(seconds-1800-shift,seconds+7200-shift,*stop_ids)):
                if service not in active or (mode != 'all' and planner.mode(route) != mode):
                    continue
                if ends:
                    onward = db.execute('SELECT 1 FROM connections WHERE trip=? AND arrival>? AND destination IN ('+','.join('?' for _ in ends)+') AND dropoff=0 LIMIT 1',(trip,departure,*ends)).fetchone()
                    if not onward:
                        continue
                schedule = departure+shift
                expected = schedule
                live = False
                update = predictions.get((trip,service_day.strftime('%Y%m%d')))
                if update and update.get('trip', {}).get('route_id') not in (None, '', route):
                    update = None
                if update:
                    if update.get('trip', {}).get('schedule_relationship') in (3,'CANCELED'):
                        continue
                    for item in update.get('stop_time_update', []):
                        if item.get('stop_id') != stop:
                            continue
                        if item.get('schedule_relationship') in (1,3,'SKIPPED','CANCELED'):
                            expected = -1
                            break
                        event = item.get('departure', {})
                        if event.get('time'):
                            predicted = datetime.fromtimestamp(int(event['time']), AUCKLAND)
                            expected = (predicted.date()-day).days*86400+predicted.hour*3600+predicted.minute*60+predicted.second
                            live = True
                        elif event.get('delay') is not None:
                            expected += int(event['delay'])
                            live = True
                        break
                if expected < seconds or expected > seconds+7200:
                    continue
                found[stop].append({'trip':trip,'route':planner.routes[route]['short'] or planner.routes[route]['name'],'headsign':headsign,'mode':planner.mode(route),'minutes':math.ceil((expected-seconds)/60),'departure':expected,'scheduled':schedule,'live':live})
    result = []
    for metres,stop in stops:
        services = sorted(found[stop['id']],key=lambda d:d['departure'])
        seen = set()
        unique = []
        for service in services:
            key = (service['trip'],service['scheduled'])
            if key not in seen:
                unique.append(service)
                seen.add(key)
        if unique:
            walk = math.ceil(metres*1.35/75)
            for service in unique:
                service['tight'] = service['minutes'] < walk+2
            result.append({'stop':stop,'distance':round(metres),'walk':walk,'departures':unique[:5]})
    result.sort(key=lambda s:min((d['minutes'] for d in s['departures'] if not d['tight']),default=999))
    return {'stops':result,'live':feed['available'],'updated':feed.get('updated'),'message':feed.get('reason','Live predictions where available; otherwise scheduled.'),'directOnly':bool(ends)}
