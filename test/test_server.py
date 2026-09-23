"""Local HTTP regression checks; no upstream AT requests or real credentials."""
import importlib
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch


class ServerAssetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {'AT_API_KEY': ''}):
            module = importlib.import_module('server')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def test_current_modules_are_served_and_private_files_are_not(self):
        for asset in ['i18n.js', 'locales.js', 'feedback.js', 'feedback-ui.js', 'live-client.js', 'live-context.js', 'live-predictions.js', 'live-time.js']:
            with self.subTest(asset=asset), urllib.request.urlopen(self.base+'/'+asset) as response:
                self.assertEqual(response.status, 200)
                self.assertIn('javascript', response.headers['Content-Type'])
                self.assertIn('https://api.github.com', response.headers['Content-Security-Policy'])
                self.assertTrue(response.read())
        for path in ['/APIKey', '/.env', '/../APIKey', '/%2e%2e/APIKey']:
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as failure:
                urllib.request.urlopen(self.base+path)
            try:
                self.assertEqual(failure.exception.code, 404)
            finally:
                failure.exception.close()

    def test_scoped_alert_response_does_not_require_local_planner(self):
        module = importlib.import_module('server')
        expected = {'available': True, 'updated': 1234, 'alerts': [{
            'title': 'Stop closed', 'informed_entity': [{'stop_id': 'stop-1'}],
            'active_period': [{'start': 1000, 'end': 2000}]}]}
        with patch.object(module, 'planner', None), patch.object(module.realtime, 'alerts', return_value=expected):
            with urllib.request.urlopen(self.base+'/api/alerts') as response:
                self.assertEqual(json.load(response), expected)

    def test_live_configuration_exposes_only_proxy_path_not_key(self):
        module = importlib.import_module('server')
        for key, expected in [('', ''), ('secret-test-key', './api/')]:
            with patch.object(module.realtime, 'key', key):
                with urllib.request.urlopen(self.base+'/live-config.js') as response:
                    body = response.read().decode()
                    self.assertEqual(body, 'export const liveBaseURL = '+json.dumps(expected)+';\n')
                    self.assertNotIn('secret-test-key', body)


if __name__ == '__main__':
    unittest.main()
