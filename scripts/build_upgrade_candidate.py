"""Build a local regular-app upgrade candidate. Not release-qualified or publishable."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

from build_experimental_app import build
from runtime_provenance import verify_runtime
from regular_connected_content import prepare_regular_connected_content

ROOT = Path(__file__).resolve().parents[1]
PROFILE = 'along-regular-upgrade-candidate-v1'


def candidate(runtime):
    browser, wasm, notices = verify_runtime(runtime)
    build(browser, wasm, notices, runtime)
    source = ROOT / 'releases/along-experimental-app'
    original = json.loads((source / 'build-info.json').read_text())
    output = ROOT / 'releases/along-regular-upgrade-candidate'
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary)
        for name, expected in original['files'].items():
            body = (source / name).read_bytes()
            if hashlib.sha256(body).hexdigest() != expected:
                raise ValueError('Integration input changed')
            target_name = name.removeprefix('public/')
            target = stage / target_name
            if target.exists():
                raise ValueError('Flattened path collision')
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.suffix in ('.js', '.mjs', '.html', '.css'):
                text = body.decode()
                if name.startswith('public/'):
                    text = text.replace('../experiments/', './experiments/')
                elif name.startswith('experiments/'):
                    text = text.replace('../../public/', '../../')
                if name == 'public/sw.js':
                    text = text.replace('along-experimental-shell-', 'along-shell-').replace('along-shell-v37', 'along-shell-v41')
                if name == 'public/index.html':
                    text = text.replace('App version 37', 'App version 41')
                    text = text.replace('<p role="note">Local integration experiment — use dummy AT keys only. Do not publish this build. Device and AT-key setup is in Settings.</p>', '')
                if name == 'public/update.html':
                    text = text.replace('recovery=37', 'recovery=41').replace('Recovery page 37', 'Recovery page 41')
                body = text.encode()
            target.write_bytes(body)
        prepare_regular_connected_content(stage)
        for name in ('LICENSE', 'NOTICE.md'):
            shutil.copy2(ROOT / name, stage / name)
        (stage / '.nojekyll').touch()
        (stage / 'build-info.json').write_text(json.dumps({
            'profile': PROFILE, 'appVersion': '41', 'publishable': False,
            'files': {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in sorted(stage.rglob('*')) if p.is_file()},
        }, indent=2) + '\n')
        if output.exists():
            if json.loads((output / 'build-info.json').read_text()).get('profile') != PROFILE:
                raise ValueError('Refusing to replace unrecognised output')
            shutil.rmtree(output)
        shutil.copytree(stage, output)
    print(f'Local upgrade candidate: {output}. DO NOT PUBLISH.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    candidate(parser.parse_args().runtime.resolve())
