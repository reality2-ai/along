"""Feed-only WSGI entry point for a separately hosted Along live-data service.

Serve behind an HTTPS reverse proxy and a production WSGI server. No planner,
static files, user locations or arbitrary upstream URLs are accepted here.
"""
import json
import os
from pathlib import Path
import threading
from urllib.parse import urlsplit

from lib.realtime import Realtime, load_api_key


def allowed_origins(value):
    origins = set(value.split())
    for origin in origins:
        parsed = urlsplit(origin)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
                or parsed.password or parsed.path or parsed.query or parsed.fragment
                or any(c.isspace() for c in origin)):
            raise ValueError('ALONG_ALLOWED_ORIGINS must contain HTTPS origins without paths.')
        try:
            parsed.port
        except ValueError:
            raise ValueError('Invalid allowed origin port.') from None
    return frozenset(origins)


def create_app(realtime, origins):
    origins = allowed_origins(' '.join(origins))
    endpoints = {'/api/predictions': 'tripupdates', '/api/vehicles': 'vehiclelocations', '/api/alerts': 'servicealerts'}

    def app(environ, start_response):
        origin = environ.get('HTTP_ORIGIN', '')
        headers = [('Content-Type', 'application/json; charset=utf-8'),
                   ('Cache-Control', 'no-store'), ('Vary', 'Origin'),
                   ('X-Content-Type-Options', 'nosniff')]
        if origin in origins:
            headers.append(('Access-Control-Allow-Origin', origin))

        def respond(status, data):
            body = b'' if status.startswith('204 ') else json.dumps(data).encode()
            response_headers = ([h for h in headers if h[0] != 'Content-Type'] if status.startswith('204 ')
                                else headers + [('Content-Length', str(len(body)))])
            start_response(status, response_headers)
            return [body]

        if origin and origin not in origins:
            return respond('403 Forbidden', {'available': False})
        path = environ.get('PATH_INFO', '')
        if path not in endpoints:
            return respond('404 Not Found', {'available': False})
        # No location, route, user identifier or upstream URL belongs in a request.
        if environ.get('QUERY_STRING'):
            return respond('400 Bad Request', {'available': False})
        method = environ.get('REQUEST_METHOD')
        if method == 'OPTIONS':
            requested_headers = {h.strip().lower() for h in environ.get('HTTP_ACCESS_CONTROL_REQUEST_HEADERS', '').split(',') if h.strip()}
            if (origin not in origins or environ.get('HTTP_ACCESS_CONTROL_REQUEST_METHOD') != 'GET'
                    or not requested_headers <= {'accept'}):
                return respond('403 Forbidden', {'available': False})
            headers.extend([('Access-Control-Allow-Methods', 'GET'), ('Access-Control-Allow-Headers', 'Accept')])
            return respond('204 No Content', None)
        if method != 'GET':
            headers.append(('Allow', 'GET, OPTIONS'))
            return respond('405 Method Not Allowed', {'available': False})
        try:
            data = realtime.alerts() if path == '/api/alerts' else realtime.get(endpoints[path])
            return respond('200 OK', data)
        except Exception:
            # Neither upstream failures nor deployment details belong in responses.
            return respond('503 Service Unavailable', {'available': False})

    return app


_application = None
_lock = threading.Lock()


def application(environ, start_response):
    """Load the server-side secret once per WSGI worker, never at module import."""
    global _application
    with _lock:
        if _application is None:
            origins = allowed_origins(os.environ.get('ALONG_ALLOWED_ORIGINS', ''))
            root = Path(__file__).resolve().parent
            _application = create_app(Realtime(load_api_key(root)), origins)
    return _application(environ, start_response)
