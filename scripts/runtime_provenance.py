"""Verify the recorded runtime bundle before selecting files for a static build.

Hashes establish consistency with the local build record, not a signature or
independent proof of the compiler's behavior.
"""
import hashlib
import json
from pathlib import Path
import shutil


def verify_runtime(source):
    source = Path(source).resolve()
    record = json.loads((source / 'provenance.json').read_text())
    if record.get('profile') != 'along-r2-runtime-v1' or record.get('independent_builds') != 2:
        raise ValueError('Unrecognised runtime build record')
    files = record['files']
    required = {'source.tar', 'wasm/hive_wasm.js', 'wasm/hive_wasm_bg.wasm',
                'notices/notice-manifest.json', 'notices/rust/COPYRIGHT-library.html'}
    if not required.issubset(files) or not any(name.startswith('browser/') for name in files):
        raise ValueError('Incomplete runtime build record')
    if record.get('source_archive_sha256') != files['source.tar']:
        raise ValueError('Source archive does not match build record')
    actual = {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
    if actual != set(files) | {'provenance.json'}:
        raise ValueError('Runtime bundle file set changed')
    for name, expected in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid runtime bundle path')
        path = source / relative
        if any(parent.is_symlink() for parent in (path, *path.parents)):
            raise ValueError('Runtime bundle contains a symbolic link')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Runtime bundle changed after building')
    return source / 'browser', source / 'wasm', source / 'notices'


def runtime_arguments(parser):
    parser.add_argument('--runtime', type=Path, help='Verified build_r2_runtime.py output; replaces separate inputs')
    parser.add_argument('--browser', type=Path)
    parser.add_argument('--wasm', type=Path)
    parser.add_argument('--notices', type=Path)
    args = parser.parse_args()
    if args.runtime:
        if args.browser or args.wasm or args.notices:
            parser.error('--runtime cannot be mixed with separate inputs')
        args.browser, args.wasm, args.notices = verify_runtime(args.runtime)
    elif not args.browser or not args.wasm:
        parser.error('Supply --runtime or both --browser and --wasm')
    return args


def copy_provenance(runtime, stage):
    if runtime:
        shutil.copy2(runtime / 'provenance.json', stage / 'runtime-provenance.json')
