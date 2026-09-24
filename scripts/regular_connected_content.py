"""Connected regular-candidate text without changing deployed v37 or preview copy."""
from pathlib import Path
from render_install_guide import render_blocks
ROOT = Path(__file__).resolve().parents[1]


def prepare_regular_connected_content(stage):
    replacements = {
        'Along learns from successful journey searches, not background tracking. Your searches and learning history stay on this device. You can choose to share saved places and service preferences with permitted devices. An optional relay sees connection metadata; shared journeys are encrypted.':
            'Search history and current location stay on this device. If you allow journey sharing, saved places and service preferences can be exchanged with your connected devices. An optional relay helps permitted devices reconnect while Along is open. It sees connection metadata; shared journeys are encrypted. No Along server stores your journeys.',
        'After preparation, address search and scheduled journey planning work offline on your device. Optional online AT information can add current predictions and alerts. The public app’s live connection is not yet enabled; its journey times use the downloaded timetable. The portal supplies downloads and updates, not your journey calculations.':
            'Downloaded address search and scheduled planning work offline. Optional AT checks use your configured personal key to request current information directly from AT. Unavailable or unmatched information leaves the schedule in place. The portal supplies downloads and updates, not journey calculations.',
        'Forget my journey history': 'Forget history and saved places',
    }
    for name in ('index.html', 'locales.js'):
        path = stage / name
        text = path.read_text()
        for old, new in replacements.items():
            if text.count(old) != 1:
                raise ValueError(f'Regular candidate wording changed in {name}')
            text = text.replace(old, new)
        if name == 'index.html':
            text = text.replace('<p id="storage-message"', '<p class="field-help">Clears local history and saved places. Saved-place removals will be shared with permitted devices when connected.</p><p id="storage-message"', 1)
        path.write_text(text)
    guide = (ROOT / 'docs/CONNECTED_INSTALL.md').read_text()
    regular = (ROOT / 'docs/INSTALL.md').read_text()
    platforms = regular.split('## Choose your browser and platform\n', 1)[1].split('## What works without the portal?\n', 1)[0]
    guide = guide.replace('<!-- platform-guide -->', '## Choose your browser and platform\n' + platforms)
    (stage / 'INSTALL.md').write_text(guide)
    html = '<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Install Along · Offline and optional live information</title><link rel="stylesheet" href="./style.css"><link rel="icon" href="./icon.svg"></head><body class="guided-app install-guide"><main><a id="guide-back" class="text-button" href="./">← Open Along</a>'
    html += render_blocks(guide, 'en')
    html += '<p><a id="guide-open" class="secondary-button" href="./">Open Along</a></p></main></body></html>'
    (stage / 'install.html').write_text(html)
