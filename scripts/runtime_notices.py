"""Carry a verified notice collection into each experimental static bundle."""
import hashlib
import json
from pathlib import Path
import shutil


def copy_runtime_notices(source, destination):
    source, destination = Path(source), Path(destination)
    manifest = json.loads((source / 'notice-manifest.json').read_text())
    if manifest.get('profile') != 'along-runtime-notices-v1':
        raise ValueError('Unrecognised runtime notice collection')
    files = manifest['files']
    required = {'Along-MIT.txt', 'R2-MIT.txt', 'R2-SCOPE.md', 'inventory.json', 'README.txt'}
    if not required.issubset(files):
        raise ValueError('Runtime notice collection is incomplete')
    actual = {str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}
    if actual != set(files) | {'notice-manifest.json'}:
        raise ValueError('Runtime notice collection file set changed')
    for name, digest in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid runtime notice path')
        path = source / relative
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('Runtime notice changed after collection')
    shutil.copytree(source, destination)
