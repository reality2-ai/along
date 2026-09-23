"""AT's documented subscription-header authentication; never send keys to clients."""
import json
import os
import re
from pathlib import Path
import threading
import time
import urllib.request


def load_api_key(root, environ=None):
    """Server-only credential loading. Explicit environment values take precedence.

    An explicitly empty AT_API_KEY disables live access even if APIKey exists.
    Never include the credential or file contents in errors or responses.
    """
    environ = os.environ if environ is None else environ
    if 'AT_API_KEY' in environ:
        value = environ['AT_API_KEY'].strip()
    else:
        try:
            value = (Path(root)/'APIKey').read_text().strip()
        except FileNotFoundError:
            return ''
        except (OSError, UnicodeError):
            raise ValueError('Could not read the local AT credential file.') from None
    if len(value) > 4096 or any(c.isspace() for c in value):
        raise ValueError('The AT credential must be a single key.')
    return value


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
                if trip_id and isinstance(day, str) and re.fullmatch(r'\d{8}', day):
                    key = (trip_id, day)
                    updates[key] = None if key in updates else update
        return feed, updates
