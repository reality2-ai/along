"""Original GTFS stop sequences survive sorting, loops and browser export."""
import gzip
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile
from scripts.import_gtfs import ingest
from scripts.export_network import export


class SequenceImportTests(unittest.TestCase):
    def test_original_nonconsecutive_sequences_and_legacy_database(self):
        files = {
            'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\na,First,-36.8,174.7\nb,Second,-36.81,174.71\nc,End,-36.82,174.72\n',
            'routes.txt': 'route_id,route_type,route_short_name\nr,3,70\n',
            'trips.txt': 'route_id,service_id,trip_id\nr,day,loop\n',
            'calendar.txt': 'service_id,start_date,end_date,monday,tuesday,wednesday,thursday,friday,saturday,sunday\nday,20260101,20261231,1,1,1,1,1,1,1\n',
            'stop_times.txt': 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nloop,a,80,09:20:00,09:21:00\nloop,c,120,09:30:00,09:30:00\nloop,a,10,09:00:00,09:00:00\nloop,b,30,09:10:00,09:11:00\n',
        }
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'gtfs.zip'; database=root/'transit.sqlite'; output=root/'network.json.gz'
            with zipfile.ZipFile(source,'w') as archive:
                for name,body in files.items(): archive.writestr(name,body)
            ingest(source,database);export(database,output)
            with gzip.open(output,'rt') as stream: network=json.load(stream)
            self.assertEqual(network['connectionSequences'],[10,30,80])
            self.assertEqual(len(network['connections']),21)
            self.assertEqual(network['connections'][3::7],[32400,33060,33660])
            with sqlite3.connect(database) as db: db.execute('DROP TABLE connection_sequences')
            export(database,output)
            with gzip.open(output,'rt') as stream: legacy=json.load(stream)
            self.assertNotIn('connectionSequences',legacy)
            self.assertEqual(legacy['connections'],network['connections'])
