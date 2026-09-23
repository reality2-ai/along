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
            if cached and 0 <= time.time()-cached[0] < 60:
                result = cached[1]
                # A cache TTL must never extend the feed's freshness window.
                if not result['available'] or abs(time.time()-result['updated']) <= 180:
                    return result
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

    def alerts(self):
        """Preserve scope/time metadata for contextual filtering by clients.

        Do not truncate before filtering: a relevant stop alert may be last.
        Network-wide presentation remains an explicit UI action.
        """
        feed = self.get('servicealerts')
        alerts = []
        if feed['available']:
            for entity in feed['entities']:
                if not isinstance(entity, dict) or entity.get('is_deleted'):
                    continue
                alert = entity.get('alert')
                if not isinstance(alert, dict):
                    continue
                def english(field):
                    value = alert.get(field, {})
                    items = value.get('translation', []) if isinstance(value, dict) else []
                    items = [i for i in items if isinstance(i, dict) and isinstance(i.get('text'), str)] if isinstance(items, list) else []
                    return next((i['text'] for i in items if str(i.get('language', 'en')).lower().split('-')[0] == 'en'), items[0]['text'] if items else '')
                alerts.append({
                    'id': entity.get('id'),
                    'title': english('header_text'),
                    'description': english('description_text'),
                    # Keep original selectors, including unknown fields. Dropping
                    # a restriction could incorrectly broaden an alert's scope.
                    'informed_entity': alert.get('informed_entity', []),
                    'active_period': alert.get('active_period', []),
                    'effect': alert.get('effect'),
                    'cause': alert.get('cause'),
                })
        return {'available': feed['available'], 'updated': feed.get('updated'),
                'message': feed.get('reason'), 'alerts': alerts}
