# Along version 39

Version 39 renews optional relay sessions after a locally received membership
change. Still-permitted devices can reconnect and continue sharing saved journeys
without manually restarting the relay connection. Queued frames from the old
session are discarded and the signed discovery announcement is refreshed.

The relay remains optional and user-selected. Removal, group-key and checkpoint
updates still require explicit transfer; this change renews connections after
receipt. It does not make all trust-group state synchronize automatically.

## Release evidence

- App source: `a7079d3e6c91f4412639b2eff23d5a342672dfbb`.
- [Qualification](evidence/regular-v39-qualification.json): 18 distinct scenarios
  pass against the unchanged candidate, including both installed v37 and v38
  upgrades. The v38 check retains an existing device identity; both upgrade
  checks retain saved places, service preferences and local choices through a
  failed shell download, successful retry and offline reopening.
- [Relay regression](evidence/relay-membership-reconnect.json): original code
  times out; corrected source renews after a valid signed removal for an
  unrelated subject and shares a further journey. Qualification binds the
  changed service to the candidate bytes and uses the actual relay on loopback.
- [Static check](evidence/regular-v39-static.json): installability, keyboard,
  automated accessibility, zoom, narrow layout, offline address routing,
  saved service preferences, failed/successful data refresh and offline help.
- [Package](evidence/regular-v39-package.json): every archived payload matches
  the release manifest and the qualified candidate. ZIP: 41,762,484 bytes;
  SHA-256 `9c4dee55974beecc58bef97310e5c9ee7dd3cd343d0820a973a54a7371363e18`.
- [Public files](evidence/regular-v39-public-files.json) and
  [fresh public browser](evidence/regular-v39-public-browser.json) record the
  post-deployment checks. Pages commit:
  `299de85384bdaf71393e7964650032f6aff4b79d`;
  [deployment job](https://github.com/reality2-ai/along/actions/runs/36052023499).

The Device Preview and pairing-lab deployments remain separate and unchanged.
Read [Building Along](BUILDING.md) before rebuilding: the base planner's
`npm run build` does not produce the integrated release.

## Install and remaining checks

Open [Along](https://reality2.ai/along/) or download the
[v39 release](https://github.com/reality2-ai/along/releases/tag/v0.39.0).
Existing installations can use [Update Along](https://reality2.ai/along/update.html).
Confirm version 39 in Settings on each device; preserve saved places and setup.

Follow the [short S23/desktop check](DEVICE_CHECK.md). Physical pairing, installed
updates and TalkBack acceptance remain open, as does verification of an external
user-selected relay. Local synthetic-key checks do not establish current AT
availability. Feedback's signed-in GitHub submission step also remains untested.
This is an experimental AI-coding course app used at your own risk, not an
AT service or a claim of production readiness.
