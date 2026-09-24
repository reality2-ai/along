"""Rebuild v38 from committed source and compare its payloads with the release.

Uses a supplied verified runtime bundle and published data. Does not reconstruct
the compiler environment or re-import historical upstream data.
"""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE_SHA = '2d203b12ad1f1148e494165686435d66cacf6ec7853f0693b48cd46f15cccb3d'
RELEASE_SOURCE = '643c6eebe4a748afca5ed6dc00d8b756dbbe8386'


def sha(body):
    return hashlib.sha256(body).hexdigest()


def check(archive, runtime, revision):
    if sha(archive.read_bytes()) != RELEASE_SHA:
        raise ValueError('Expected the exact published v38 ZIP')
    commit = subprocess.check_output(
        ['git', 'rev-parse', '--verify', '--end-of-options', revision + '^{commit}'],
        cwd=ROOT, text=True).strip()
    with tempfile.TemporaryDirectory(prefix='along-rebuild-') as directory:
        source = Path(directory)
        raw = subprocess.check_output(['git', 'archive', commit], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
            tar.extractall(source, filter='data')
        with zipfile.ZipFile(archive) as release:
            manifest = json.loads(release.read('build-info.json'))
            (source / 'data').mkdir(exist_ok=True)
            for name in ('network', 'streets', 'addresses', 'routes'):
                path = f'data/{name}.json.gz'
                body = release.read(path)
                if sha(body) != manifest['files'][path]:
                    raise ValueError('Published data differs from its manifest')
                (source / path).write_bytes(body)
            subprocess.run(['python3', 'scripts/build_upgrade_candidate.py',
                            '--runtime', str(runtime)], cwd=source, check=True,
                           stdout=subprocess.DEVNULL)
            candidate = source / 'releases/along-regular-upgrade-candidate'
            built = json.loads((candidate / 'build-info.json').read_text())
            actual = {p.relative_to(candidate).as_posix()
                      for p in candidate.rglob('*') if p.is_file()}
            if actual != set(built['files']) | {'build-info.json'}:
                raise ValueError('Candidate file set differs from its manifest')
            payloads = set(built['files']) - {'DO-NOT-PUBLISH.txt'}
            release_payloads = set(manifest['files']) - {'README.md', 'qualification.json'}
            if payloads != release_payloads:
                raise ValueError('Candidate and release application file sets differ')
            for name in sorted(payloads):
                body = (candidate / name).read_bytes()
                if (sha(body) != built['files'][name]
                        or sha(body) != manifest['files'][name]
                        or body != release.read(name)):
                    raise ValueError(f'Rebuilt payload differs: {name}')
            return {
                'status': 'passed', 'source_commit': commit,
                'archive_sha256': RELEASE_SHA,
                'candidate_manifest_sha256': sha((candidate / 'build-info.json').read_bytes()),
                'runtime_provenance_sha256': sha((runtime / 'provenance.json').read_bytes()),
                'application_files_verified': len(payloads),
                'recorded_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'scope': 'Fresh committed-source export on this host, published data snapshot, supplied verified runtime. Every application file matches the ZIP; release README, qualification and release manifest are packaging metadata. Not a clean-machine toolchain rebuild, fresh upstream import or browser acceptance test.',
            }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--revision', default=RELEASE_SOURCE)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new evidence file; existing evidence is never replaced')
    result = check(args.archive.resolve(), args.runtime.resolve(), args.revision)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(f'PASS: {result["application_files_verified"]} application files match v38')
