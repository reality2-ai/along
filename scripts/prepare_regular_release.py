"""Package qualified regular v42 payloads without altering the app's served files."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {'arrive_by_and_shortcut','installed_v41_upgrade','journeys','capacity_reporting','checkpoint_app','rotated_journeys',
            'owner_key','shared_key_replacement','group_removal','rotated_at_owner',
            'rotated_different_at_owner','lost_confirmation','interrupted_acceptance',
            'installed_upgrade','relay_settings','recovery_settings','published_migration',
            'older_edit_storage','installed_connected_upgrade','installed_previous_release','installed_v40_upgrade','relay_membership_reconnect'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(qualification):
    evidence = json.loads(qualification.read_text())
    candidate = ROOT / 'releases/along-regular-upgrade-candidate'
    manifest_path = candidate / 'build-info.json'
    manifest = json.loads(manifest_path.read_text())
    if (evidence.get('profile') != 'along-regular-candidate-qualification-v1'
            or evidence.get('status') != 'passed'
            or evidence.get('unchanged_source_and_candidate') is not True
            or evidence.get('app_version') != '42'
            or manifest.get('profile') != 'along-regular-upgrade-candidate-v1'
            or manifest.get('appVersion') != '42'
            or evidence.get('candidate_manifest_sha256') != digest(manifest_path)
            or not REQUIRED.issubset(evidence.get('checks', {}))
            or any(evidence['checks'][name].get('status') != 'passed'
                   or evidence['checks'][name].get('exit_code') != 0 for name in REQUIRED)):
        raise ValueError('Matching successful qualification is required')
    files = manifest['files']
    if not {'index.html','sw.js','install.html','LICENSE','NOTICE.md',
            'runtime-provenance.json','DO-NOT-PUBLISH.txt'}.issubset(files):
        raise ValueError('Incomplete candidate')
    if {p.relative_to(candidate).as_posix() for p in candidate.rglob('*') if p.is_file()} != set(files) | {'build-info.json'}:
        raise ValueError('Candidate file set changed')
    for name, expected in files.items():
        relative = Path(name)
        path = candidate / relative
        if (relative.is_absolute() or '..' in relative.parts or 'APIKey' in name
                or '.test.' in name or any(p.is_symlink() for p in (path, *path.parents))
                or digest(path) != expected):
            raise ValueError('Candidate payload changed or excluded')
    output = ROOT / 'releases/along-web-v42'
    archive = ROOT / 'releases/along-web-v42.zip'
    if output.exists() or archive.exists():
        raise ValueError('Versioned release output already exists; preserve it')
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary)
        for name in files:
            if name == 'DO-NOT-PUBLISH.txt':
                continue
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(candidate / name, target)
        shutil.copy2(qualification, stage / 'qualification.json')
        (stage / 'README.md').write_text(
            '# Along — Auckland public transport\n\n'
            'Use at your own risk. An experimental AI-coding course app, not an official AT service.\n\n'
            'Serve this whole directory over HTTPS, including its experiments/ modules. '
            'Open index.html through the server. A subpath such as /along/ works. '
            'See INSTALL.md or install.html for desktop/mobile installation and offline use.\n\n'
            'Downloaded scheduled planning runs on your device without the portal. '
            'Personal-key AT access and device sharing are optional. No Along proxy is needed. '
            'A user-selected relay can reconnect permitted devices while their apps are open. '
            'Browser software custody is a limited R2 subset, not hardware-backed protection.\n\n'
            f'Source: https://github.com/reality2-ai/along/tree/{evidence["source_commit"]}\n\n'
            'Qualification records automated browser checks, not physical-device or external-relay acceptance. '
            'Source licences, data attribution, runtime provenance and third-party notices are included.\n')
        released = {p.relative_to(stage).as_posix(): digest(p) for p in sorted(stage.rglob('*')) if p.is_file()}
        record = {'profile':'along-regular-release-v1','appVersion':'42','source_commit':evidence['source_commit'],
                  'candidate_manifest_sha256':digest(manifest_path),'files':released}
        (stage / 'build-info.json').write_text(json.dumps(record,indent=2)+'\n')
        shutil.copytree(stage, output)
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as bundle:
        for path in sorted(output.rglob('*')):
            if path.is_file():
                entry=zipfile.ZipInfo(path.relative_to(output).as_posix(),(1980,1,1,0,0,0))
                entry.compress_type=zipfile.ZIP_DEFLATED
                entry.external_attr=0o100644 << 16
                bundle.writestr(entry,path.read_bytes())
    archive.with_suffix('.zip.sha256').write_text(digest(archive)+'  '+archive.name+'\n')
    print(json.dumps({'archive':str(archive),'sha256':digest(archive),'bytes':archive.stat().st_size,
                      'payload_files':len(released),'release_manifest_sha256':digest(output/'build-info.json')}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('qualification',type=Path)
    prepare(parser.parse_args().qualification)
