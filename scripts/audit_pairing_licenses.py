"""Inventory the pairing WASM dependency closure from Cargo metadata; no legal inference."""
import argparse
import hashlib
import json
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('metadata', type=Path)
    args = parser.parse_args()
    print(json.dumps(inventory(json.loads(args.metadata.read_text())), indent=2))
