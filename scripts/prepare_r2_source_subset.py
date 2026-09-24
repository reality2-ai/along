"""Prepare the owner-approved R2 source subset locally; not a release command."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tomllib

from runtime_provenance import verify_runtime

ROOT = Path(__file__).resolve().parents[1]
BASE = 'implementations/rust/'
ALLOWED = {'hive-wasm', 'hive-web-identity', 'r2-discovery', 'r2-hal-traits',
           'r2-ident', 'r2-mesh', 'r2-routing', 'r2-transport', 'r2-trust', 'r2-wire'}


def sha(body):
    return hashlib.sha256(body).hexdigest()


def value(item):
    if isinstance(item, dict):
        return '{' + ', '.join(json.dumps(k) + ' = ' + value(v) for k, v in item.items()) + '}'
    if isinstance(item, list):
        return '[' + ', '.join(value(v) for v in item) + ']'
    return json.dumps(item)


def prepare(runtime, output, toolchain):
    if not subprocess.check_output(['rustc', '+' + toolchain, '--version'], text=True).startswith('rustc 1.96.1 '):
        raise ValueError('Use the recorded Rust 1.96.1 toolchain')
    verify_runtime(runtime)
    provenance = json.loads((runtime / 'provenance.json').read_text())
    inventory = json.loads((runtime / 'notices/inventory.json').read_text())
    if {p['name'] for p in inventory['packages'] if p['source'] == 'local-or-git'} != ALLOWED:
        raise ValueError('Runtime package closure differs from approved scope')
    if output.exists():
        raise ValueError('Choose a new output directory')
    output.mkdir(parents=True)
    copied, packages, inherited = {}, {}, set()
    with tarfile.open(runtime / 'source.tar') as archive:
        members = {m.name: m for m in archive.getmembers() if m.isfile()}
        read = lambda name: archive.extractfile(members[name]).read()
        original = tomllib.loads(read(BASE + 'Cargo.toml').decode())
        for name in members:
            if name.endswith('/Cargo.toml'):
                document = tomllib.loads(read(name).decode())
                package = document.get('package', {}).get('name')
                if package in ALLOWED:
                    if package in packages:
                        raise ValueError('Duplicate package')
                    packages[package] = name.removeprefix(BASE).removesuffix('/Cargo.toml')
                    for section in ('dependencies', 'dev-dependencies', 'build-dependencies'):
                        for dep, spec in document.get(section, {}).items():
                            if isinstance(spec, dict) and spec.get('workspace'):
                                inherited.add(dep)
                    if document.get('target'):
                        raise ValueError('Review target-specific dependencies before export')
        if set(packages) != ALLOWED:
            raise ValueError('Missing approved package')
        dependencies = {name: original['workspace']['dependencies'][name] for name in sorted(inherited)}
        for spec in dependencies.values():
            if isinstance(spec, dict) and 'path' in spec and spec['path'] not in packages.values():
                raise ValueError('Dependency outside approved source scope')
        standalone = {
            'workspace': {'resolver': original['workspace']['resolver'],
                          'members': sorted(packages.values()), 'default-members': ['hives/hive-wasm'],
                          'package': original['workspace']['package'],
                          'dependencies': dependencies, 'lints': original['workspace']['lints']},
            'profile': original['profile'],
        }
        (output / 'Cargo.toml').write_text('\n'.join(k + ' = ' + value(v) for k, v in standalone.items()) + '\n')
        for name in members:
            relative = name.removeprefix(BASE)
            selected = any(relative == p + '/Cargo.toml' or relative.startswith(p + '/src/')
                           for p in packages.values())
            selected = selected or relative.startswith('hives/hive-wasm/browser/')
            if not selected:
                continue
            path = Path(relative)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Invalid source path')
            body = read(name)
            target = output / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            copied[relative] = sha(body)
        original_lock = read(BASE + 'Cargo.lock')
        (output / 'Cargo.lock').write_bytes(original_lock)
    # Cargo prunes the removed workspace packages. The old lock is the input;
    # refuse any package version/source/checksum not already in that lock.
    subprocess.run(['cargo', '+' + toolchain, 'metadata', '--offline', '--format-version', '1',
                    '--filter-platform', 'wasm32-unknown-unknown'], cwd=output,
                   stdout=subprocess.DEVNULL, check=True)
    before = tomllib.loads(original_lock.decode())['package']
    after = tomllib.loads((output / 'Cargo.lock').read_text())['package']
    identity = lambda p: (p['name'], p['version'], p.get('source'), p.get('checksum'))
    if not {identity(p) for p in after}.issubset({identity(p) for p in before}):
        raise ValueError('Subset changed locked package selection')
    for name in ('R2-MIT.txt', 'R2-SCOPE.md'):
        shutil.copy2(ROOT / 'docs/licenses' / name, output / name)
    (output / 'source-provenance.json').write_text(json.dumps({
        'profile': 'along-r2-source-subset-v1', 'source_commit': provenance['source_commit'],
        'original_archive_sha256': provenance['source_archive_sha256'],
        'packages': packages, 'unchanged_source_files': copied,
        'changes': ['Standalone workspace includes approved packages and their inherited dependencies only.',
                    'Unrelated workspace members, patches and tooling omitted; release profile preserved.',
                    'Cargo.lock pruned offline; retained package versions, sources and checksums unchanged.',
                    'Original package manifests, Rust sources and browser modules copied byte for byte.'],
        'limits': 'Local preparation only. Private standard documents, full workspace tests and test fixtures are not included. Build and distribution verification remain required.',
    }, indent=2) + '\n')
    print(f'Prepared {len(packages)} packages and {len(copied)} original files at {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--toolchain', default='1.96.1')
    args = parser.parse_args()
    prepare(args.runtime.resolve(), args.output.resolve(), args.toolchain)
