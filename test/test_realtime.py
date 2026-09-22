import io
import json
import time
import unittest
from lib.realtime import Realtime


class RealtimeTests(unittest.TestCase):
    def test_no_key_never_requests(self):
        def fail(*args, **kwargs):
            self.fail('Should not make a request without a key')
        self.assertFalse(Realtime('', fail).get('tripupdates')['available'])

    def test_header_auth_and_cache(self):
        calls = []
        def fetch(request, **kwargs):
            calls.append(request)
            return io.StringIO(json.dumps({'response': {'header': {'timestamp': int(time.time())}, 'entity': []}}))
        client = Realtime('private-test-key', fetch)
        self.assertTrue(client.get('tripupdates')['available'])
        self.assertTrue(client.get('tripupdates')['available'])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].get_header('Ocp-apim-subscription-key'), 'private-test-key')
        self.assertNotIn('private-test-key', calls[0].full_url)

    def test_old_feed_and_errors_fall_back_to_schedule(self):
        client = Realtime('key', lambda *a, **k: io.StringIO('{"header":{"timestamp":1},"entity":[]}'))
        self.assertFalse(client.get('tripupdates')['available'])
        def fail(*a, **k):
            raise OSError('No connection')
        self.assertFalse(Realtime('key', fail).get('tripupdates')['available'])


if __name__ == '__main__':
    unittest.main()
