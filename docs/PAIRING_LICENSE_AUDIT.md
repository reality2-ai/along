# Pairing runtime distribution audit

Status: incomplete. The standalone lab is built and tested locally; this audit
has not established that its runtime distribution notices are complete. No new
runtime licence has been assigned by Along. A conflicting explicit licence
change in the older R2 source requires clarification from the project owner.

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
and Apache declarations. These files still need assembling into the distributable
bundle; inventory hashes alone are not redistributed licence texts.

## Conflicting source declaration

The older `r2-core` history contains commit
`e5bc8d7efda7954f931587a08b57c7ac28b8472f`, dated June 2026, explicitly adopting
PolyForm Noncommercial and describing it as superseding the earlier whole-stack
MIT/Apache licence. That checkout still retains MIT/Apache files alongside its
`LICENSE.md` and `NOTICE`. The matching legacy MIT texts therefore cannot simply
be copied and treated as resolving the current runtime's licensing conflict.

Current R2-standard Cargo manifests retain MIT or MIT/Apache declarations, and
the identifier extraction source also used those declarations. Neither inspecting
those manifests nor discovering the older files settles which instruction is
authoritative for this distribution. The owner has been asked to clarify. The
proposed `r2-ident` metadata repair remains uncommitted pending that answer; no
new permission grant or ownership attribution is being invented here.

The registry notice collection can proceed independently: `--collect` copies 89
existing files verbatim into `releases/along-pairing-notices`, with the inventory
and an explicit incomplete-status README. Byte hashes were checked against the
inventory. These texts are not a substitute for resolving R2's own declarations.

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

Remaining work: resolve the owner’s authoritative licensing direction, then repair
upstream metadata/notices using the source history under the
R2 repository's normal review/gate process, collect applicable dependency texts,
and make the lab builder include them with provenance. Then verify the final
static payload and publish a specific test URL with the
[device-check guide](PAIRING_DEVICE_CHECK.md).

## Reproduce the inventory

In the experimental R2 Rust workspace:

```sh
cargo metadata --locked --offline --format-version 1 --filter-platform wasm32-unknown-unknown > /tmp/along-wasm-metadata.json
```

In Along:

```sh
python3 scripts/audit_pairing_licenses.py /tmp/along-wasm-metadata.json
python3 scripts/audit_pairing_licenses.py /tmp/along-wasm-metadata.json --collect
```

The script follows only non-development edges from `hive-wasm`, reports missing
declarations/texts, and omits local filesystem paths from its output. It inventories
files rather than synthesizing permission statements. Review the source revision,
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
applicable licence. The declaration remains uncommitted pending the owner's
clarification of the contradictory source history. Runtime distribution is still
pending that clarification and the complete notice bundle.
