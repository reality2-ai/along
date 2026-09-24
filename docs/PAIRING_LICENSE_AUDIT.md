# Pairing runtime distribution audit

Status: the runtime has now been rebuilt twice from committed source with matching
outputs, recorded compiler tools and bundled notices. The standalone device-test
lab has been reviewed and published; physical-device acceptance and the full
experimental journey-app release remain outstanding. The project
owner has selected MIT, matching Along, for the R2 subset used
in Along. The scoped distribution grant is now included as
[MIT text](licenses/R2-MIT.txt) and an [explicit scope](licenses/R2-SCOPE.md).
It does not relicense dependencies or the wider R2 standard.

## Public source availability (25 September 2026)

The linked R2 repository is private. An anonymous clean-container fetch fails;
the [recorded attempt](evidence/container-rebuild-source-gap.json) does not complete
a runtime build. Existing same-host rebuild evidence remains valid in its stated
scope, but does not establish public access to the necessary source. Preparing
a public bundle is limited to the ten packages and browser modules covered by
[R2-SCOPE.md](licenses/R2-SCOPE.md); it does not authorize publishing the whole
private repository or standard.

The [standalone approved subset](../vendor/r2-browser/README.md) now contains the
unchanged source files and a pruned workspace/lockfile. [Two container builds](evidence/r2-source-subset-build.json)
match each other. The generated WASM differs from the currently released runtime;
full bundle/browser qualification is pending. The original private repository
and its standard documents have not been included in this source distribution.

## Recorded runtime rebuild (24 September 2026)

[`build_r2_runtime.py`](../scripts/build_r2_runtime.py) exports the committed Rust
workspace at `1b9229ad6d8483ba43cb66a53e14d336b0c6e091` with `git archive` and builds
it in two fresh source/target directories. Working-tree edits, including the
uncommitted metadata draft discussed below, are excluded. Both builds produced
identical WASM, JavaScript and TypeScript declaration files. This is measured
same-host reproducibility, not cross-host verification or a new R2 conformance gate.

The [build record](evidence/r2-runtime-provenance.json) includes source/archive and
lockfile hashes, rustc/cargo/wasm-bindgen versions and executable hashes, commands,
and the complete runtime/browser/notice file set. Rust 1.96.1 and wasm-bindgen
0.2.126 produced the recorded build. The release compiler is used without a
separate wasm-opt pass. The WASM is 205,987 bytes, SHA-256
`0451e925bae4ff2deebd22d640004dd505c45db2f0db61cb8d457bc626ee50c7`.
The compiler's own standard-library notices are collected from that same sysroot.

Both static builders accept `--runtime` and verify all recorded bundle files
before selecting the runtime, browser modules and notices. They include
`runtime-provenance.json` in their output manifests. This detects changes relative
to the build record; the record is not a signature or independent compiler audit.
Tests reject changed or missing source/runtime/browser/notice files, symbolic
links and unrecorded files. The original cache history below remains historical
evidence, not the source of the new distribution binary.

With cached Cargo dependencies and the Rust wasm32 target installed:

```sh
python3 scripts/build_r2_runtime.py \
  --repo /path/to/r2-standard \
  --revision 1b9229ad6d8483ba43cb66a53e14d336b0c6e091 \
  --toolchain 1.96.1 \
  --bindgen /path/to/wasm-bindgen-0.2.126 \
  --output releases/along-r2-runtime-1b9229ad
python3 scripts/build_pairing_lab.py --runtime releases/along-r2-runtime-1b9229ad
python3 scripts/build_experimental_app.py --runtime releases/along-r2-runtime-1b9229ad
```

The output directory must be new. The observed machine used its `stable` alias,
which resolved to the exact compiler recorded above; the example pins the version
for subsequent builds. The offline/locked build neither upgrades dependencies nor
installs tools. The source archive stays in the local runtime bundle; web builds
include the build record, selected runtime files and notices, not that archive.

## Owner direction (24 September 2026)

In response to the question about which R2 licence to use, the owner instructed:
“make it the same as along as we are only using a part of the r2 standard”.
Along’s [licence](../LICENSE) is MIT. Record this as the selected licence for the
R2 subset included in Along, not a change to all R2 repositories or the standard.
The earlier request for a licence choice is answered.

Preserve original copyright attribution and third-party licence texts. The scope
of included code must be documented in the source and distribution notices; using
only a subset is not itself permission to change third-party terms. The historical
conflict below remains provenance to reconcile in that source work, rather than
an unanswered product decision. The existing Along MIT file already covers its
original integration code; no replacement licence is needed for that code.

## Evidence inspected

The [machine-readable inventory](evidence/pairing-license-inventory.json) records
56 packages in the resolved non-development dependency closure of `hive-wasm`
for `wasm32-unknown-unknown`. It includes build/proc-macro dependencies and can be
broader than the code retained in the optimized binary. It is not a symbol-level
inventory or a legal opinion.

Runtime source revision:
[`1b9229ad`](https://github.com/reality2-ai/r2-standard/commit/1b9229ad6d8483ba43cb66a53e14d336b0c6e091).
The cached WASM was built at the recorded initial-persona increment
[`407a78d5`](https://github.com/reality2-ai/r2-standard/commit/407a78d5673c858b74c2f6735112ae27cfcada7c).
The diff from that revision to the inspected runtime head changes only browser
storage code/tests, its README and RESUME; no Rust sources or lockfile changed.
The cache build log also explicitly reports missing package LICENSE files.

| Artifact | SHA-256 |
| --- | --- |
| Runtime Cargo.lock | `364994b61bd9b196ed2e72eec334052eae1e2328fc6c3e3ecaceb018337545ef` |
| hive_wasm_bg.wasm | `ad4b70ea7f1ff48794ef1aa8d6d831a6ae3838b892f4244d888fc4071f71def7` |
| hive_wasm.js | `e965f6f3edc1ac62a84a5221f7b083e9c416994fc36c7e0bf418395ea488cd33` |

The inventory preserves registry-package licence declarations and hashes of found
licence/copyright/notice files, including BSD and Unicode notices alongside MIT
and Apache declarations. The collector now copies these texts into both experimental build bundles,
alongside a manifest checked by each builder. Inventory hashes alone would not
be redistributed licence texts.

## Conflicting source declaration

The older `r2-core` history contains commit
`e5bc8d7efda7954f931587a08b57c7ac28b8472f`, dated June 2026, explicitly adopting
PolyForm Noncommercial and describing it as superseding the earlier whole-stack
MIT/Apache licence. That checkout still retains MIT/Apache files alongside its
`LICENSE.md` and `NOTICE`. The matching legacy MIT texts therefore cannot simply
be copied and treated as resolving the current runtime's licensing conflict.

Current R2-standard Cargo manifests retain MIT or MIT/Apache declarations, and
the identifier extraction source also used those declarations. The owner has
now selected MIT for the subset included in Along. The proposed
`r2-ident` metadata repair remains uncommitted and still reflects the historical
dual declaration. Align the scoped source notices with the new direction before
distribution; preserve dependency terms and existing ownership attribution.

The collector preserves 89 existing dependency notice files verbatim, adds the
scoped R2 MIT grant and Along's MIT notice, and accepts `--rust-doc` for the
compiler's standard-library copyright document and licence texts. This includes
notices for other Rust targets; it is not a claim that all those components are
in the WASM binary. A generated `notice-manifest.json` hashes every collected
file. Both experimental builders require that collection and verify its exact
file set and bytes before copying it into `runtime-notices/` in the output.

The earlier collection used here included the installed stable toolchain's library
notices. The cached WASM's build log does not identify its exact rustc version;
a rebuild was therefore required. The recorded rebuild above replaces that
uncertain binary/compiler association. Upstream metadata gaps remain visible
in the inventory; they are not silently rewritten by the Along collector.

## Gaps and source history

Ten local R2 packages have no package-level licence/notice files in this checkout.
Nine declare MIT or MIT/Apache-2.0 in their Cargo metadata. `r2-ident` declares
neither `license` nor `license-file`. The repository root also contains no general
LICENSE file, and GitHub's repository metadata reports no detected licence.
Do not infer the whole repository's licence from one crate or from its public
visibility.

There is a concrete history to follow for `r2-ident`: the
[extraction commit](https://github.com/reality2-ai/r2-standard/commit/e8faa228793534479dae0192bb1491a0fdd4526a)
moves `HiveId` out of `r2-mesh`. At that revision, the source crate's
[manifest](https://github.com/reality2-ai/r2-standard/blob/e8faa228793534479dae0192bb1491a0fdd4526a/implementations/rust/crates/r2-mesh/Cargo.toml)
explicitly retains `MIT OR Apache-2.0`. That is source provenance to use when
repairing the missing declaration, not evidence that today's missing notices have
already been repaired. Preserve existing declarations and copyright attribution;
do not invent a new owner or silently relicense framework material.

The standalone distribution is now available with the
[device-check guide](PAIRING_DEVICE_CHECK.md). The full experimental journey app
remains local while its release checks continue.

## Reproduce the inventory

In the experimental R2 Rust workspace:

```sh
cargo metadata --locked --offline --format-version 1 --filter-platform wasm32-unknown-unknown > /tmp/along-wasm-metadata.json
```

In Along:

```sh
python3 scripts/audit_pairing_licenses.py /tmp/along-wasm-metadata.json
python3 scripts/audit_pairing_licenses.py /tmp/along-wasm-metadata.json --collect --rust-doc "$(rustc +stable --print sysroot)/share/doc/rust"
```

The script follows only non-development edges from `hive-wasm`, reports missing
declarations/texts, and omits local filesystem paths from its output. It preserves package files and separately includes the owner-approved scoped
grant; it does not rewrite upstream declarations. Review the source revision,
lockfile and built binary together when regenerating the evidence.


## Draft metadata verification

The full R2 `cargo xtask verify` run reported **verify green — check, layering,
conform, docs** against HEAD `1b9229ad6d8483ba43cb66a53e14d336b0c6e091` with only
the proposed `r2-ident/Cargo.toml` declaration draft (SHA-256
`ba8204d6bfea7b75310d6288f1543d8cb6cc8c4d3ee78aa5dddcf3b738d38187`).
The terminal process and unchanged snapshot were checked. The initial attempt
ran out of `/tmp` space; the completed retry used a dedicated temporary directory
on the larger filesystem. No hardware was flashed.

This is technical verification of the draft metadata, not a determination of the
applicable licence. The declaration remains uncommitted. The owner has since
selected MIT for the subset used in Along. The later recorded rebuild above uses
committed source without this metadata draft. This earlier gate does not verify
later distribution edits.


## Notice packaging verification

The collection was included in rebuilt standalone-lab and full-app experimental
bundles. Every payload hash in each build manifest matched the output. Packaging
tests preserve byte-for-byte attribution and reject missing, changed or unexpected
notice files before creating an output directory. The browser lab test still
completed real WebRTC enrollment, reload/restore and isolated reset. The full-app
test still completed address-to-address planning, mocked contextual AT reads,
offline reopening and quiet fallback; startup timeout and unreadable-storage
checks also passed. These checks establish packaging and behavioral regression
evidence, not real-provider or physical-device acceptance.

The same lab and full-app checks subsequently passed using the recorded runtime
rebuild, including the real cached Back-navigation check. The two-app run also
passed lost-confirmation recovery, shared-key contextual mocked reads, removal
before further provider I/O and offline reopening. All inputs came from the
verified runtime bundle. These results retain the same one-host, synthetic-key
and mocked-provider limits.

## Published standalone device-test build

[Lab build 5dd96dcabf9a](https://reality2.ai/along/pairing-lab/) was published at
site-preview commit `32eeb00f8dc61849db13077ba6d7fe1d35ae836c`, from Along source
`9cc411b`. Its 170 payload files total 1,635,003 bytes (excluding build-info.json).
The exact file-set and hashes were checked locally and against every deployed
file. No credential files, test fixtures, journey datasets or source archive are
included. Dependency notices retain their original bytes, including original
whitespace and line endings; they were not reformatted to satisfy diff whitespace
warnings.

The local browser check runs under `/along/pairing-lab/` and includes actual
WebRTC enrollment, saved-key restoration, isolated reset and a genuine cached
Back return. The deployed HTTPS smoke check creates and restores an identity in
an ephemeral browser profile, with no external-provider requests. It is not a
phone-to-desktop pairing result. The existing version-37 app files were unchanged.

Recheck deployment with `CHROMIUM_PATH=/path/to/chromium node
scripts/check_pairing_release.mjs https://reality2.ai/along/pairing-lab/` after
building the matching local lab. Physical QR, touch, TalkBack and network behavior
remain for the device check.
