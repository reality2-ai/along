"""Exercise the portable launcher without starting real agents or tmux sessions."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class LauncherTests(unittest.TestCase):
    def test_folder_isolation_and_agent_working_directories(self):
        source = Path(__file__).resolve().parents[1] / 'start-ai.sh'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binaries = root / 'bin'
            binaries.mkdir()
            log = root / 'calls.jsonl'
            stub = binaries / 'stub'
            stub.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['LAUNCH_TEST_LOG'], 'a') as output:
    output.write(json.dumps({'name':name,'args':args,'cwd':os.getcwd()})+'\\n')
if name == 'tmux' and 'has-session' in args:
    # An unrelated legacy R2 session is running on this machine.
    sys.exit(0 if '=r2' in args or '=r2-claude' in args else 1)
if name == 'loginctl': print('yes')
''')
            stub.chmod(0o755)
            for name in ['tmux', 'codex', 'claude', 'loginctl', 'systemd-run']:
                (binaries / name).symlink_to(stub)
            env = dict(os.environ, PATH=f'{binaries}:{os.environ["PATH"]}',
                       XDG_RUNTIME_DIR=str(root), LAUNCH_TEST_LOG=str(log))
            env.pop('TMUX', None)
            env.pop('TMUX_PANE', None)
            projects = [root / 'one' / 'same name', root / 'two' / 'same name']
            identities = set()
            for project in projects:
                project.mkdir(parents=True)
                launcher = project / 'start-ai.sh'
                shutil.copy2(source, launcher)
                for engine in ['codex', 'claude']:
                    log.write_text('')
                    result = subprocess.run(['bash', str(launcher), engine, '--new'],
                                            cwd=root, env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    launch = next(c for c in calls if c['name'] == 'systemd-run')['args']
                    self.assertEqual(launch[launch.index('-c') + 1], str(project))
                    identity = launch[launch.index('-L') + 1]
                    self.assertNotIn(identity, identities)
                    identities.add(identity)
                    attach = next(c for c in calls if 'attach-session' in c['args'])['args']
                    self.assertIn(identity, attach)
                    self.assertFalse(any('=r2' in c['args'] for c in calls))

                    log.write_text('')
                    pane = subprocess.run(['bash', str(launcher), engine, '--run-pane', '--new'],
                                          input='q\n', cwd=root, env=dict(env, TMUX_PANE='%1'),
                                          capture_output=True, text=True, timeout=10)
                    self.assertEqual(pane.returncode, 0, pane.stderr)
                    self.assertNotIn('agent-handoff.py', pane.stderr)
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    agent = next(c for c in calls if c['name'] == engine)
                    self.assertEqual(agent['cwd'], str(project))
                    if engine == 'codex':
                        self.assertEqual(agent['args'][agent['args'].index('-C') + 1], str(project))
                    self.assertTrue((project / f'.start-{engine}-state').is_dir())


if __name__ == '__main__':
    unittest.main()
