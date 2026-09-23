"""A bundle must not silently substitute runtime, browser code or notices."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from runtime_provenance import verify_runtime


class RuntimeProvenanceTest(unittest.TestCase):
    def bundle(self, root):
        names = ('source.tar', 'wasm/hive_wasm.js', 'wasm/hive_wasm_bg.wasm',
                 'browser/storage.mjs', 'notices/notice-manifest.json',
                 'notices/rust/COPYRIGHT-library.html')
        files = {}
        for name in names:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('Test content: ' + name)
            files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        (root / 'provenance.json').write_text(json.dumps({
            'profile': 'along-r2-runtime-v1', 'independent_builds': 2,
            'source_archive_sha256': files['source.tar'], 'files': files}))

    def test_selects_matching_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.bundle(root)
            self.assertEqual(verify_runtime(root), tuple(root / name for name in ('browser', 'wasm', 'notices')))

    def test_rejects_changed_payloads_and_file_set(self):
        for name in ('source.tar', 'wasm/hive_wasm_bg.wasm', 'wasm/hive_wasm.js',
                     'browser/storage.mjs', 'notices/rust/COPYRIGHT-library.html'):
            for mutation in ('changed', 'missing', 'symlink'):
                with self.subTest(name=name, mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    self.bundle(root)
                    path = root / name
                    if mutation == 'changed':
                        path.write_text('Different content')
                    else:
                        path.unlink()
                        if mutation == 'symlink':
                            path.symlink_to(root / 'provenance.json')
                    with self.assertRaises(ValueError):
                        verify_runtime(root)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.bundle(root)
            (root / 'unexpected').write_text('Unrecorded')
            with self.assertRaises(ValueError):
                verify_runtime(root)


if __name__ == '__main__':
    unittest.main()
