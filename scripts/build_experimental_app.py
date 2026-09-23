"""Local-only integration build. Experimental release checks remain; do not distribute."""
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
PROFILE = 'along-experimental-app-v1'
IMPORT = re.compile(r'''(?:from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}/[^'"]+)['"]''')


def build(browser, wasm, notices=None, runtime=None):
    browser, wasm = browser.resolve(), wasm.resolve()
    output = ROOT / 'releases/along-experimental-app'
    output.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as scratch:
        stage = Path(scratch)
        copy_provenance(runtime, stage)
        copy_runtime_notices(notices or ROOT / 'releases/along-pairing-notices', stage / 'runtime-notices')
        shutil.copytree(ROOT / 'public', stage / 'public')
        (stage / 'public/data').mkdir()
        for name in ('network', 'streets', 'addresses', 'routes'):
            shutil.copy2(ROOT / f'data/{name}.json.gz', stage / f'public/data/{name}.json.gz')
        queue = ['experiments/tg-pairing/lab.mjs', 'experiments/at-credentials/app-bootstrap.mjs']
        copied = set()
        while queue:
            name = queue.pop()
            if name in copied:
                continue
            relative = Path(name)
            if (relative.is_absolute() or '..' in relative.parts or relative.suffix not in ('.mjs', '.js')
                    or not name.startswith(('experiments/tg-pairing/', 'experiments/at-credentials/', 'experiments/journey-sync/', 'public/'))):
                raise ValueError('Unexpected module path')
            source = ROOT / relative
            if name == 'experiments/tg-pairing/hive_wasm.js':
                source = wasm / 'hive_wasm.js'
            elif not source.is_file() and name.startswith('experiments/tg-pairing/'):
                source = browser / relative.relative_to('experiments/tg-pairing')
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied.add(name)
            for specifier in IMPORT.findall(source.read_text()):
                queue.append(posixpath.normpath(str(relative.parent / specifier)))
        for source, name in [
            (ROOT / 'experiments/tg-pairing/lab.html', 'experiments/index.html'),
            (ROOT / 'experiments/tg-pairing/comparison.css', 'experiments/tg-pairing/comparison.css'),
            (ROOT / 'experiments/at-credentials/credential-view.css', 'experiments/at-credentials/credential-view.css'),
            (ROOT / 'experiments/tg-pairing/vendor/qrcode.LICENSE', 'experiments/tg-pairing/vendor/qrcode.LICENSE'),
            (ROOT / 'experiments/tg-pairing/vendor/README.md', 'experiments/tg-pairing/vendor/README.md'),
            (wasm / 'hive_wasm_bg.wasm', 'experiments/tg-pairing/hive_wasm_bg.wasm'),
        ]:
            (stage / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, stage / name)
        app = stage / 'public/app.js'
        text = app.read_text()
        old = "import {createLiveClient} from './live-client.js';"
        if text.count(old) != 1:
            raise ValueError('App integration point changed')
        text = text.replace(old, "import '../experiments/at-credentials/app-bootstrap.mjs';\nimport {createLiveClient} from '../experiments/at-credentials/app-live-bridge.mjs';")
        text = text.replace("from './preferences.js';", "from '../experiments/journey-sync/app-preferences.mjs';")
        text = text.replace('the server receives your IP address.', 'Auckland Transport receives your IP address and personal key.')
        text += """
// Experimental connection changes update affordances without changing the journey.
window.addEventListener('along-live-connection-changed', () => {
  $('nearby-live').hidden = !liveClient.configured;
  $('nearby-live-help').hidden = !liveClient.configured;
  resetJourneyAlerts();
  $('journey-live').hidden = !journeyAlertClient.configured || !state.selectedJourney?.legs.slice(state.legIndex).some(leg => leg.trip);
  for (const view of detailViews.values()) {
    if (view.variant) view.markup = routeVariantMarkup(view.routeData, view.variant);
    else if (typeof view.body === 'function') delete view.markup;
  }
  // Existing dated detail results keep their normal expiry; preserve map/scroll.
  for (const id of ['stop-live', 'route-vehicle']) if ($(id)) $(id).hidden = !liveClient.configured;
});
window.addEventListener('along-saved-journeys-applied', () => {
  state.preferences = readPreferences();
  renderUsual({background:true}); renderSavedPlaces(); renderServicePreference();
  // A peer's changes update saved choices for next time. Do not replace the
  // current route, current leg, screen, focused control or route-detail map.
});
"""
        app.write_text(text)
        index = stage / 'public/index.html'
        text = index.read_text().replace('href="/"', 'href="./"').replace('href="/', 'href="./').replace('src="/', 'src="./')
        text = text.replace('</head>', '<link rel="stylesheet" href="../experiments/tg-pairing/comparison.css"></head>')
        text = text.replace('<body>', '<body><p role="note">Local integration experiment — use dummy AT keys only. Do not publish this build. Device and AT-key setup is in Settings.</p>')
        text = text.replace('the server receives your IP address.', 'Auckland Transport receives your IP address and personal key.')
        index.write_text(text)
        manifest = json.loads((stage / 'public/manifest.webmanifest').read_text())
        for key in ('id', 'scope', 'start_url'):
            manifest[key] = './'
        for icon in manifest['icons']:
            if icon['src'].startswith('/'):
                icon['src'] = '.' + icon['src']
        (stage / 'public/manifest.webmanifest').write_text(json.dumps(manifest, indent=2) + '\n')
        worker = stage / 'public/sw.js'
        text = worker.read_text().replace('along-shell-', 'along-experimental-shell-')
        extra = ['../' + str(p.relative_to(stage)) for p in sorted((stage / 'experiments').rglob('*')) if p.is_file()]
        extra.append('./at-client.js')
        text = text.replace("self.addEventListener('install'", 'SHELL.push(...' + json.dumps(extra) + ");\nself.addEventListener('install'", 1)
        worker.write_text(text)
        (stage / 'DO-NOT-PUBLISH.txt').write_text('Local experimental build only. Experimental release checks remain pending. Use synthetic credentials.\n'
            + ('Runtime provenance is included; see runtime-provenance.json.\n' if runtime else 'Runtime source/compiler provenance is not verified by this build.\n'))
        files = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
        (stage / 'build-info.json').write_text(json.dumps({'profile': PROFILE, 'files': files}, indent=2) + '\n')
        if output.exists():
            marker = output / 'build-info.json'
            if not marker.is_file() or json.loads(marker.read_text()).get('profile') != PROFILE:
                raise ValueError('Refusing to replace unrecognised output')
            shutil.rmtree(output)
        shutil.copytree(stage, output)
    print(f'Local integration build: {output}; serve its public/ directory URL from the root. DO NOT PUBLISH.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    args = runtime_arguments(parser)
    build(args.browser, args.wasm, args.notices, args.runtime)
