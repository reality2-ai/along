"""Build a pinned browser runtime twice, retaining source and matching notices.

Only committed source is read. Build directories and Cargo targets are isolated;
the input checkout is never modified. Requires installed Rust wasm32 target,
cached Cargo dependencies and an explicit matching wasm-bindgen executable.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import tomllib

from audit_pairing_licenses import collect, inventory

TARGET = 'wasm32-unknown-unknown'
WORKSPACE = Path('implementations/rust')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def hashes(root):
    return {p.relative_to(root).as_posix(): digest(p)
            for p in sorted(root.rglob('*')) if p.is_file()}


def run(args, **kwargs):
    return subprocess.check_output([str(arg) for arg in args], text=True, **kwargs).strip()


def build(repo, revision, toolchain, bindgen, output, workspace_path=WORKSPACE):
    workspace_path = Path(workspace_path)
    if workspace_path.is_absolute() or '..' in workspace_path.parts or not workspace_path.parts:
        raise ValueError('Workspace must be a relative source directory')
    repo, bindgen, output = repo.resolve(), bindgen.resolve(), output.resolve()
    if output.exists():
        raise ValueError('Choose a new output directory; existing output is never replaced')
    commit = run(['git', '-C', repo, 'rev-parse', '--verify', '--end-of-options', revision + '^{commit}'])
    sysroot = Path(run(['rustc', '+' + toolchain, '--print', 'sysroot']))
    # Avoid inherited compiler flags, wrappers, target settings and credentials.
    env = {key: value for key, value in os.environ.items()
           if key in ('PATH', 'HOME', 'USER', 'TMPDIR', 'CARGO_HOME', 'RUSTUP_HOME', 'LANG')}
    env.update(RUSTUP_TOOLCHAIN=str(sysroot), CARGO_NET_OFFLINE='true', CARGO_INCREMENTAL='0')
    rustc, cargo = sysroot / 'bin/rustc', sysroot / 'bin/cargo'
    rust_version = run([rustc, '-vV'], env=env)
    bindgen_version = run([bindgen, '--version'], env=env)
    tools = {
        'rustc': {'version': rust_version, 'sha256': digest(rustc)},
        'cargo': {'version': run([cargo, '-V'], env=env), 'sha256': digest(cargo)},
        'wasm-bindgen': {'version': bindgen_version, 'sha256': digest(bindgen)},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='along-runtime-', dir=output.parent) as temporary:
        scratch = Path(temporary)
        stage = scratch / 'result'
        stage.mkdir()
        archive = stage / 'source.tar'
        with archive.open('wb') as stream:
            subprocess.run(['git', '-C', str(repo), 'archive', '--format=tar', commit,
                            str(workspace_path)], stdout=stream, check=True)
        first_hashes = None
        for number in (1, 2):
            source = scratch / f'build-{number}'
            source.mkdir()
            with tarfile.open(archive) as tar:
                tar.extractall(source, filter='data')
            workspace = source / workspace_path
            lock = tomllib.loads((workspace / 'Cargo.lock').read_text())
            expected = next(p['version'] for p in lock['package'] if p['name'] == 'wasm-bindgen')
            if bindgen_version != f'wasm-bindgen {expected}':
                raise ValueError('wasm-bindgen executable does not match Cargo.lock')
            target = source / 'target'
            local_env = dict(env, CARGO_TARGET_DIR=str(target))
            generated = source / 'generated'
            generated.mkdir()
            command = [cargo, 'build', '--locked', '--offline', '--release',
                       '--target', TARGET, '-p', 'hive-wasm']
            print(f'Building committed R2 source, fresh build {number}/2', flush=True)
            subprocess.run([str(arg) for arg in command], cwd=workspace, env=local_env, check=True)
            subprocess.run([str(bindgen), str(target / TARGET / 'release/hive_wasm.wasm'),
                            '--target', 'web', '--out-dir', str(generated)], env=local_env, check=True)
            generated_hashes = hashes(generated)
            if number == 1:
                first_hashes = generated_hashes
                shutil.copytree(generated, stage / 'wasm')
                shutil.copytree(workspace / 'hives/hive-wasm/browser', stage / 'browser')
                metadata = json.loads(run([cargo, 'metadata', '--locked', '--offline',
                                          '--format-version', '1', '--filter-platform', TARGET],
                                         cwd=workspace, env=local_env))
                collect(metadata, inventory(metadata), sysroot / 'share/doc/rust', stage / 'notices')
                lock_hash = digest(workspace / 'Cargo.lock')
            elif generated_hashes != first_hashes:
                raise ValueError('Independent builds produced different runtime files')
        provenance = {
            'profile': 'along-r2-runtime-v1', 'source_commit': commit,
            'source_paths': [str(workspace_path)], 'source_archive_sha256': digest(archive),
            'cargo_lock_sha256': lock_hash, 'target': TARGET, 'tools': tools,
            'build': ['cargo build --locked --offline --release --target wasm32-unknown-unknown -p hive-wasm',
                      'wasm-bindgen target/wasm32-unknown-unknown/release/hive_wasm.wasm --target web --out-dir generated'],
            'wasm_opt': False, 'independent_builds': 2,
            'reproducibility_scope': 'Two fresh source and target directories on this host; not cross-host verification',
            'files': hashes(stage),
        }
        (stage / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
        shutil.copytree(stage, output)
    print(f'Identical runtime outputs from both builds: {output}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--revision', required=True, help='Committed source revision; working-tree edits are excluded')
    parser.add_argument('--toolchain', required=True, help='Installed Rust toolchain with wasm32 and library notices')
    parser.add_argument('--bindgen', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New directory, preferably under ignored releases/')
    parser.add_argument('--workspace', type=Path, default=WORKSPACE, help='Committed Cargo workspace path within the source repository')
    args = parser.parse_args()
    build(args.repo, args.revision, args.toolchain, args.bindgen, args.output, args.workspace)
