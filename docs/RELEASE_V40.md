# Along version 40

Version 40 uses a browser runtime rebuilt from the approved public R2 source
subset included in Along. Others can now rebuild it without access to the private
upstream repository. The release also includes a developer runtime bundle and
checksum. The app remains offline-first; AT access and device sharing are optional.

## Evidence

- App source: `1c4ac0fefb32e373b22dcb80f709ee22972ba7c0`.
- Runtime source: public Along commit `82377f117f99d84b000319ac04917a2420db0e84`,
  limited to `vendor/r2-browser`. [Two isolated builds](evidence/public-runtime-bundle.json)
  from an anonymous checkout produced matching outputs.
- [Qualification](evidence/regular-v40-qualification.json): 19 distinct scenarios
  passed against unchanged source and candidate, including installed upgrades
  from v37, v38 and v39, saved-data/identity retention, synthetic credentials,
  sharing, recovery, group removal and actual relay reconnection on loopback.
- [Static browser checks](evidence/regular-v40-static.json): offline address routing,
  data refresh, installation, keyboard, automated accessibility, zoom and narrow layout.
- [Package verification](evidence/regular-v40-package.json): 285 payloads;
  ZIP SHA-256 `cae169ada5b168908127e9e089ebae8f7072a5c694ddbb12e041c958c304095f`.
- [Public-file checks](evidence/regular-v40-public-files.json): all 286 files,
  including the manifest, match the release. [Fresh public-browser checks](evidence/regular-v40-public-browser.json)
  passed device setup, offline reopening, new-address mixed-mode routing and help.
- Pages commit `e73e3f681dd1650fd01848648c7fdf4067f6a730`;
  [successful deployment](https://github.com/reality2-ai/along/actions/runs/36056875278).

The [initial qualification](evidence/regular-v40-qualification-initial.json) failed
one upgrade assertion: an old worker could recreate an empty cache name after its
payloads were deleted. The corrected check verifies the actual v40 controlling
worker and absence of old cached payloads. The [diagnostic](evidence/v40-upgrade-cache-check.json)
and complete rerun are retained. Application payloads did not change between runs.

## Use and limits

Open [Along](https://reality2.ai/along/), [update an installed copy](https://reality2.ai/along/update.html),
or download the [v40 release](https://github.com/reality2-ai/along/releases/tag/v0.40.0).
See [Building Along](BUILDING.md) for public-source reproduction and hosting.
Preview and pairing-lab installations remain separate and unchanged.

Physical S23 pairing, current installed-device checks, Android TalkBack and an
external user-selected relay remain unverified. The reported QR timeout has not
been demonstrated fixed on that phone. Security updates still require explicit
transfer; relay reconnection does not imply automatic propagation of all group
state. No default relay is selected. Browser software custody is not hardware-rooted
R2 conformance or protection against malicious same-origin scripts.

Feedback's signed-in GitHub submission step remains an acceptance check. A full
app build in the isolated runtime-build environment is separate from the completed
runtime rehearsal and host-side app qualification. This remains an experimental
AI-coding course app, used at your own risk, not an official AT service.
