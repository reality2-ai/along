# Building the current Along app

Published Along is version **45**; see the [release record](RELEASE_V45.md).
The current checkout also contains an unqualified [removal-notice delivery prototype](../experiments/relay/REMOVAL_DELIVERY.md).
Use the pinned release source below or its ZIP to reproduce published v45; do not
publish a new build from HEAD under the existing version. Device Preview **3806** is a separate installation.
For use or hosting, take the [v45 release ZIP and checksum](https://github.com/reality2-ai/along/releases/tag/v0.45.0).
Serve the whole extracted package over HTTPS, including `experiments/` and `data/`.
The package needs no Along server. See [installation](INSTALL.md) and
[hosting](HOSTING.md). Course learners ask their AI assistant to perform all
commands, implementation and technical checks below; no human coding is required.

The historical v39 [default-command check](evidence/current-build-commands.json) verified that
`npm run build`, `npm run serve:built` and `npm run test:static` select and serve
the integrated app with prepared inputs. The default runtime path now selects the public-source bundle.

## Choose the right development path

| Path | What it produces |
| --- | --- |
| `npm start` / `python3 server.py` | Base planner development server |
| `npm run build:legacy` / `scripts/build_static.py` | Legacy static planner in `dist/`, without integrated device sharing |
| `npm run build` / `scripts/build_upgrade_candidate.py --runtime …` | Regular v45 candidate, including device groups, sharing and direct AT access |
| Published `along-web-v45.zip` | Qualified, immutable v45 distribution |

The integrated build currently combines `public/` with reachable modules under
`experiments/`; those modules are part of the release despite the directory name.
Do not deploy `public/` or `dist/` alone expecting the current connected app.

The regular installation guide combines `docs/CONNECTED_INSTALL.md` with
`docs/INSTALL_PLATFORMS.md`. Keep the expanded GitHub guide, `docs/INSTALL.md`,
in sync. Platform extraction does not depend on a heading in that expanded copy.

## Prepare inputs

Use Python **3.12+** for the integrated build/runtime tools, Node **22+** for tests,
and run `npm ci`. Browser checks need a compatible Chromium executable.
The published app source was commit
`d87ba62d716fdb783f3cc81071236055b59f95b2`; later commits include packaging and
documentation. Preserve the chosen source revision with each new build.

The builder requires `data/network.json.gz`, `streets.json.gz`, `addresses.json.gz`
and `routes.json.gz`. For the same release snapshot, copy those four files from
the verified v45 ZIP into `data/`. For a refreshed snapshot, follow the
[README import commands](../README.md#run-from-source) and [data guide](DATA.md).
Current upstream downloads will not reproduce historical dataset bytes. Importer
tests also need their documented database/source inputs; copying browser bundles
does not recreate those inputs.

The runtime can now be rebuilt from the approved public source in
[`vendor/r2-browser`](../vendor/r2-browser/README.md). The v40 release also includes
`along-r2-runtime-public-82377f1.zip` and its checksum: verify and extract it into
`releases/` to obtain the default build input. This developer bundle contains the
approved source subset, browser modules, WASM, licences and provenance.

To rebuild that bundle, follow the subset README with Rust 1.96.1,
`wasm32-unknown-unknown` and wasm-bindgen 0.2.126. The pinned public source is
`82377f117f99d84b000319ac04917a2420db0e84`; use `--workspace vendor/r2-browser`.
The builder runs twice in fresh directories and checks matching outputs.
[Anonymous public-source container verification](evidence/public-runtime-bundle.json)
passed, followed by the complete v40 browser qualification. This verifies the
runtime build in that Linux environment, not identical compilation on every platform.
No access to the private upstream R2 repository is needed.

## Build and inspect locally

```sh
npm run build
npm run serve:built
```

The default build uses `releases/along-r2-runtime-public-82377f1`. To use a verified
runtime at another path, invoke
`python3 scripts/build_upgrade_candidate.py --runtime /path/to/runtime` directly.

Open `http://localhost:3082` and check version 45. Localhost permits service
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
| `R2_HIVE_UPSTREAM` | Optional: an actual `r2.extended.v1` hive the local test relay pipes to |
| `ALONG_V37_ZIP` | Exact original v37 `along-web.zip` for installed-upgrade tests |

The v44 upgrade check also requires `releases/along-web-v44.zip`.
The v42 and v43 upgrade checks require `releases/along-web-v42.zip` and
`releases/along-web-v43.zip` from their corresponding GitHub releases. The v37
fixture defaults to `releases/along-web-v37.zip` (the release asset is named
`along-web.zip`); `ALONG_V37_ZIP` can override that path.

The connected-upgrade check also requires the exact published v38 ZIP at
`releases/along-web-v38.zip`; obtain it from the
[v38 release](https://github.com/reality2-ai/along/releases/tag/v0.38.0).
The latest upgrade check also needs `releases/along-web-v41.zip` from the
[v41 release](https://github.com/reality2-ai/along/releases/tag/v0.41.0).
The v40 upgrade check needs `releases/along-web-v40.zip` from the
[v40 release](https://github.com/reality2-ai/along/releases/tag/v0.40.0).
The previous-release upgrade check additionally needs `releases/along-web-v39.zip`
from the [v39 release](https://github.com/reality2-ai/along/releases/tag/v0.39.0).
The v37 asset is in the [v37 release](https://github.com/reality2-ai/along/releases/tag/v0.37.0).
Its SHA-256 must be `8dda7d208934d6f61494e67860ffe79dfbe7a3b51957e34fa9cbb99e28abf4e9`.
The v45 qualification uses the current `r2.extended.v1` local hive stand-in;
its [35-scenario result](evidence/regular-v45-qualification.json) is not deployed
hive acceptance. The runner writes individual
logs and `qualification.json` to a new directory under `releases/`; it refuses
an existing run directory. Do not reuse old qualification evidence for changed files.

`scripts/prepare_regular_release.py /path/to/qualification.json` packages a passed,
matching candidate. It refuses existing versioned release outputs. These scripts
currently target version 45. The [v45 package](RELEASE_V45.md) has passed
qualification and is published. Never overwrite a versioned archive.
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

The [v45 release record](RELEASE_V45.md) binds the published v45 candidate, qualification,
package and public checks. The following v38 source-rebuild evidence is historical;
its pinned check intentionally compares with v38, so running it with current
`--revision HEAD` now reports differences from that historical version.


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
The public runtime has since been rebuilt in an isolated container with publicly
downloaded tools and dependencies. A separate [isolated app rebuild](evidence/regular-v45-public-source-rebuild.json)
now reproduces all 309 v45 application files from anonymous public source and
verified release downloads. It uses the published runtime bundle; runtime source
compilation is evidenced separately.

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


## Repeat the isolated public v45 app build

This release check uses no local app source, data, browser profile or
credentials. It fetches the pinned public v45 commit, v45 data and public v40 runtime assets, verifies archive
hashes, runs the integrated builder and compares every application file with the
release. Packaging README, qualification and build manifests are outside the
application comparison. It does not refresh AT data or run physical-device checks.
Ask the AI to run this with Podman and a new output directory:

```sh
mkdir releases/public-v45-rebuild-check
podman run --rm --memory 2g --cpus 2 \
  -v "$PWD/scripts/check_public_release_build.py:/input/check.py:ro" \
  -v "$PWD/releases/public-v45-rebuild-check:/output:rw" \
  docker.io/library/python:3.13-bookworm python3 /input/check.py --version 45
```

The output is `result.json`; a mismatch fails the command. The recorded image ID
and script/log hashes are in the evidence. This is a Linux container reproduction,
not a claim that compiler outputs match on every host platform.
