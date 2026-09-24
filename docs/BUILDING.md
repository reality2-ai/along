# Building the current Along app

Regular Along is version **39**. Device Preview **3806** is a separate installation.
For use or hosting, take the [v39 release ZIP and checksum](https://github.com/reality2-ai/along/releases/tag/v0.39.0).
Serve the whole extracted package over HTTPS, including `experiments/` and `data/`.
The package needs no Along server. See [installation](INSTALL.md) and
[hosting](HOSTING.md). Course learners ask their AI assistant to perform all
commands, implementation and technical checks below; no human coding is required.

The [default-command check](evidence/current-build-commands.json) verifies that
`npm run build`, `npm run serve:built` and `npm run test:static` select and serve
the current app with prepared inputs.

## Choose the right development path

| Path | What it produces |
| --- | --- |
| `npm start` / `python3 server.py` | Base planner development server |
| `npm run build:legacy` / `scripts/build_static.py` | Legacy static planner in `dist/`, without integrated device sharing |
| `npm run build` / `scripts/build_upgrade_candidate.py --runtime …` | Current regular v39 candidate, including device groups, sharing and direct AT access |
| Published `along-web-v39.zip` | Qualified, immutable v39 distribution |

The integrated build currently combines `public/` with reachable modules under
`experiments/`; those modules are part of the release despite the directory name.
Do not deploy `public/` or `dist/` alone expecting the current connected app.

## Prepare inputs

Use Python **3.12+** for the integrated build/runtime tools, Node **22+** for tests,
and run `npm ci`. Browser checks need a compatible Chromium executable.
The published app source was commit
`a7079d3e6c91f4412639b2eff23d5a342672dfbb`; later commits include packaging and
documentation. Preserve the chosen source revision with each new build.

The builder requires `data/network.json.gz`, `streets.json.gz`, `addresses.json.gz`
and `routes.json.gz`. For the same release snapshot, copy those four files from
the verified v39 ZIP into `data/`. For a refreshed snapshot, follow the
[README import commands](../README.md#run-from-source) and [data guide](DATA.md).
Current upstream downloads will not reproduce historical dataset bytes. Importer
tests also need their documented database/source inputs; copying browser bundles
does not recreate those inputs.

**Public runtime-source work:** the upstream repository is private. The
[clean-container attempt](evidence/container-rebuild-source-gap.json) exposed that
gap. The approved [standalone source subset](../vendor/r2-browser/README.md) is now
included here. Its [two isolated builds](evidence/r2-source-subset-build.json)
match each other; their WASM differs from v39's, so the complete runtime-bundle
and browser checks remain pending. This is not yet a replacement for the
qualified v39 runtime. The published app ZIP remains installable and hostable.

The historical procedure below needs upstream repository access. The public
subset README provides the new build path and its current verification status.

Build the pinned browser runtime using [the recorded runtime procedure](PAIRING_LICENSE_AUDIT.md#recorded-runtime-rebuild-24-september-2026).
Its source is [reality2-ai/r2-standard](https://github.com/reality2-ai/r2-standard),
commit `1b9229ad6d8483ba43cb66a53e14d336b0c6e091` (the `along-browser-tg` work).
The recorded tools are Rust 1.96.1, target `wasm32-unknown-unknown`, and
wasm-bindgen 0.2.126. Install the tools and fetch locked Cargo dependencies before
running the offline builder. It builds twice in fresh directories and verifies
matching outputs, retaining source, licence notices and provenance in
`releases/along-r2-runtime-1b9229ad`. This is a same-host reproducibility check,
not a demonstrated cross-platform compiler reproduction. The web ZIP includes
selected runtime files and provenance, not the complete rebuild input bundle.

## Build and inspect locally

```sh
npm run build
npm run serve:built
```

The default build uses `releases/along-r2-runtime-1b9229ad`. To use a verified
runtime at another path, invoke
`python3 scripts/build_upgrade_candidate.py --runtime /path/to/runtime` directly.

Open `http://localhost:3082` and check version 39. Localhost permits service
workers; phones need an HTTPS host. Keep this development origin separate from
your regular installed app. Generated outputs stay in ignored `releases/`.
The candidate retains `DO-NOT-PUBLISH.txt`: building is not qualification.
No AT key is needed to build or run scheduled planning. Use synthetic keys for
automated checks; never add personal credentials to public assets or test output.

## Qualification and packaging

`npm test` and `npm run test:browser` cover the base planner. They do not alone
qualify the integrated app. Commit the intended source, build the candidate and
keep both unchanged while running `scripts/qualify_regular_candidate.py`.
The runner requires these environment variables:

| Variable | Input |
| --- | --- |
| `CHROMIUM_PATH` | Absolute path to the test browser executable |
| `R2_WASM_DIR` | Verified runtime bundle's `wasm/` directory |
| `R2_BROWSER_DIR` | Verified runtime bundle's `browser/` directory |
| `R2_RELAY_BINARY` | Built actual R2 relay executable; tests start it on loopback |
| `ALONG_V37_ZIP` | Exact original v37 `along-web.zip` for installed-upgrade tests |

The connected-upgrade check also requires the exact published v38 ZIP at
`releases/along-web-v38.zip`; obtain it from the
[v38 release](https://github.com/reality2-ai/along/releases/tag/v0.38.0).
The v37 asset is in the [v37 release](https://github.com/reality2-ai/along/releases/tag/v0.37.0).
Its SHA-256 must be `8dda7d208934d6f61494e67860ffe79dfbe7a3b51957e34fa9cbb99e28abf4e9`.
The relay used for qualification is recorded in
[actual relay evidence](evidence/actual-r2-relay.json). The runner writes individual
logs and `qualification.json` to a new directory under `releases/`; it refuses
an existing run directory. Do not reuse old qualification evidence for changed files.

`scripts/prepare_regular_release.py /path/to/qualification.json` packages a passed,
matching candidate. It refuses existing versioned release outputs. These scripts
currently target version 39; a new app release needs a deliberate version change
and fresh qualification, rather than overwriting the published v39 archive.
Run the committed static browser check against the same candidate:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:static
```

This verifies the candidate manifest's file hashes before testing installability,
keyboard/accessible names, contrast, 200% zoom, 320px reflow, offline new-address
routing, saved service preferences and failed/successful timetable refresh.
Screenshots and measurements use `test-results/regular-candidate-*`. Use
`npm run test:static:legacy` for the legacy `dist/` build. Direct test invocation
with `REGULAR_CANDIDATE=1` remains supported.
Deployed-file verification and physical acceptance are additional checks in the
[release record](REGULAR_UPGRADE.md) and [release checklist](RELEASE_CHECKLIST.md).

## What has and has not been reproduced

The [v39 release record](RELEASE_V39.md) binds the current candidate, qualification,
package and public checks. The following v38 source-rebuild evidence is historical;
its pinned check intentionally compares with v38, so running it with current
`--revision HEAD` now reports the intentional v39 differences.


The [v38 qualification](evidence/regular-v38-qualification.json),
[package record](evidence/regular-v38-package.json), and
[public-file verification](evidence/regular-v38-public-files.json) bind the tested
candidate to the published payloads. A separate fresh public-site browser check
covers setup and offline routing. The regular [device check](DEVICE_CHECK.md)
still needs physical pairing and spoken-screen-reader observations. No external
relay endpoint has been accepted. A [fresh export of the release source](evidence/regular-v38-source-rebuild.json)
and [source at 3738a5e](evidence/regular-v38-current-source-rebuild.json)
each rebuilt all **301 application files byte for byte** against the published ZIP.
Both used the release data and existing verified runtime on the same host.
A complete clean-machine toolchain/dependency rehearsal remains outstanding.

To repeat that scoped check without changing the working tree or live app:

```sh
python3 scripts/check_regular_rebuild.py \
  --archive releases/along-web-v38.zip \
  --runtime releases/along-r2-runtime-1b9229ad \
  --output releases/v38-source-rebuild.json
```

The default revision is the published app source; `--revision HEAD` checks the
current committed source instead. The check exports committed files into a
fresh temporary directory, verifies the exact published ZIP, takes its four data
bundles, runs the real builder and compares complete application file sets and
bytes. Release README, qualification evidence and the release manifest are
packaging metadata outside that comparison. The output evidence file must be new.
A mismatch after an intentional app change is expected: qualify a new release
instead of changing this check to call different bytes identical.
