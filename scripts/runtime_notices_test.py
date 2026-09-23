"""Distribution must not silently lose or alter collected attribution."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from runtime_notices import copy_runtime_notices


class RuntimeNoticesTest(unittest.TestCase):
    def collection(self, root):
        source = root / 'source'
        source.mkdir()
        files = {}
        for name in ('Along-MIT.txt', 'R2-MIT.txt', 'R2-SCOPE.md', 'inventory.json', 'README.txt', 'dependency/NOTICE'):
            path = source / name
            path.parent.mkdir(exist_ok=True)
            path.write_text('Attribution for ' + name)
            files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        (source / 'notice-manifest.json').write_text(json.dumps({'profile': 'along-runtime-notices-v1', 'files': files}))
        return source

    def test_preserves_all_notice_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.collection(root)
            copy_runtime_notices(source, root / 'bundle')
            for original in source.rglob('*'):
                if original.is_file():
                    self.assertEqual(original.read_bytes(), (root / 'bundle' / original.relative_to(source)).read_bytes())

    def test_refuses_missing_changed_or_untracked_notices(self):
        for mutation in ('missing', 'changed', 'extra'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                source = self.collection(root)
                notice = source / 'dependency/NOTICE'
                if mutation == 'missing':
                    notice.unlink()
                elif mutation == 'changed':
                    notice.write_text('Different attribution')
                else:
                    (source / 'unexpected.txt').write_text('Unreviewed content')
                with self.assertRaises(ValueError):
                    copy_runtime_notices(source, root / 'bundle')
                self.assertFalse((root / 'bundle').exists())


if __name__ == '__main__':
    unittest.main()
