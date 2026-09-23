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

## Direct feed adapter (source only)

`public/at-client.js` now supplies the direct AT transport and provider-response
conversion. It requests only AT's three fixed HTTPS feed URLs, sends the key in
the subscription header, omits cookies/referrers, refuses redirects, and reuses
the explicit-request, cancellation, timeout and freshness behaviour of the live
client. Fractional feed header timestamps are normalised to integer seconds;
alert scope restrictions are preserved, including malformed null restrictions.

Credential retrieval is an injected application dependency, not a claimed
Reality2 API or a storage implementation. It is not connected to the public UI.
The eventual TG integration must cancel clients when locking, revoking or rotating
credentials so cached results and pending work are cleared. Tests cover cancelled
and stalled credential retrieval, endpoint confinement, offline silence and feed
conversion. An integrated TG/browser end-to-end check remains outstanding.

### Real feed matching audit

The browser probe now imports Along's actual direct client and matching modules,
loads the downloaded timetable, checks service-day activity, and records aggregate
matching outcomes. On 23 September 2026 it exposed a provider compatibility issue:
AT's legacy JSON encodes a single `stop_time_update` as an object rather than an
array. The direct adapter now converts that recognised shape without altering
trip/stop restrictions or mutating the source. A regression test checks the actual
conversion-to-matcher path, including wrong-date and repeated-stop rejection.

After the fix, [the recorded snapshot](evidence/at-direct-matching.json) produced
1,203 matched departure predictions and 992 matched vehicle positions. Other
records remained scheduled/unmatched: 809 stop records had no departure event,
68 involved ambiguous stop visits, and nine had no stop-update array; 686 vehicle
trip IDs were absent from the downloaded timetable, six positions were stale and
two were ambiguous/unmatched. These are snapshot counts, not coverage guarantees.
They demonstrate actual provider-to-matcher operation; they do not establish TG
credential handling, public UI enablement, or the correctness of every AT record.

### Individual prediction freshness

A subsequent audit tightened the earlier matching result: a fresh feed header
must not make an explicitly old trip-progress measurement current. The
[GTFS reference](https://gtfs.org/documentation/realtime/reference/) distinguishes
`TripUpdate.timestamp` from feed creation time. When supplied, that timestamp must
now be a valid measurement within Along's 180-second freshness window. Missing
optional trip timestamps still use feed freshness. Cancellation/skip notices are
current-feed status assertions, not progress-derived departure predictions.

Stop and selected-journey predictions expire at the earlier of feed and trip
measurement deadlines. Nearby comparisons now also return to scheduled results
at expiry without fetching AT again. In the [follow-up real snapshot](evidence/at-direct-freshness.json),
591 stop predictions passed and 613 were rejected as stale trip measurements.
The earlier 1,203-match snapshot predates this safeguard and must not be cited as
evidence of individual-measurement freshness. Snapshot totals vary with time.

The current source checks include expiry while alerts remain current, unchanged
chosen-journey content, and nearby fallback without another AT request. These
source changes do not enable the public live connection or supply TG credentials.
