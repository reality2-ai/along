"""AT's documented subscription-header authentication; never send keys to clients."""
import json
import threading
import time
import urllib.request


class Realtime:
    def __init__(self, key, fetch=None):
        self.key = key
        self.fetch = fetch or urllib.request.urlopen
        self.cache = {}
        self.lock = threading.Lock()

    def get(self, endpoint):
        if not self.key:
            return {'available': False, 'reason': 'Live updates need an AT subscription key.'}
        with self.lock:
            cached = self.cache.get(endpoint)
            if cached and time.time()-cached[0] < 60:
                return cached[1]
            try:
                request = urllib.request.Request('https://api.at.govt.nz/realtime/legacy/'+endpoint,
                    headers={'Ocp-Apim-Subscription-Key': self.key, 'Accept': 'application/json'})
                with self.fetch(request, timeout=10) as response:
                    data = json.load(response)
                feed = data.get('response', data)
                if not isinstance(feed, dict) or not isinstance(feed.get('entity'), list):
                    raise ValueError('Unexpected AT response')
                stamp = int(feed.get('header', {}).get('timestamp') or 0)
                if not stamp or abs(time.time()-stamp) > 180:
                    raise ValueError('Stale feed')
                result = {'available': True, 'updated': stamp, 'entities': feed['entity']}
            except Exception:
                result = {'available': False, 'reason': 'Live updates are unavailable. Showing scheduled times.'}
            self.cache[endpoint] = (time.time(), result)
            return result

    def predictions(self):
        feed = self.get('tripupdates')
        updates = {}
        if feed['available']:
            for entity in feed['entities']:
                update = entity.get('trip_update', {})
                trip = update.get('trip', {})
                trip_id = trip.get('trip_id')
                day = trip.get('start_date', '')
                if trip_id:
                    updates[(trip_id,day)] = update
        return feed, updates
