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

The [expanded resilience check](evidence/regular-upgrade-resilience.json) injects
a missing WASM download: the new worker fails installation and v37 reopens
offline. A complete retry then succeeds. An already-open v37 tab uses its actual
released preference writer to save a Bus 75 change before sharing is enabled;
the candidate retains it offline. This does not prove arbitrary stale whole-object
writes are safe. The connected installation guide now describes personal AT keys,
sharing and relay privacy; offline rendering fits 320px, passes axe and supports
keyboard Back. Automated axe results are not spoken screen-reader acceptance.

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

- Remove candidate-only status text only when release qualification and promotion
  are complete. The connected guide is sourced from `CONNECTED_INSTALL.md`.
- Run the full live/TG, recovery, accessibility and offline-planning checks against
  the flattened candidate. This test covers upgrade/setup, not every feature.
- Check existing-device cases and shared-generation old-tab behavior where
  applicable. The local pre-sharing old-tab and failed-update checks above pass;
  preview migration evidence is not proof of every regular-app upgrade.
- Complete the outstanding physical S23 pairing, installation and spoken
  screen-reader checks. Initial pairing is still an explicit exchange.
- Produce an immutable release package and verify its deployed bytes before
  describing version 38 as available.
