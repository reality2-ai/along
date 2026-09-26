"""Run regular-candidate checks against one unchanged source and candidate build."""
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
    manifest_path = ROOT / 'releases/along-regular-upgrade-candidate/build-info.json'
    manifest = json.loads(manifest_path.read_text())
    if manifest['profile'] != 'along-regular-upgrade-candidate-v1' or manifest['appVersion'] != '46':
        raise RuntimeError('Build regular candidate 46 before qualification')
    actual = {p.relative_to(manifest_path.parent).as_posix() for p in manifest_path.parent.rglob('*') if p.is_file()}
    if actual != set(manifest['files']) | {'build-info.json'}:
        raise RuntimeError('Candidate file set differs from manifest')
    for name, expected in manifest['files'].items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or sha(manifest_path.parent / name) != expected:
            raise RuntimeError('Candidate payload differs from manifest')
    digest = sha(manifest_path)
    directory = ROOT / 'releases' / f'regular-qualification-{manifest["appVersion"]}-{source[:12]}'
    directory.mkdir(exist_ok=False)
    env = dict(os.environ, REGULAR_CANDIDATE='1', PREVIEW='0')
    for name in ['CHROMIUM_PATH', 'R2_WASM_DIR', 'R2_BROWSER_DIR']:
        if not env.get(name):
            raise RuntimeError(f'Set {name}')
    cases = [
        ('installed_v45_upgrade', {'ALONG_PRIOR_VERSION':'45'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('installed_v44_upgrade', {'ALONG_PRIOR_VERSION':'44'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('relay_origin_pacing', {}, 'experiments/r2-current/origin-pacing-browser.test.mjs'),
        ('recovery_inner_protection', {}, 'experiments/tg-pairing/recovery-link-protection.test.mjs'),
        ('automatic_recovery_capacity', {'AUTOMATIC_RECOVERY':'1','RECOVERY_REMOVALS':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('automatic_recovery_transport', {'AUTOMATIC_RECOVERY':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('guided_recovery_component', {'GUIDED_RECOVERY':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('guided_recovery_app', {'GUIDED_RECOVERY_APP':'1','GUIDED_OFFLINE':'1'}, 'experiments/relay/guided-app.test.mjs'),
        ('relay_enrollment_carriage', {}, 'experiments/tg-pairing/relay-enrollment-peer.test.mjs'),
        ('guided_scan', {'GUIDED_PAIRING':'1','GUIDED_SCAN':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('installed_v43_upgrade', {'ALONG_PRIOR_VERSION':'43'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('guided_app_offline', {'GUIDED_OFFLINE':'1'}, 'experiments/relay/guided-app.test.mjs'),
        ('guided_component', {'GUIDED_PAIRING':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('guided_cancel', {'GUIDED_PAIRING':'1','GUIDED_CANCEL':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('guided_conflict', {'GUIDED_PAIRING':'1','GUIDED_CONFLICT':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('guided_interrupted_install', {'GUIDED_PAIRING':'1','GUIDED_INTERRUPT':'install'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('guided_interrupted_ack', {'GUIDED_PAIRING':'1','GUIDED_INTERRUPT':'ack'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('invitation_channel_faults', {'AUTOMATIC_RELAY':'1','CHANNEL_CHECKS':'1'}, 'experiments/tg-pairing/automatic-enrollment.test.mjs'),
        ('arrive_by_and_shortcut', {}, 'test/check_arrive_by.mjs'),
        ('installed_v42_upgrade', {'ALONG_PRIOR_VERSION':'42'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('installed_v41_upgrade', {'ALONG_PRIOR_VERSION':'41'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('journeys', {}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('capacity_reporting', {'CAPACITY':'1'}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('checkpoint_app', {'CHECKPOINT_APP':'1'}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('rotated_journeys', {'ROTATE_GROUP_KEYS':'1'}, 'experiments/journey-sync/app-integration.test.mjs'),
        ('owner_key', {'CHECK_BFCACHE':'1','GROUP_KEYS':'1'}, 'experiments/at-credentials/app-integration.test.mjs'),
        ('shared_key_replacement', {'MAIN_APP_SETUP':'1','REPLACE_SHARED_KEY':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('group_removal', {'MAIN_APP_SETUP':'1','REMOVE_GROUP_MEMBER':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('rotated_at_owner', {'MAIN_APP_SETUP':'1','ROTATE_GROUP_KEYS':'1','GUIDED_AT_RECOVERY':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('rotated_different_at_owner', {'MAIN_APP_SETUP':'1','ROTATE_GROUP_KEYS':'1','DIFFERENT_AT_OWNER':'1','GUIDED_AT_RECOVERY':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('lost_confirmation', {'MAIN_APP_SETUP':'1','LOSE_KEY_CONFIRMATION':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('interrupted_acceptance', {'MAIN_APP_SETUP':'1','INTERRUPT_ACCEPTANCE':'1'}, 'experiments/at-credentials/two-app-integration.test.mjs'),
        ('installed_upgrade', {}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('installed_connected_upgrade', {'ALONG_PRIOR_VERSION':'38'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('installed_previous_release', {'ALONG_PRIOR_VERSION':'39'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('installed_v40_upgrade', {'ALONG_PRIOR_VERSION':'40'}, 'experiments/journey-sync/regular-upgrade.test.mjs'),
        ('relay_membership_reconnect', {'ENROLLED_RELAY_NETWORK':'1','REMOVAL_EDGES':'1'}, 'experiments/at-credentials/peer-delivery.test.mjs'),
        ('relay_settings', {}, 'experiments/relay/app-settings.test.mjs'),
        ('recovery_settings', {}, 'experiments/journey-sync/startup-settings.test.mjs'),
        ('published_migration', {}, 'experiments/journey-sync/published-migration.test.mjs'),
        ('older_edit_storage', {}, 'experiments/journey-sync/generation-migration.test.mjs'),
    ]
    evidence = {'profile':'along-regular-candidate-qualification-v1', 'app_version':manifest['appVersion'],
                'source_commit':source, 'candidate_manifest_sha256':digest, 'checks':{},
                'limits':'Local Chromium candidate qualification, not release packaging. Storage checks use candidate modules behind fixture URLs. Actual relay on loopback. No physical-device or external-endpoint acceptance.'}
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
                      'command':' '.join([f'{k}={v}' for k,v in {'REGULAR_CANDIDATE':'1', **extra}.items()] + ['node', path]),
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
    unchanged = unchanged and {p.relative_to(manifest_path.parent).as_posix() for p in manifest_path.parent.rglob('*') if p.is_file()} == actual
    evidence['recorded_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    evidence['unchanged_source_and_candidate'] = unchanged
    evidence['status'] = 'passed' if unchanged and all(c['status']=='passed' for c in checks.values()) else 'failed'
    path = directory / 'qualification.json'
    path.write_text(json.dumps(evidence, indent=2)+'\n')
    print(str(path), flush=True)
    return 0 if evidence['status']=='passed' else 1
if __name__ == '__main__':
    sys.exit(main())
