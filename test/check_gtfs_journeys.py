"""Independently compare planned transit legs with the original AT GTFS ZIP."""
import csv
import io
import json
from pathlib import Path
import zipfile
import sys

root = Path(__file__).resolve().parents[1]
report_path = 'test-results/real-journeys-arrive.json' if '--arrive-by' in sys.argv else 'test-results/real-journeys.json'
report = json.loads((root / report_path).read_text())
if report.get('timeMode') == 'arrive':
    for case in report['cases']:
        assert case['journey']['arrival'] <= 9 * 3600
        assert case['journey']['legs'][-1]['to']['id'] == case['to']['id']
        assert all(a['arrival'] <= b['departure'] for a, b in zip(case['journey']['legs'], case['journey']['legs'][1:]))
legs = [leg for case in report['cases'] for leg in case['journey']['legs'] if leg['mode'] != 'walk']
trip_ids = {leg['trip'] for leg in legs}

def seconds(value):
    h, m, s = map(int, value.split(':'))
    return h * 3600 + m * 60 + s

with zipfile.ZipFile(root / 'data/gtfs.zip') as archive:
    def rows(name):
        return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig'))
    trips = {r['trip_id']: r for r in rows('trips.txt') if r['trip_id'] in trip_ids}
    stop_times = {trip: [] for trip in trip_ids}
    for row in rows('stop_times.txt'):
        if row['trip_id'] in trip_ids:
            stop_times[row['trip_id']].append(row)
    day = report['date'].replace('-', '')
    # Fixture date is Wednesday; explicitly verify weekly/exception membership.
    services = {r['service_id'] for r in rows('calendar.txt')
                if r['start_date'] <= day <= r['end_date'] and r['wednesday'] == '1'}
    for row in rows('calendar_dates.txt'):
        if row['date'] == day:
            if row['exception_type'] == '1': services.add(row['service_id'])
            else: services.discard(row['service_id'])
    for leg in legs:
        trip = trips[leg['trip']]
        assert trip['service_id'] in services, leg
        assert trip['route_id'] == leg['routeId'], leg
        stops = sorted(stop_times[leg['trip']], key=lambda r: int(r['stop_sequence']))
        boarding = [i for i, r in enumerate(stops) if r['stop_id'] == leg['from']['id']
                    and seconds(r['departure_time']) == leg['departure'] and r.get('pickup_type', '') in ('', '0')]
        alighting = [i for i, r in enumerate(stops) if r['stop_id'] == leg['to']['id']
                     and seconds(r['arrival_time']) == leg['arrival'] and r.get('drop_off_type', '') in ('', '0')]
        assert any(a < b for a in boarding for b in alighting), leg
print(f'PASS: {len(legs)} transit legs match original GTFS trips, routes, service dates, stop order, times and pickup/drop-off permissions.')
