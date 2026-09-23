# Reality2 integration investigation

Along should contact AT directly and keep each person's AT key within their own
trust group, without requiring an Along-operated central server. Offline planning
must continue without a key, a peer connection or a portal. This is the intended
architecture, not an implemented feature.

## What the inspected runtime actually provides

Inspected `reality2-ai/r2-standard` main revision
`fa35fba863e682b8af12cd32db0b380891facbdb`; the local checkout and GitHub main
matched at inspection on 23 September 2026. No files in that repository were changed.

| Component | Evidence | Implication for Along |
| --- | --- | --- |
| Browser hive | [`hive-wasm/src/hal.rs`](https://github.com/reality2-ai/r2-standard/blob/fa35fba863e682b8af12cd32db0b380891facbdb/implementations/rust/hives/hive-wasm/src/hal.rs) implements `MemoryStorage` and explicitly warns that reload loses it. | It cannot yet hold durable TG identity or the user's AT key. |
| WASM exports | [`hive-wasm/src/lib.rs`](https://github.com/reality2-ai/r2-standard/blob/fa35fba863e682b8af12cd32db0b380891facbdb/implementations/rust/hives/hive-wasm/src/lib.rs) provides a loopback boot demonstration and `portal_request_message`. | These are real building blocks, not an application-credential or peer-sync API. |
| Portal identity | [`tools/cloud/site/identity.js`](https://github.com/reality2-ai/r2-standard/blob/fa35fba863e682b8af12cd32db0b380891facbdb/tools/cloud/site/identity.js) persists non-extractable Ed25519 keys in IndexedDB and obtains challenges from `/api/devices/challenge`. | It provides device request signing for a website, with server enrollment/verification. Copying it would retain a central dependency. |
| Request binding | [`hive-web-identity`](https://github.com/reality2-ai/r2-standard/blob/fa35fba863e682b8af12cd32db0b380891facbdb/implementations/rust/plugins/hive-web-identity/src/lib.rs) explicitly says it is not a TN bearer or complete browser hive. | Its security properties must not be presented as a complete browser TG implementation. |
| Management wallet | [L5C scope](https://reality2.ai/standard/L5C-management-wallet.html) concerns custody of group-management key material, not application-data storage. | The AT credential needs its own application-secret policy; it is not a TG identity key. |

This source inspection establishes capability boundaries, not runtime conformance
or a complete survey of every experimental branch. The older archived projects
are not assumed compatible with the current standard.

## Integration contract to establish

The TG implementation must provide durable device identity, explicit enrollment,
authenticated peer exchange, and an application-secret store with defined access
and revocation rules. Along must not invent a `getSecret()` API and call it Reality2.
The actual browser runtime or device bridge needs to be selected, implemented
where missing, and tested against its protocol requirements.

Access should be restricted to the Along application and the intended person's
authorised devices, not automatically exposed to every application or every
member of a larger group. Keep AT credentials separate from saved-journey sync,
feedback, exports and diagnostic reports. A direct AT request necessarily makes
the AT key available to the trusted component making that request; a WASM binary
or a non-extractable signing key does not make an AT subscription string
unextractable. Document the protection provided by the chosen platform.

Removing a device should prevent future credential delivery and clear local
access where possible. A copied AT key cannot be recalled through TG revocation;
a suspected compromise requires rotation at AT. Test enrollment, use on two
devices, restart, disconnection, lost-device removal and AT-key replacement.
No claim of secure synchronization is justified until these have been observed.

## Direct AT browser verification

`scripts/check_at_browser.mjs` performs an explicit, authenticated read-only probe
of trip updates, alerts and vehicle locations. It uses a locally fulfilled test
page at the public app's origin and real browser requests to AT, recording only
aggregate feed status and freshness. It does not publish credentials or modify
the live website. Run it with the ignored root `APIKey` file or `AT_API_KEY` and
an available Playwright Chromium installation. It is excluded from routine tests
because it requires a personal key and uses AT quota.

The separate proxy implementation remains experimental source history. It is not
the chosen public architecture, and public live access remains disabled until
the direct client and TG credential path are implemented and verified together.

The 23 September 2026 Chromium probe succeeded for all three feeds: HTTP 200,
readable response bodies, and fresh timestamps. See [aggregate evidence](evidence/at-direct-browser.json).
AT returned fractional-second header timestamps for all three. The current Python
adapter truncates these to whole seconds; the future direct client must explicitly
normalise provider timestamps before handing records to the strict live matchers.
This probe verifies network access and feed freshness, not correct end-to-end
journey matching, TG storage, or installed Android behaviour.
