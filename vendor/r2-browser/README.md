# R2 browser source subset for Along

This is the source for the ten local R2 packages used by Along's browser runtime,
under the owner-approved [MIT scope](R2-SCOPE.md) and [licence](R2-MIT.txt).
It is a standalone Cargo workspace, extracted from upstream commit
`1b9229ad6d8483ba43cb66a53e14d336b0c6e091`. It requires no private Git repository.

[source-provenance.json](source-provenance.json) records each original file hash
and the packaging changes. Rust sources, package manifests and browser modules
are unchanged. The workspace retains only the approved packages and inherited
dependencies, preserves the release profile, and removes unrelated patches.
The lockfile retains original package versions, sources and checksums.

The source includes embedded tests, but excludes private standard documents and
full-workspace fixtures referenced by some tests. This package supports building
the WASM runtime; it is not a standalone copy of the full R2 conformance suite.
Along implements a browser software-storage subset, without hardware-rooted
sealing or protection from malicious same-origin scripts.

## Build status

Two builds in fresh directories inside a rootless Linux container produce
identical WASM and JavaScript outputs. The JavaScript interface matches the v39
runtime. The WASM differs, including embedded build paths and tool metadata;
the rebuilt runtime subsequently passed all 19 v40 qualification scenarios.
See the [v40 release evidence](../../docs/RELEASE_V40.md). Changed runtime bytes
require fresh qualification, rather than inheriting an earlier release result.

## Rebuild from committed Along source

Install Rust 1.96.1 with the `wasm32-unknown-unknown` target and Rust documentation,
and install `wasm-bindgen-cli` 0.2.126 with `--locked`. From this directory run
`cargo +1.96.1 fetch --locked` to prepare registry dependencies. Fetch the whole
locked subset: a target-only fetch omitted a needed host dependency in testing.

From Along's repository root, use:

```sh
python3 scripts/build_r2_runtime.py \
  --repo . --revision HEAD --workspace vendor/r2-browser \
  --toolchain 1.96.1 --bindgen /path/to/wasm-bindgen \
  --output releases/along-r2-subset-runtime
```

The builder reads committed files, creates two fresh builds, and retains matching
outputs, source, licence notices and provenance. The output directory must be new.
The [complete runtime-bundle rehearsal](../../docs/evidence/public-runtime-bundle.json)
also passes from an anonymous public checkout in a rootless container. The
qualified v40 release uses this public-source runtime.
Use [Along's build guide](../../docs/BUILDING.md) for app qualification and release
instructions. Course learners ask the AI to perform these technical steps.
