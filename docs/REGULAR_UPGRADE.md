# Regular Along upgrade candidate

Regular Along remains version **37** and Device Preview remains **3806**.
A local version-38 candidate now tests adding the existing TG/live modules at the
regular app's URL. It is **not published or release-qualified**. The candidate
retains a `DO-NOT-PUBLISH.txt` marker and an explicit local-experiment notice.

The [upgrade evidence](evidence/regular-upgrade-candidate.json) verifies the exact
released v37 ZIP by its published SHA-256, installs it with a service worker under
`/along/`, then uses **Update and reopen** to install the local candidate at that
same scope. The test preserves saved endpoints, Bus 70 preference, local history,
learning choice, feedback sentinel and course acknowledgement. A preview-storage
sentinel remains untouched. Optional live information stays unconfigured. Creating
a device group after the upgrade preserves those values, and that identity and
saved data reopen offline with no page errors.

All candidate application requests stay within `/along/`. The first run revealed
that the recovery page caused the browser's fallback `/favicon.ico` request. A
relative Along icon link fixes that; the complete rerun passes. The old shell
cache is replaced only when the new worker activates.

## Reproduce without publishing

```sh
python3 scripts/build_upgrade_candidate.py --runtime releases/along-r2-runtime-1b9229ad
ALONG_V37_ZIP=/path/to/released-v37/along-web.zip \
CHROMIUM_PATH=/path/to/chromium \
node experiments/journey-sync/regular-upgrade.test.mjs
```

The builder verifies the pinned runtime, creates the integration build, and places
its public files and experiment modules under one deployable subpath. It rewrites
relative module links and shell-cache entries to preserve that layout. It uses
regular persistence names; preview identities and keys are not imported. Generated
files remain ignored under `releases/`.

## Before promotion

- Update candidate installation/privacy wording for optional direct AT and device
  sharing; the local candidate still inherits some regular-app wording.
- Run the full live/TG, recovery, accessibility and offline-planning checks against
  the flattened candidate. This test covers upgrade/setup, not every feature.
- Check an old open regular-app tab, failed update recovery, and existing-device
  cases where applicable. Do not treat preview migration evidence as proof of a
  regular-app upgrade.
- Complete the outstanding physical S23 pairing, installation and spoken
  screen-reader checks. Initial pairing is still an explicit exchange.
- Produce an immutable release package and verify its deployed bytes before
  describing version 38 as available.
