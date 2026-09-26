# Along version 45 — in verification, not published

The installation guide now follows **Settings → My devices**, explains the
one-invitation connection and separates journey-sharing consent from AT-key
access. It also explains using a personal AT key without a second device or
relay. Outdated version text and manual return-message instructions are removed.
The GitHub installation guide uses the same content and platform instructions.

[Payload comparison](evidence/regular-v45-change-scope.json) against published
v44 finds only the two installation documents and three version/cache markers
changed. Runtime, routing, data and cryptographic modules are byte-identical.
Version 44 remains published; do not treat this candidate as released.

## Verification in progress

The [initial qualification](evidence/regular-v45-initial-aborted.json) was stopped
after confirming obsolete test assertions for the old guide heading and version.
Its completed results are preserved; it is not a passing qualification. Corrected
tests retain the upgrade/storage checks and verify the new heading.

A separate [static check](evidence/regular-v45-initial-static.json) timed out after
five seconds waiting for offline address readiness on reload. It was running
alongside qualification. The [serial recheck](evidence/regular-v45-static.json) passed against unchanged
app bytes and with the same timeout. The cause has not been established;
concurrent execution is only a possible explanation. Offline routing, update
failures, keyboard, automated accessibility, zoom and reflow checks passed.

The selected public hive's protected-message forwarding, physical S23 pairing,
TalkBack and signed-in interactive feedback acceptance remain open. No change in
this guide establishes those outcomes. Along is an experimental course app; use
at your own risk.
