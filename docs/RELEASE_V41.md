# Along version 41

Use **Manage shortcuts → Remove shortcut** on the home screen to remove a saved
or learned shortcut. This clears that pair's saved services and local learning
history while preserving other journeys. Searching those places again can create
a new suggestion. Removing only **Preferred services** inside a journey keeps the
saved places; the help now explains this difference.

Management stays collapsed until needed. Buttons span their available width,
identify the places being removed, and restore keyboard focus afterwards. A failed
storage write retains the shortcut and reports the failure. Saved-place changes
use the existing optional sharing journal; this does not clear another device's
private learning history.

## Evidence

- Source: `a174e060d3ad6e6c3f38f235cdc5138fde57e0a2`.
- [Qualification](evidence/regular-v41-qualification.json): 20 distinct scenarios
  passed against unchanged source and candidate, including installed upgrades
  from v37, v38, v39 and v40, sharing, key handling, recovery and actual relay on loopback.
- [Static browser checks](evidence/regular-v41-static.json): offline routing,
  service-only removal, complete shortcut removal after repeated searches,
  unrelated journey retention, failed writes, keyboard focus, axe, zoom and narrow layout.
- [Package](evidence/regular-v41-package.json): ZIP 41,716,842 bytes;
  SHA-256 `32cba1e89e2cdba1a17eda405876d2ed03fa5d77fd3f76c0f72645f5c19b877a`.
- [Public files](evidence/regular-v41-public-files.json) and
  [fresh public-browser check](evidence/regular-v41-public-browser.json) cover the deployed package.
- Pages commit `9560625eec17bb854d19119d0c5c2b5d50544f4c`;
  [deployment](https://github.com/reality2-ai/along/actions/runs/36059071872).

The first static regression failed because the existing preference reader
normalizes an absent route preference to `null`. The assertion now compares that
normalized value while retaining an exact unchanged-data check for a failed write.
No application change was needed for that test correction.

## Install and next checks

Open [Along](https://reality2.ai/along/), [update an installed copy](https://reality2.ai/along/update.html),
or download the [v41 release](https://github.com/reality2-ai/along/releases/tag/v0.41.0).
Confirm version 41 in Settings, then follow the [device check](DEVICE_CHECK.md).
Physical shortcut-removal acceptance, pairing and TalkBack remain unverified.

The user has assigned relay setup to their server's AI. No server was changed and
no relay is selected by default. **Arrive by** is a newly requested, pending timing
option; this version still plans using **Leave at**. Feedback's signed-in GitHub
submission step remains an acceptance check. See [Building Along](BUILDING.md)
for the public runtime and isolated v40 reproduction evidence; those historical
byte comparisons are not claimed as reproduction of v41.

Experimental AI-coding course app, used at your own risk; not an official AT service.
