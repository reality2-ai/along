"""Build the isolated experimental pairing lab. Never reads credentials or journey data."""
import argparse
import hashlib
import json
import posixpath
from pathlib import Path
import re
import shutil
import tempfile

from runtime_notices import copy_runtime_notices
from runtime_provenance import copy_provenance, runtime_arguments

ROOT = Path(__file__).resolve().parents[1]
EXPERIMENTS = ROOT / 'experiments'
LOCAL = EXPERIMENTS / 'tg-pairing'
IMPORT = re.compile(r'''(?:from\s*|import\s*\()\s*['"](\.{1,2}/[^'"]+)['"]''')


def build(browser, wasm, notices=None, runtime=None):
    browser, wasm = browser.resolve(), wasm.resolve()
    output = ROOT / 'releases' / 'along-pairing-lab'
    output.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as scratch:
        stage = Path(scratch)
        copy_provenance(runtime, stage)
        copy_runtime_notices(notices or ROOT / 'releases/along-pairing-notices', stage / 'runtime-notices')
        queue = ['tg-pairing/lab.mjs']
        copied = set()
        while queue:
            name = queue.pop()
            if name in copied:
                continue
            relative = Path(name)
            if (relative.is_absolute() or '..' in relative.parts or relative.suffix not in ('.mjs', '.js')
                    or relative.parts[0] not in ('tg-pairing', 'at-credentials')):
                raise ValueError('Unexpected module path')
            source = wasm / relative.name if name == 'tg-pairing/hive_wasm.js' else EXPERIMENTS / relative
            if not source.is_file() and relative.parts[0] == 'tg-pairing':
                source = browser / Path(*relative.parts[1:])
            if not source.is_file():
                raise FileNotFoundError(f'Missing module: {name}')
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied.add(name)
            for specifier in IMPORT.findall(source.read_text()):
                queue.append(posixpath.normpath(str(relative.parent / specifier)))
        for source, name in [(LOCAL / 'lab.html', 'index.html'), (LOCAL / 'comparison.css', 'tg-pairing/comparison.css'),
                             (EXPERIMENTS / 'at-credentials/credential-view.css', 'at-credentials/credential-view.css'),
                             (LOCAL / 'vendor/qrcode.LICENSE', 'tg-pairing/vendor/qrcode.LICENSE'),
                             (LOCAL / 'vendor/README.md', 'tg-pairing/vendor/README.md'),
                             (wasm / 'hive_wasm_bg.wasm', 'tg-pairing/hive_wasm_bg.wasm')]:
            (stage / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, stage / name)
        files = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(stage.rglob('*')) if p.is_file()}
        build_id = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:12]
        index = stage / 'index.html'
        index.write_text(index.read_text().replace('Development source', 'Lab build ' + build_id))
        files['index.html'] = hashlib.sha256(index.read_bytes()).hexdigest()
        (stage / 'build-info.json').write_text(json.dumps({'profile': 'along-pairing-lab-v1', 'build_id': build_id, 'files': files}, indent=2) + '\n')
        if output.exists():
            marker = output / 'build-info.json'
            if not marker.is_file() or json.loads(marker.read_text()).get('profile') != 'along-pairing-lab-v1':
                raise ValueError('Refusing to replace unrecognised output')
            shutil.rmtree(output)
        shutil.copytree(stage, output)
    print(f'Experimental pairing lab: {output} ({len(files)} files). Serve over HTTPS or localhost; no service worker.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    args = runtime_arguments(parser)
    build(args.browser, args.wasm, args.notices, args.runtime)
