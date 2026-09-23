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

class CredentialTests(unittest.TestCase):
    def test_local_file_environment_override_and_explicit_disable(self):
        import tempfile
        from pathlib import Path
        from lib.realtime import load_api_key
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(load_api_key(directory, {}), '')
            file = Path(directory)/'APIKey'
            file.write_text('local-test-key\n')
            self.assertEqual(load_api_key(directory, {}), 'local-test-key')
            self.assertEqual(load_api_key(directory, {'AT_API_KEY':'environment-test-key'}), 'environment-test-key')
            self.assertEqual(load_api_key(directory, {'AT_API_KEY':''}), '')
            file.write_text('private-test-key\nsecond-line')
            with self.assertRaises(ValueError) as failure:
                load_api_key(directory, {})
            self.assertNotIn('private-test-key', str(failure.exception))
            file.write_bytes(b'\xff')
            with self.assertRaisesRegex(ValueError, 'Could not read'):
                load_api_key(directory, {})


if __name__ == '__main__':
    unittest.main()
