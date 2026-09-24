"""Rebuild pinned public Along releases inside a disposable container.

Mount this script read-only and an empty writable /output directory. No checkout,
credentials or local data should be mounted. Runtime compiler reproduction is a
separate check; this builds the application using the public runtime archive.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import urllib.request
import zipfile


RELEASES = {
    40: ('1c4ac0fefb32e373b22dcb80f709ee22972ba7c0',
         'cae169ada5b168908127e9e089ebae8f7072a5c694ddbb12e041c958c304095f'),
    42: ('0c3b5446f0bcfd3abfd6969a57be76f91505cc73',
         'c41b2e06cab600d14b0365f527117c75fb90f193c3d2c5db9067b13ab3096f6d'),
}
RUNTIME = 'along-r2-runtime-public-82377f1'
RUNTIME_SHA = 'c241805a394fdcb8197b499914c17e283d4c5922081eeb2528f55c089379401f'


def archive(version, name, expected):
    url = f'https://github.com/reality2-ai/along/releases/download/v0.{version}.0/{name}'
    data = urllib.request.urlopen(url, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f'Public archive digest mismatch: {name}')
    result = zipfile.ZipFile(io.BytesIO(data))
    names = result.namelist()
    if len(names) != len(set(names)):
        raise ValueError('Duplicate archive paths')
    for name in names:
        path = Path(name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe archive path')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', type=int, choices=RELEASES, default=42)
    version = parser.parse_args().version
    revision, app_sha = RELEASES[version]
    root = Path('/tmp/along')
    root.mkdir()  # A previous checkout is a failure, never silently reused.

    def run(*args):
        subprocess.run(args, cwd=root, check=True)

    run('git', 'init', '-q')
    run('git', 'remote', 'add', 'origin', 'https://github.com/reality2-ai/along.git')
    run('git', 'fetch', '--depth=1', 'origin', revision)
    run('git', 'checkout', '--detach', 'FETCH_HEAD')
    app = archive(version, f'along-web-v{version}.zip', app_sha)
    runtime = archive(40, RUNTIME + '.zip', RUNTIME_SHA)
    runtime.extractall(root / 'releases')
    for name in ('network', 'streets', 'addresses', 'routes'):
        (root / 'data' / f'{name}.json.gz').write_bytes(app.read(f'data/{name}.json.gz'))
    run('python3', 'scripts/build_upgrade_candidate.py', '--runtime', 'releases/' + RUNTIME)
    candidate = root / 'releases/along-regular-upgrade-candidate'
    manifest = json.loads((candidate / 'build-info.json').read_text())
    published = json.loads(app.read('build-info.json'))
    if str(manifest['appVersion']) != str(version) or str(published['appVersion']) != str(version):
        raise ValueError('Wrong application version')
    actual = {k: v for k, v in manifest['files'].items() if k != 'DO-NOT-PUBLISH.txt'}
    expected = {k: v for k, v in published['files'].items()
                if k not in ('README.md', 'qualification.json')}
    if not expected or actual != expected:
        raise ValueError({'missing': sorted(expected.keys() - actual.keys()),
                          'extra': sorted(actual.keys() - expected.keys()),
                          'changed': [k for k in actual.keys() & expected.keys()
                                      if actual[k] != expected[k]]})
    for name, digest in expected.items():
        body = (candidate / name).read_bytes()
        if hashlib.sha256(body).hexdigest() != digest or body != app.read(name):
            raise ValueError(f'Application bytes differ: {name}')
    record = {
        'status': 'passed', 'source_commit': revision, 'app_version': version,
        'application_files_matched': len(expected), 'app_archive_sha256': app_sha,
        'runtime_archive_sha256': RUNTIME_SHA,
        'source': 'Anonymous public Git fetch',
        'inputs': f'Public v0.{version}.0 app data and v0.40.0 runtime archive; pinned SHA-256 verified',
        'excluded_release_metadata': ['README.md', 'qualification.json', 'build-info.json'],
        'scope': 'Actual integrated Python app build in isolated Linux container; byte-for-byte application comparison. Prebuilt public runtime used; compiler reproduction is separate. No credentials, host source, node_modules or data mounted.',
    }
    Path('/output/result.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))


if __name__ == '__main__':
    main()
