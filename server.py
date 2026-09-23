from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo
from lib.planner import Planner
from lib.departures import nearby
from lib.realtime import Realtime, load_api_key

ROOT = Path(__file__).resolve().parent
if (ROOT/'.env').exists():
    for line in (ROOT/'.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key,value = line.split('=',1)
            os.environ.setdefault(key.strip(),value.strip().strip('"').strip("'"))
planner = Planner(ROOT/'data/transit.sqlite') if (ROOT/'data/transit.sqlite').exists() else None
realtime = Realtime(load_api_key(ROOT))


class Handler(BaseHTTPRequestHandler):
    def json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        query = {k:v[0] for k,v in parse_qs(url.query).items()}
        try:
            if url.path == '/live-config.js':
                body = ('export const liveBaseURL = '+json.dumps('./api/' if realtime.key else '')+';\n').encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif url.path == '/api/status':
                self.json({'ready':bool(planner),'realtimeConfigured':bool(realtime.key),'feed':planner.metadata if planner else None,'now':datetime.now(ZoneInfo('Pacific/Auckland')).isoformat()})
            elif url.path in {'/api/network','/api/streets','/api/addresses'}:
                name=url.path.rsplit('/',1)[-1]
                file = ROOT/'data'/(name+'.json.gz')
                if not file.exists():
                    self.json({'error':'Offline data is not ready. See the import instructions.'},503)
                    return
                body = file.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Encoding','gzip')
                self.send_header('Cache-Control','no-cache')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif url.path == '/api/predictions':
                feed = realtime.get('tripupdates')
                self.json(feed)
            elif url.path == '/api/alerts':
                self.json(realtime.alerts())
            elif url.path.startswith('/api/') and not planner:
                self.json({'error':'Download and import the AT timetable first. See README.md.'},503)
            elif url.path == '/api/stops':
                self.json(planner.search(query.get('q','')[:100]))
            elif url.path == '/api/plan':
                date = datetime.strptime(query.get('date',''),'%Y-%m-%d').date()
                time = datetime.strptime(query.get('time',''),'%H:%M')
                modes = set(query.get('modes','bus,train,ferry').split(','))
                if not modes or not modes <= {'bus','train','ferry'}:
                    raise ValueError('Select at least one transport mode.')
                journeys = planner.plan(query.get('from'),query.get('to'),date,time.hour*3600+time.minute*60,modes)
                self.json({'journeys':journeys,'source':'scheduled','date':str(date)})
            elif url.path == '/api/nearby':
                lat,lon = float(query.get('lat','nan')),float(query.get('lon','nan'))
                if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError('A valid location is required.')
                mode = query.get('mode','all')
                if mode not in {'all','bus','train','ferry'}:
                    raise ValueError('Unknown transport mode.')
                self.json(nearby(planner,realtime,lat,lon,query.get('to'),mode))
            elif url.path.startswith('/api/'):
                self.json({'error':'Not found'},404)
            else:
                if url.path in {'/data/network.json.gz','/data/streets.json.gz','/data/addresses.json.gz','/data/routes.json.gz'}:
                    file=ROOT/url.path.lstrip('/')
                    if not file.exists():self.json({'error':'Offline data is not ready'},503);return
                    body=file.read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type','application/gzip')
                    self.send_header('Content-Length',str(len(body)))
                    self.send_header('Cache-Control','no-cache')
                    self.end_headers()
                    self.wfile.write(body)
                    return
                allowed = {'/':'index.html','/app.js':'app.js','/style.css':'style.css','/worker.js':'worker.js','/planner.js':'planner.js','/preferences.js':'preferences.js','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg'}
                allowed['/streets.js']='streets.js'
                allowed['/explore.js']='explore.js'
                for asset in ['leaflet.js','leaflet.css','images/layers.png','images/layers-2x.png','images/marker-icon.png','images/marker-icon-2x.png','images/marker-shadow.png']:
                    allowed['/vendor/leaflet/'+asset]='vendor/leaflet/'+asset
                allowed['/update.html']='update.html'
                allowed['/install.html']='install.html'
                allowed['/updates.js']='updates.js'
                for module in ['i18n.js','locales.js','feedback.js','feedback-ui.js','live-client.js','live-context.js','live-predictions.js']:
                    allowed['/'+module]=module
                for icon in ['icon-192.png','icon-512.png','maskable-512.png','apple-touch-icon.png','favicon-32.png']:
                    allowed['/icons/'+icon] = 'icons/'+icon
                if url.path not in allowed:
                    self.json({'error':'Not found'},404)
                    return
                file = ROOT/'public'/allowed[url.path]
                body = file.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type',{'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8','webmanifest':'application/manifest+json','svg':'image/svg+xml','png':'image/png'}[file.suffix[1:]])
                self.send_header('Cache-Control','no-cache')
                self.send_header('X-Content-Type-Options','nosniff')
                self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self' https://api.github.com; frame-ancestors 'none'")
                self.send_header('Content-Length',str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except (ValueError,KeyError) as error:
            self.json({'error':str(error)},400)
        except Exception as error:
            print(f'Request failed: {type(error).__name__}',flush=True)
            self.json({'error':'Unable to load transport data. Please try again.'},500)

    def log_message(self, fmt, *args):
        # Locations remain in the browser/request, not server access logs.
        pass


if __name__ == '__main__':
    port = int(os.environ.get('PORT','3080'))
    server = ThreadingHTTPServer(('127.0.0.1',port),Handler)
    print(f'Auckland Commute: http://localhost:{port}',flush=True)
    server.serve_forever()
