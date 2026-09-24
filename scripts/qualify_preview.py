"""Run preview release checks against one unchanged source and candidate build."""
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
def main():
    if git('status', '--porcelain'):
        raise RuntimeError('Commit source changes before qualification')
    source = git('rev-parse', 'HEAD')
    manifest_path = ROOT / 'releases/along-device-preview/build-info.json'
    manifest = json.loads(manifest_path.read_text())
    if manifest['profile'] != 'along-device-preview-v1' or manifest['appVersion'] != '3806':
        raise RuntimeError('Build preview 3806 before qualification')
    digest = sha(manifest_path)
    directory = ROOT / 'releases' / f'qualification-{manifest["appVersion"]}-{source[:12]}'
    directory.mkdir(exist_ok=False)
    env = dict(os.environ, PREVIEW='1')
    for name in ['CHROMIUM_PATH', 'R2_WASM_DIR', 'R2_BROWSER_DIR']:
        if not env.get(name):
            raise RuntimeError(f'Set {name}')
    cases = [
        ('journeys', {}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('legacy_enrollment', {'LEGACY_ENROLLMENT':'1'}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('capacity_reporting', {'CAPACITY':'1'}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('checkpoint_app', {'CHECKPOINT_APP':'1'}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('rotated_journeys', {'ROTATE_GROUP_KEYS':'1'}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('owner_key', {'CHECK_BFCACHE':'1','GROUP_KEYS':'1'}, 'experiments/at-credentials/app-integration.test.mjs'),
        ('shared_key_replacement', {'MAIN_APP_SETUP':'1','REPLACE_SHARED_KEY':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('group_removal', {'MAIN_APP_SETUP':'1','REMOVE_GROUP_MEMBER':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('rotated_at_owner', {'MAIN_APP_SETUP':'1','ROTATE_GROUP_KEYS':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('rotated_different_at_owner', {'MAIN_APP_SETUP':'1','ROTATE_GROUP_KEYS':'1','DIFFERENT_AT_OWNER':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('journal_compaction', {}, 'experiments/journey-sync/app-store-browser.test.mjs'),
        ('upgrade_coexistence', {}, 'experiments/journey-sync/preview-coexistence.test.mjs'),
        ('relay_settings', {}, 'experiments/relay/app-settings.test.mjs'),
        ('recovery_settings', {}, 'experiments/journey-sync/startup-settings.test.mjs'),
        ('published_migration', {}, 'experiments/journey-sync/published-migration.test.mjs'),
        ('pairing_qr_expiry', {'QR_FLOW':'1','CANDIDATE_TIMEOUT':'1'}, 'experiments/tg-pairing/pairing-flow.test.mjs'),
        ('enrolled_relay', {'ENROLLED_RELAY_NETWORK':'1'}, 'experiments/at-credentials/peer-delivery.test.mjs'),
        ('generation_relay', {'RELAY_GENERATION':'1'}, 'experiments/at-credentials/peer-delivery.test.mjs'),
        ('older_edit_storage', {}, 'experiments/journey-sync/generation-migration.test.mjs'),
    ]
    evidence = {'profile':'along-preview-qualification-v1', 'app_version':manifest['appVersion'],
                'source_commit':source, 'candidate_manifest_sha256':digest, 'checks':{},
                'limits':'Local Chromium; some checks use source/runtime fixtures. No physical-device or external-relay acceptance.'}
    def run(case):
        name, extra, path = case
        log = directory / f'{name}.log'
        with log.open('wb') as output:
            try:
                result = subprocess.run(['node', path], cwd=ROOT, env={**env, **extra}, stdout=output, stderr=subprocess.STDOUT, timeout=600)
                code = result.returncode
            except subprocess.TimeoutExpired:
                code = 124
                output.write(b'\nQualification runner timeout after 600 seconds.\n')
        return name, {'status':'passed' if code == 0 else 'failed', 'exit_code':code,
                      'command':' '.join([f'{k}={v}' for k,v in {'PREVIEW':'1', **extra}.items()] + ['node', path]),
                      'log_sha256':sha(log)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for future in concurrent.futures.as_completed([pool.submit(run, case) for case in cases]):
            name, result = future.result()
            evidence['checks'][name] = result
            (directory / 'progress.json').write_text(json.dumps(evidence, indent=2)+'\n')
            print(name + ': ' + result['status'], flush=True)
    checks = evidence['checks']
    checks['rotation_settings'] = {**checks['owner_key'], 'note':'Covered by GROUP_KEYS=1 owner-key/BFCache run.'}
    checks['older_edit_settings'] = {**checks['published_migration'], 'note':'Includes older-copy, stale-choice and interrupted-application Settings review.'}
    unchanged = git('rev-parse','HEAD') == source and not git('status','--porcelain') and sha(manifest_path) == digest
    for name, expected in manifest['files'].items():
        unchanged = unchanged and sha(manifest_path.parent / name) == expected
    evidence['recorded_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    evidence['unchanged_source_and_candidate'] = unchanged
    evidence['status'] = 'passed' if unchanged and all(c['status']=='passed' for c in checks.values()) else 'failed'
    path = directory / 'qualification.json'
    path.write_text(json.dumps(evidence, indent=2)+'\n')
    print(str(path), flush=True)
    return 0 if evidence['status']=='passed' else 1
if __name__ == '__main__':
    sys.exit(main())
