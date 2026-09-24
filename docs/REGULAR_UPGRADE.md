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

## Connected-feature checks

[Candidate integration evidence](evidence/regular-candidate-integration.json) now
records four passing runs against the flattened `/along/` build:

- Personal synthetic AT-key setup, contextual provider reads, offline fallback,
  real browser Back restoration, optional-runtime timeout and unreadable storage
  preservation. The provider is intercepted; this is not a live AT availability check.
- Relay Settings against the actual R2 relay on loopback: explicit opt-in, saved
  reconnection, stop/remove, keyboard operation and recovery pause.
- Two isolated browser profiles: actual UI enrollment, service-preference sharing,
  current-journey/focus preservation, group-key update, offline edits, permission
  removal, device removal and narrow/zoom accessibility.
- Reviewed checkpoint creation/transfer/application followed by sharing further
  deletion/re-save changes, while retaining local history and the current journey.

The harness copies public connection messages. This is not physical pairing or
external relay acceptance. A preview relay test also passes after the harness was
adapted to support both directory layouts. Published app bytes are unchanged.

The [shared-key and recovery checks](evidence/regular-candidate-shared-keys.json)
add six passing runs: replacement of a shared synthetic key, device removal,
group-key updates with a different AT-key owner, lost key receipt, interrupted
owner acceptance, and recovery Settings. Lost receipts resume without replacing
either encrypted key; interrupted acceptance retains the selected owner and
requires an explicit resume. The recipient refuses superseded key access after
learning the update. Removal closes live access without changing the selected
journey, and offline routing remains available. This does not revoke a key at AT
or erase data already copied by a device. Recovery Settings uses fixture starting
records, with real signing, review and guarded writes.

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
- Complete interrupted older-copy recovery coverage against the regular
  candidate, including quota/race recovery. The connected and shared-key runs
  above supplement upgrade/setup, but do not cover every path.
- Check existing-device cases and shared-generation old-tab behavior where
  applicable. The local pre-sharing old-tab and failed-update checks above pass;
  preview migration evidence is not proof of every regular-app upgrade.
- Complete the outstanding physical S23 pairing, installation and spoken
  screen-reader checks. Initial pairing is still an explicit exchange.
- Produce an immutable release package and verify its deployed bytes before
  describing version 38 as available.
