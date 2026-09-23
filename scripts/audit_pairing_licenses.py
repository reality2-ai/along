"""Inventory the pairing WASM dependency closure from Cargo metadata; no legal inference."""
import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path


def inventory(metadata):
    packages = {package['id']: package for package in metadata['packages']}
    nodes = {node['id']: node for node in metadata['resolve']['nodes']}
    roots = [p['id'] for p in metadata['packages'] if p['name'] == 'hive-wasm']
    if len(roots) != 1:
        raise ValueError('Exactly one hive-wasm package required')
    queue, seen = roots[:], set()
    while queue:
        identity = queue.pop()
        if identity in seen:
            continue
        seen.add(identity)
        for dep in nodes[identity]['deps']:
            if any(kind['kind'] != 'dev' for kind in dep['dep_kinds']):
                queue.append(dep['pkg'])
    records = []
    for identity in sorted(seen, key=lambda key: (packages[key]['name'], packages[key]['version'])):
        package = packages[identity]
        root = Path(package['manifest_path']).parent
        notices = []
        for source in sorted(root.iterdir()):
            if source.is_file() and any(term in source.name.upper() for term in ('LICENSE', 'LICENCE', 'COPYRIGHT', 'NOTICE')):
                notices.append({'file': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
        if package.get('license_file'):
            source = root / package['license_file']
            if source.is_file() and not any(item['file'] == package['license_file'] for item in notices):
                notices.append({'file': package['license_file'], 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
        records.append({'name': package['name'], 'version': package['version'],
                        'source': 'registry' if (package.get('source') or '').startswith('registry') else 'local-or-git',
                        'license': package['license'], 'license_file': package.get('license_file'), 'notices': notices})
    unresolved = [{'name': item['name'], 'reasons':
                   ([] if item['license'] or item['license_file'] else ['no license declaration']) +
                   ([] if item['notices'] else ['no package notice text found'])}
                  for item in records if not (item['license'] or item['license_file']) or not item['notices']]
    return {'format': 1, 'root': 'hive-wasm', 'target': 'wasm32-unknown-unknown',
            'scope': 'Cargo resolved non-dev dependency closure; includes build/proc-macro packages, not a binary symbol inventory',
            'packages': records, 'unresolved': unresolved}


def collect(metadata, report, rust_doc=None):
    """Copy package notices and the owner-approved scoped R2 distribution grant."""
    output = Path(__file__).resolve().parents[1] / 'releases' / 'along-pairing-notices'
    output.parent.mkdir(exist_ok=True)
    packages = {(p['name'], p['version']): p for p in metadata['packages']}
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary)
        for record in report['packages']:
            package = packages[record['name'], record['version']]
            root = Path(package['manifest_path']).parent
            for notice in record['notices']:
                original = root / notice['file']
                data = original.read_bytes()
                if hashlib.sha256(data).hexdigest() != notice['sha256']:
                    raise ValueError('Notice changed after inventory')
                target = stage / (record['name'] + '-' + record['version']) / Path(notice['file']).name
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    raise ValueError('Duplicate notice destination')
                target.write_bytes(data)
        root = Path(__file__).resolve().parents[1]
        for name in ('R2-MIT.txt', 'R2-SCOPE.md'):
            shutil.copy2(root / 'docs/licenses' / name, stage / name)
        shutil.copy2(root / 'LICENSE', stage / 'Along-MIT.txt')
        if rust_doc is not None:
            rust_doc = Path(rust_doc)
            (stage / 'rust').mkdir()
            shutil.copy2(rust_doc / 'COPYRIGHT-library.html', stage / 'rust/COPYRIGHT-library.html')
            shutil.copytree(rust_doc / 'licenses', stage / 'rust/licenses')
        (stage / 'inventory.json').write_text(json.dumps(report, indent=2) + '\n')
        (stage / 'README.txt').write_text('Distribution notice collection for Along pairing experiments.\n'
            'Package texts are preserved verbatim. See inventory.json for dependency scope and upstream metadata gaps.\n'
            'R2-SCOPE.md and R2-MIT.txt record the owner-approved MIT grant for the included R2 subset.\n'
            'The Rust notice collection, when present, covers multiple targets and is broader than this WASM binary.\n'
            'Final distribution still requires matching source, dependency and compiler provenance to the built runtime.\n')
        files = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(stage.rglob('*')) if p.is_file()}
        (stage / 'notice-manifest.json').write_text(json.dumps({
            'profile': 'along-runtime-notices-v1', 'rust_library_notices': rust_doc is not None,
            'files': files}, indent=2) + '\n')
        if output.exists():
            marker = output / 'inventory.json'
            if not marker.is_file() or json.loads(marker.read_text()).get('root') != 'hive-wasm':
                raise ValueError('Refusing to replace unrecognised output')
            shutil.rmtree(output)
        shutil.copytree(stage, output)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('metadata', type=Path)
    parser.add_argument('--collect', action='store_true', help='Copy found notice texts into releases/along-pairing-notices; does not resolve missing entries')
    parser.add_argument('--rust-doc', type=Path, help='Compiler share/doc/rust directory; preserves library copyright and licence texts')
    args = parser.parse_args()
    metadata = json.loads(args.metadata.read_text())
    report = inventory(metadata)
    if args.collect:
        print(collect(metadata, report, args.rust_doc))
    else:
        print(json.dumps(report, indent=2))
