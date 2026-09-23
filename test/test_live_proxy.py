"""Exercise the public proxy boundary without credentials or network access."""
import json
import unittest
from unittest.mock import Mock
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator
from live_proxy import allowed_origins, create_app


class LiveProxyTests(unittest.TestCase):
    def setUp(self):
        self.feed = {'available': True, 'updated': 1234, 'entities': []}
        self.realtime = Mock()
        self.realtime.get.return_value = self.feed
        self.realtime.alerts.return_value = {'available': True, 'updated': 1234, 'alerts': []}
        self.app = validator(create_app(self.realtime, ['https://reality2.ai']))

    def request(self, path='/api/predictions', origin='https://reality2.ai', **extra):
        environ = {}
        setup_testing_defaults(environ)
        environ.update(PATH_INFO=path, REQUEST_METHOD='GET', QUERY_STRING='', HTTP_ORIGIN=origin)
        environ.update(extra)
        result = {}
        def start(status, headers, exc_info=None):
            result.update(status=status, headers=dict(headers))
        body = self.app(environ, start)
        try:
            result['body'] = b''.join(body)
        finally:
            body.close()
        return result

    def test_only_fixed_feeds_with_exact_origin_are_exposed(self):
        for path, upstream in [('/api/predictions', 'tripupdates'), ('/api/vehicles', 'vehiclelocations')]:
            response = self.request(path)
            self.assertEqual(json.loads(response['body']), self.feed)
            self.realtime.get.assert_called_with(upstream)
            self.assertEqual(response['headers']['Access-Control-Allow-Origin'], 'https://reality2.ai')
            self.assertEqual(response['headers']['Vary'], 'Origin')
            self.assertNotIn('Access-Control-Allow-Credentials', response['headers'])
        self.assertEqual(self.request('/api/alerts')['status'], '200 OK')
        self.realtime.alerts.assert_called_once_with()

    def test_untrusted_origins_and_unexpected_input_never_reach_upstream(self):
        for origin in ['https://reality2.ai.evil.example', 'null', 'http://reality2.ai']:
            response = self.request(origin=origin)
            self.assertEqual(response['status'], '403 Forbidden')
            self.assertNotIn('Access-Control-Allow-Origin', response['headers'])
        for path in ['/APIKey', '/.env', '/', '/api/plan', '/api/../APIKey']:
            self.assertEqual(self.request(path)['status'], '404 Not Found')
        self.assertEqual(self.request(QUERY_STRING='url=https://example.org')['status'], '400 Bad Request')
        self.assertEqual(self.request(REQUEST_METHOD='POST')['status'], '405 Method Not Allowed')
        self.realtime.get.assert_not_called()
        self.realtime.alerts.assert_not_called()

    def test_preflight_and_unavailable_responses(self):
        response = self.request(REQUEST_METHOD='OPTIONS', HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET', HTTP_ACCESS_CONTROL_REQUEST_HEADERS='Accept')
        self.assertEqual(response['status'], '204 No Content')
        self.assertEqual(response['body'], b'')
        self.assertEqual(self.request(REQUEST_METHOD='OPTIONS', HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET', HTTP_ACCESS_CONTROL_REQUEST_HEADERS='Authorization')['status'], '403 Forbidden')
        self.realtime.get.assert_not_called()
        self.realtime.get.side_effect = RuntimeError('secret upstream diagnostic')
        response = self.request()
        self.assertEqual(response['status'], '503 Service Unavailable')
        self.assertNotIn(b'secret', response['body'])
        self.assertEqual(response['headers']['Cache-Control'], 'no-store')

    def test_cors_is_not_authentication(self):
        response = self.request(origin='')
        self.assertEqual(response['status'], '200 OK')
        self.assertNotIn('Access-Control-Allow-Origin', response['headers'])

    def test_origin_configuration_rejects_wildcards_paths_and_credentials(self):
        for origin in ['*', 'null', 'https://reality2.ai/along/', 'https://user:secret@example.org', 'http://example.org', 'https://example.org:bad']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                allowed_origins(origin)
