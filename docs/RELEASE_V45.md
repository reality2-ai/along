# Along version 45 — published

The installation guide now follows **Settings → My devices**, explains the
one-invitation connection and separates journey-sharing consent from AT-key
access. It also explains using a personal AT key without a second device or
relay. Outdated version text and manual return-message instructions are removed.
The GitHub installation guide uses the same content and platform instructions.

[Payload comparison](evidence/regular-v45-change-scope.json) against published
v44 finds only the two installation documents and three version/cache markers
changed. Runtime, routing, data and cryptographic modules are byte-identical.
Version 45 is published at <https://reality2.ai/along/> with a
[downloadable ZIP and checksum](https://github.com/reality2-ai/along/releases/tag/v0.45.0).

## Release evidence

Source: `d87ba62d716fdb783f3cc81071236055b59f95b2`.
[Qualification](evidence/regular-v45-qualification.json) passed all 35 distinct
scenarios and two labelled aliases, with source and candidate unchanged. The
membership reconnect test recorded 1,516 frames across eight connections with
zero rate-limited drops.

The [package](evidence/regular-v45-package.json) contains 311 payload files plus
its manifest. ZIP entries match the release files. The
[local source rebuild](evidence/regular-v45-local-source-rebuild.json) reproduces
all 310 candidate files. The [anonymous public-source container rebuild](evidence/regular-v45-public-source-rebuild.json)
reproduces all 309 application payloads using public data and a verified prebuilt
runtime; this is not a compiler reproducibility or fresh upstream-data claim.

[HTTPS verification](evidence/regular-v45-public-files.json) compares all 312
served files with the package. Pages run `36205684346` deployed
`66cce0b3daaeb2f173f1af9a0c2d0d0b9a399566`.
[Public browser checks](evidence/regular-v45-public-browser.json) pass installation
readiness, version 45, offline reload and a new address journey, the offline
installation guide, English-only controls and retained offline feedback, with no
page errors.

Use the [v45 device guide](DEVICE_CHECK_V45.md) for remaining observations; wait
for verified hive forwarding before retrying pairing.

## Verification history

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


The [next run](evidence/regular-v45-duplicate-guide-aborted.json) found a real
content-build defect: duplicate connection sections. The platform extractor
silently included the rest of the expanded guide after its former ending heading
was removed. It now reads a dedicated platform source and requires exactly one
insertion marker. The generated guide has unique headings, all nine platform
sections, and matches the GitHub guide. Previous static evidence describes the
earlier candidate; the repaired-candidate results below supersede it for release acceptance.


The [focused v44-to-v45 upgrade check](evidence/regular-v45-fixed-guide-upgrade.json)
now passes with the repaired guide. Failed shell downloads preserve the previous
app, retry preserves saved choices and device identity, and the offline guide
fits 320px, passes automated accessibility checks and supports keyboard Back.
The only changed release payloads remain the two guide files and three version
markers. Full qualification subsequently passed.


[Static checks of the repaired candidate](evidence/regular-v45-fixed-guide-static.json)
also pass: subpath installation readiness, offline new-address routing and saved
choices, failed/successful refresh, keyboard and accessibility automation, contrast,
200% zoom and 320px reflow. The original five-second reload assertions remain.
