# MIT scope for the R2 code included in Along

The project owner selected MIT, matching Along, on 24 September 2026 for the
R2 subset included in Along. [R2-MIT.txt](R2-MIT.txt) preserves the existing
Reality2 contributor attribution and MIT text. This distribution notice covers
the following local packages in the pairing WASM dependency closure:

- `hive-wasm`
- `hive-web-identity`
- `r2-discovery`
- `r2-hal-traits`
- `r2-ident`
- `r2-mesh`
- `r2-routing`
- `r2-transport`
- `r2-trust`
- `r2-wire`

It also covers the browser JavaScript modules copied from
`implementations/rust/hives/hive-wasm/browser/` and the generated `hive_wasm.js`
glue distributed with that WASM. Along's own integration code remains covered
by its root MIT licence.

This scope does not change the licence of the Reality2 standard documents,
other R2 implementations or third-party dependencies. Their notices remain
separate. See the build manifest for the files included in a particular build,
and `inventory.json` in the collected notices for the Cargo dependency scope.
The registry closure includes build-time dependencies and is broader than an
optimized binary's retained symbols.

The [licensing audit](https://github.com/reality2-ai/along/blob/main/docs/PAIRING_LICENSE_AUDIT.md) records the historical
PolyForm conflict and the subsequent explicit owner direction. This scoped grant
is not a claim that every upstream repository now has consistent metadata.
