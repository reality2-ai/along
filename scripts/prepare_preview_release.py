"""Package an exactly qualified preview candidate; does not deploy or change source."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROFILE = 'along-device-preview-release-v1'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(qualification):
    qualification = Path(qualification)
    evidence = json.loads(qualification.read_text())
    candidate = ROOT / 'releases/along-device-preview'
    manifest_path = candidate / 'build-info.json'
    manifest = json.loads(manifest_path.read_text())
    required = {'journeys', 'owner_key', 'shared_key_replacement', 'upgrade_coexistence'}
    if int(manifest.get('appVersion', '0')) >= 3802:
        required.add('group_removal')
    if int(manifest.get('appVersion', '0')) >= 3803:
        required.add('legacy_enrollment')
    if int(manifest.get('appVersion', '0')) >= 3804:
        required.update({'rotated_journeys', 'rotated_at_owner', 'rotated_different_at_owner', 'rotation_settings'})
    if int(manifest.get('appVersion', '0')) >= 3805:
        required.update({'journal_compaction', 'capacity_reporting'})
    if (evidence.get('profile') != 'along-preview-qualification-v1'
            or evidence.get('candidate_manifest_sha256') != digest(manifest_path)
            or any(evidence.get('checks', {}).get(name, {}).get('status') != 'passed' for name in required)
            or manifest.get('profile') != 'along-device-preview-v1'
            or manifest.get('appVersion') != evidence.get('app_version')):
        raise ValueError('Candidate lacks matching qualification evidence')
    files = manifest['files']
    actual = {p.relative_to(candidate).as_posix() for p in candidate.rglob('*') if p.is_file()}
    if actual != set(files) | {'build-info.json'}:
        raise ValueError('Candidate file set changed')
    for name, expected in files.items():
        relative = Path(name)
        if (relative.is_absolute() or '..' in relative.parts or 'APIKey' in name or '.test.' in name
                or (candidate / name).is_symlink() or digest(candidate / name) != expected):
            raise ValueError('Candidate payload changed or contains an excluded file')
    if not {'DO-NOT-PUBLISH.txt', 'runtime-provenance.json', 'public/sw.js', 'public/install.html'}.issubset(files):
        raise ValueError('Candidate is incomplete')
    output = ROOT / 'releases/along-device-preview-release'
    with tempfile.TemporaryDirectory(dir=output.parent) as scratch:
        stage = Path(scratch)
        for name in files:
            if name == 'DO-NOT-PUBLISH.txt':
                continue
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(candidate / name, target)
        shutil.copy2(qualification, stage / 'qualification.json')
        shutil.copy2(ROOT / 'docs/PREVIEW_DEVICE_CHECK.md', stage / 'DEVICE_CHECK.md')
        for name in ('LICENSE', 'NOTICE.md'):
            shutil.copy2(ROOT / name, stage / name)
        (stage / 'README.md').write_text(
            '# Along Device Preview\n\nUse at your own risk. A test preview for an AI-coding course, not an official AT app.\n\n'
            'Serve this whole directory over HTTPS and open `public/`. No Along backend is needed. '
            'Use the installation guide inside the app. Use dummy AT keys for these device tests.\n\n'
            'Saved places and device setup use separate browser storage from regular Along; '
            'same-origin scripts are not isolated. See PREVIEW_INSTALL.md and DEVICE_CHECK.md.\n\n'
            f'Application source: https://github.com/reality2-ai/along/tree/{evidence["source_commit"]}\n\n'
            'This release does not establish full R2 conformance, automatic device discovery, '
            'physical installation/TalkBack acceptance or completion of the wider project goal. '
            'Runtime provenance, scoped MIT grants and third-party notices are included.\n')
        released = {p.relative_to(stage).as_posix(): digest(p) for p in sorted(stage.rglob('*')) if p.is_file()}
        record = {**manifest, 'profile': PROFILE, 'files': released,
                  'source_commit': evidence['source_commit'], 'candidate_manifest_sha256': digest(manifest_path),
                  'status': 'test-preview'}
        (stage / 'build-info.json').write_text(json.dumps(record, indent=2) + '\n')
        if output.exists():
            old = output / 'build-info.json'
            if not old.is_file() or json.loads(old.read_text()).get('profile') != PROFILE:
                raise ValueError('Refusing to replace unrecognised release output')
            shutil.rmtree(output)
        shutil.copytree(stage, output)
    archive = ROOT / f'releases/along-device-preview-{manifest["appVersion"]}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in sorted(output.rglob('*')):
            if path.is_file():
                entry = zipfile.ZipInfo(path.relative_to(output).as_posix(), (1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                bundle.writestr(entry, path.read_bytes())
    archive.with_suffix('.zip.sha256').write_text(digest(archive) + '  ' + archive.name + '\n')
    print(json.dumps({'release': str(output), 'archive': str(archive), 'sha256': digest(archive),
                      'payload_files': len(released), 'archive_bytes': archive.stat().st_size}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('qualification', type=Path)
    prepare(parser.parse_args().qualification)
