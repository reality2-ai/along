# Regular Along version 38 release record

Regular Along **39** is now deployed; Device Preview remains **3806**.
See the [v39 release record](RELEASE_V39.md). The v38 record below is historical.
The [public-file check](evidence/regular-v38-public-files.json) matches all 304 files
to the release package. The [live browser check](evidence/regular-v38-public-browser.json)
passes setup and offline new-address routing. Physical acceptance remains open.

Current setup instructions are in [Building Along](BUILDING.md); physical checks
are in [Device check](DEVICE_CHECK.md).

The following sections retain the candidate-development history. Statements about
not being published describe those earlier stages, not the current release.
A local version-38 candidate now tests adding the existing TG/live modules at the
regular app's URL. It is **not published or release-qualified**. The candidate
retains a `DO-NOT-PUBLISH.txt` marker. Its interface now contains the intended
release wording, so qualification can cover the files intended for publication.
The public site has not been updated by this preparation.

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

## Actual v37 older-copy recovery

[Recovery evidence](evidence/regular-older-copy-recovery.json) records a compatibility
bug found with the exact published v37 writer: it strips unknown sharing metadata,
so the newer review refused its local edits. The fix permits missing metadata for
the older local copy and acknowledged baseline only. Current shared state still
requires its group/version binding; present malformed or foreign-group metadata
is rejected. Import remains a reviewed choice under the existing guarded writer.

Five targeted tests and the complete UI/storage recovery runs pass. They cover
leaving review without changes, a failed planner write after the shared commit,
newer local edits, explicit comparison after reload, preserved route/history,
acknowledgement without repeated prompts, and restarting an unapplied stale review.
The storage run includes quota failures, membership races and concurrent writers.
The initial failure is retained in the evidence. This changes candidate bytes:
earlier connected-feature results are historical until final qualification runs
against the frozen candidate.

## Qualification outcome and capacity correction

The [first frozen-candidate run](evidence/regular-candidate-qualification-initial.json)
completed with 15 of 16 distinct scenarios passing. Capacity reporting failed;
the candidate and source remained unchanged throughout the run. Two additional
requirement entries reference existing runs rather than separate tests.

A diagnostic reproduction showed a Settings race: a capacity error rebuilt the
home view during its pending startup check, invalidating the completion and leaving
“Checking…” visible. The fix keeps that view until startup completes. The
[capacity retry](evidence/regular-capacity-retry.json) passes, retaining all 257
local saves, exact queued changes, replica and identity. Its full journey-sharing
flow also passes. The fix changes candidate bytes, so the initial failed result
is retained and does not count as final qualification. Core tests separately
passed 68 JavaScript and 18 Python cases.

## Qualified package and deployment

The [second qualification](evidence/regular-v38-qualification.json) passes all
16 distinct scenarios (18 requirement entries), with unchanged source and
candidate hashes throughout. [Static-host checks](evidence/regular-v38-static.json)
also pass, including installability, accessibility, 200% zoom/320px reflow,
failed/successful data refresh, saved preferences and offline new-address routing.
Two adapter mismatches were corrected and retained in that evidence.

The [verified package](evidence/regular-v38-package.json), `along-web-v38.zip`, is
41,762,118 bytes. Every archived payload matches its release manifest, and all
candidate payloads except the non-serving do-not-publish marker are unchanged.
Qualification, source/licence notices and hosting/install instructions are included.
This package is not yet deployed; public-file and installed-update checks follow
deployment. Desktop measurements were collected while other checks were running
and do not establish phone performance.

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

## Historical pre-promotion checklist

- Package the qualified payloads without altering interface text. The connected
  guide is sourced from `CONNECTED_INSTALL.md`; its version-38 instructions are
  prepared in the candidate and do not establish that v38 is deployed.
- Freeze and qualify the final candidate after the older-copy compatibility fix.
  Reconcile the complete required check list with the exact final manifest; do not
  treat passing runs on previous bytes as final release qualification.
- Check existing-device cases and shared-generation old-tab behavior where
  applicable. The local pre-sharing old-tab and failed-update checks above pass;
  preview migration evidence is not proof of every regular-app upgrade.
- Complete the outstanding physical S23 pairing, installation and spoken
  screen-reader checks. Initial pairing is still an explicit exchange.
- Produce an immutable release package and verify its deployed bytes before
  describing version 38 as available.
