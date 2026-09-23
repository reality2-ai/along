# Reality2 browser integration: status and evidence

Along should contact AT directly and keep each person's AT key within their own
trust group, without requiring an Along-operated central server. Offline planning
must continue without a key, a peer connection or a portal. This is the intended
architecture, not an implemented feature.

## Current status

The user has approved developing the missing browser TG capability. The public
Along app remains on version 37 with scheduled offline planning; its live-data
connection and trusted-device enrollment are not enabled. Runtime work is in an
isolated development branch, published as
[Reality2 draft PR #1](https://github.com/reality2-ai/r2-standard/pull/1).
The sections below preserve the
sequence of findings, so earlier source-only/version statements are historical.

| Area | Evidence now available | What remains before an end-user claim |
| --- | --- | --- |
| Direct AT access | Authenticated browser reads and strict timetable matching, with aggregate evidence below | Connect a user's authorized credential to the contextual UI; verify lifecycle cancellation and actual installed devices |
| Browser persistence | Identity restart tests, revisioned atomic writes, concurrent-tab and injected-failure checks | Complete persona installation and application-secret policy; browser restart is not a physical power-loss test |
| Existing membership | Core certificate/evidence verification, signed revocation persistence, expiring single-use challenges | Freshness after partition, epoch advancement, device removal propagation and integration with credential access |
| Peer transport | Direct ordered channel and mutual proof tests with the asset host stopped | End-user signaling, actual device/network reachability, reconnect and operation-specific authorization |
| Enrollment comparison | Committed X25519 exchange, canonical invitation fields, connection-bound comparison strings and live two-endpoint confirmation with durable cancellation | Connect initial trust, invitation validity/custody, protected bundle delivery and the core ceremony; qualify actual person co-presence |
| Invitation use | Durable reservation, decline/consumption, restart refusal and atomic write-set tests | Connect the journal to a validated OPEN-to-OWNER install and resolve interrupted distributed receipts |
| Comparison UI | [Isolated component and live-session adapter](../experiments/tg-pairing/README.md), keyboard/reflow/axe, actual peer comparison and cancellation tests | Complete the enclosing ceremony and test actual TalkBack and physical co-presence; it is not loaded by Along |
| Complete runtime gate | Both full runs passed; the second matched the recorded unchanged snapshot at `4d4977141f3b9b35023e00a8d36c6e463fe6c06c`. Repository commit checks passed with the Composer GUI prerequisites built; source and verification notes are published in draft PR #1 | Complete enrollment and application integration; passing the component and repository checks does not establish those features |

The confirmation increment is published at
[`daa44f7e`](https://github.com/reality2-ai/r2-standard/commit/daa44f7ec385d12a3ef8dfacb4609e3ac38dada1),
with a separate CI prerequisite repair at
[`105255d3`](https://github.com/reality2-ai/r2-standard/commit/105255d37b95b85a2c4d0402858b4d1897eefe97).
The final confirmation runtime snapshot passed `cargo xtask verify`, its browser
tests and the repository commit checks. A handover wording adjustment then passed
the prose checker; the implementation bytes were unchanged. The local repository
commit checks ran the previously unavailable GUI controls successfully; no
“REFUSED TO RUN” entries remained. This is a draft development contribution, not
a merged runtime release or a public Along feature. The next functional work is
binding that confirmation to the core ceremony, protected bundle delivery and
validated persona installation.

GitHub's checks on this draft are **not green**. The hosted Rust job
[failed during environment setup](https://github.com/reality2-ai/r2-standard/actions/runs/35839489796)
when bubblewrap could not configure its isolated network namespace. The
[repository gate job](https://github.com/reality2-ai/r2-standard/actions/runs/35839489826)
also lacked generated Composer GUI assets needed by its controls. Local gate
success does not resolve those hosted failures. Repair the runner prerequisites
and obtain hosted evidence before treating CI as verified; do not remove the
isolation probe or count unrun controls as passing. The repair installs Ubuntu's
packaged bubblewrap profile while retaining the global restriction and existing
namespace probe, and builds the GUI prerequisites explicitly. Hosted Rust run
[35843129043](https://github.com/reality2-ai/r2-standard/actions/runs/35843129043)
passed the namespace setup probe but failed later in captured-packer tests
with `bwrap: execvp …/program: No such file or directory`. The separate
[repository gate run](https://github.com/reality2-ai/r2-standard/actions/runs/35843129013)
was still running at this observation. Local probes using captured shell scripts
and ELF programs pass; the hosted failure remains unresolved. Do not infer that
the browser enrollment code caused this failure, or that local success establishes
hosted compatibility.

### Protected enrollment payloads (experimental)

The [protected-carriage increment](https://github.com/reality2-ai/r2-standard/commit/c4f5b794)
adds purpose-separated AES-GCM protection for the candidate claim and provisioner
bundle, bound to the invitation and peer transcript. Both people must confirm
before the link allows either message. Replay, tampering, out-of-order messages,
expiry and disconnection close the session and void its durable reservation.
Browser tests use synthetic material and real isolated contexts with the asset
host stopped. The unchanged runtime snapshot passed `cargo xtask verify` and
repository commit checks locally. This proves the tested transport behavior,
not payload authority, completed membership installation or safe AT-key custody.
Those integration steps remain outstanding; the public app stays on version 37.

### Notekeeper reference inspection

At the user's request, inspected `reality2-ai/r2-notekeeper` local revision
`f771c3b7e258394fc4d7998c369a9b2668dd9b35`. This was a source review, not a
two-device interoperability test. Its `AGENTS.md` explicitly describes a
deliberately simplified application of R2, rather than a canonical implementation.

The relevant pattern is a browser-loaded WASM runtime, locally retained data,
an optional trust-group panel, invitations by QR/link/words, and automatic
WebSocket reconnect. These are useful references for Along's eventual
“Connect my devices” flow. Joining a group must remain optional for journey
planning; AT credentials should be requested only when enabling contextual live
information.

There are material boundaries to preserve:

- **Connectivity:** Notekeeper's `R2RelayTransport` uses a configurable WebSocket
  relay. Its README defaults to a community relay and explicitly requires a
  reachable relay for cross-device sync. A relay can be user-controlled, but is
  still a server dependency; this does not satisfy Along's stricter request for
  independence from servers other than the information provider by itself.
  Do not silently add the community relay as an Along dependency.
- **Storage:** `saveAuth()` base64-encodes serialized member and issuer state
  into `localStorage`. The adjacent `r2-core` WASM source documents those
  serializers as containing secret material and requiring encryption before
  storage. Base64 is not encryption. Reuse the persistence lifecycle concept,
  not this storage treatment for the AT key or current-standard TG secrets.
- **Authentication:** the inspected incoming-frame handler strips the HMAC
  before decoding and does not explicitly verify it before applying changes.
  In the adjacent Rust source, `decode_extended_frame` is a decoder, not a
  key-based verifier. This source finding needs qualification against the
  shipped WASM build; it is sufficient reason not to copy this receive path
  into a credential-sharing implementation.
- **Catch-up:** the inspected sender transmits only while connected, and its
  reconnect path requests relay catch-up. This is not evidence of a durable
  outbound queue or reconciliation after both devices edit offline. Along must
  test those cases before promising seamless saved-journey synchronisation.
- **Compatibility:** Notekeeper imports `R2TrustGroup` and `R2Member` from its
  bundled `r2_wasm`; the Along prototype targets the separate `r2-standard`
  browser runtime. Shared R2 branding does not establish wire, invitation or
  storage compatibility. Verify an explicit adapter before claiming that an
  existing Notekeeper trust group can be joined.

Implementation direction: use Notekeeper as the interaction and application
integration reference, retaining Along's validated storage, authentication and
enrollment boundaries. Keep transport separate from group identity and app data
so an explicitly chosen existing R2 transport can be supported without making
the portal or a default community service necessary for offline use. No new
relay dependency or Notekeeper interoperability has been enabled in Along.

Source: [Notekeeper application at the inspected revision](https://github.com/reality2-ai/r2-notekeeper/blob/f771c3b7e258394fc4d7998c369a9b2668dd9b35/index.html),
[repository guidance](https://github.com/reality2-ai/r2-notekeeper/blob/f771c3b7e258394fc4d7998c369a9b2668dd9b35/AGENTS.md),
and [README](https://github.com/reality2-ai/r2-notekeeper/blob/f771c3b7e258394fc4d7998c369a9b2668dd9b35/README.md).

### Next integration boundaries

The next increment now connects the comparison screen to the actual browser
enrollment session in the isolated experiment. Both peers must confirm on the
same live channel. Decline, duplicate decisions, lost connections and replaced
views close the session and void its durable invitation reservation. A failed
void write is reported and does not make the invitation reusable. The browser
checks passed for these cases using synthetic invitations with the asset host
stopped. The full runtime gate passed against the unchanged final snapshot and
the source is published in draft PR #1. The public Along app remains unchanged.

A delayed-timeout regression initially showed that a resolved comparison could
still be queried after its lifetime. The runtime now checks monotonic elapsed
time at each use, and that regression passes. A previously resolved promise is
not an enduring authorization: later protected operations must observe the live
session and its cancellation signal. Actual human co-presence, initial trust,
protected bundle delivery and persona installation are not established by these
automated confirmation checks.

The next runtime increment must connect these boundaries, not turn a comparison
callback into a direct write or secret-access grant:

1. Establish the candidate's initial trust through the actual invitation/exchange
   ceremony. The member-side invitation helper requires an existing persona and
   cannot be reused as proof that an OPEN candidate already trusts the issuer.
2. Bind person confirmation to the exact invitation and live connection. Decline,
   mismatch, expiry, changed membership and a replaced UI must invalidate pending
   work. A stale callback must not authorize a later session.
3. Deliver the validated persona bundle under the verified ephemeral session and
   retain the core ceremony's stage order. A signed member invitation alone does
   not demonstrate custody of the group issuer key.
4. Recheck OPEN state and identity revision in the same transaction that installs
   membership and consumes the invitation. Report completion from durable commit
   evidence, with explicit handling of a lost peer receipt.
5. Add application-specific AT credential access, restart, removal and rotation.
   Keep provider credentials separate from TG issuer and derived traffic keys.
   Qualify any claimed hardware-rooted sealing; where unavailable, do not persist
   TG material that the standard requires to remain volatile.
6. Connect the validated runtime to the contextual AT client, then release and test
   installation, offline fallback, real device pairing and accessible confirmation.

These are outstanding implementation requirements, not a replacement or reduction
of the [project goal](PROJECT_GOAL.md). There is no Along-operated central backend
in the chosen architecture. Tests that copy signaling in a harness do not prove
seamless device discovery or reachability across arbitrary networks.

## Initial runtime inspection (historical)


Inspected `reality2-ai/r2-standard` main revision
`fa35fba863e682b8af12cd32db0b380891facbdb`; the local checkout and GitHub main
matched at inspection on 23 September 2026. No files were changed during that
initial inspection; the approved development described above began afterwards.

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

### Original stop sequences (source and local data)

The importer/exporter now retains each boarding call's original GTFS sequence;
planner legs, nearby comparisons and stop boards carry it into the strict matcher.
This enables exact matching on loop routes when a corresponding live sequence is
supplied. Conflicting sequence/stop identities and ambiguous legacy records remain
scheduled. No sequence is guessed from display order.

The local reimport contains 1,453,215 connection sequences. All existing timetable
fields compare equal to the previous bundle, excluding the expected import-time
provenance change. An independent sample of 200 records matches original GTFS
stop IDs, departure times and non-inferred sequence numbers. The compressed
network grew from 12,331,056 to 13,534,220 bytes. See [validation evidence](evidence/stop-sequences.json).
New data is local only; public version 35 still carries its earlier bundle.

Regression tests cover unsorted input, non-consecutive sequence numbers, repeated
stops, legacy database export, propagation to journey/stop results, and conflicting
live identities. A full data/app release and direct TG-connected UI remain pending.

### Operator and direction alert scope (source and local data)

The local reimport now retains verified agency IDs for all 219 routes and explicit
directions for all 49,541 trips. Every previous timetable field remains unchanged
apart from import provenance. The compressed bundle is 13,536,722 bytes, only
2,502 bytes larger than the sequence-enriched bundle. See
[validation evidence](evidence/alert-identities.json).

Stop and journey alert contexts include these identities. Regression tests exclude
alerts for another agency or the opposite direction, including direction zero,
and leave missing identities unmatched. Public version 35 and its live connection
remain unchanged; this is preparation for a future data/app release, not TG
credential storage or a deployed live service.

### Real-provider stop-sequence verification

The [sequence-aware browser audit](evidence/at-direct-sequences.json) reads all
three AT feeds directly from Chromium at a locally fulfilled page using the public
app's origin. Boarding identities come from the downloaded timetable, not from
copying the live event's sequence into the expected identity. In this snapshot,
494 predictions matched, including four repeated-stop visits that would remain
ambiguous without original sequences. Another 143 had stale trip measurements.

The audit excludes 1,273 terminal-arrival-only records from departure checks. It
also reports 54 source-sequence mismatches and four stops not on the downloaded
trip; these are not treated as predictions. Six candidate visits were rejected by
the full matcher. These are snapshot counts, not guaranteed network coverage.
Vehicle matching accepted 870 positions. Only aggregates are saved; no credential,
raw feed, vehicle coordinates or personal journey is recorded.

Run `scripts/check_at_browser.mjs` explicitly with a local AT credential to repeat
this verification; it consumes provider requests and is excluded from routine
tests. Public live access and trust-group credential integration remain pending.

### Version 36 publication

The source and enriched timetable described above are now included in
[version 36](evidence/release-v36.json). Earlier “local only” statements record
their status at the time of those investigations. Public live access remains
disabled, and the Reality2 credential-storage gap remains unresolved.

### Runtime recheck after version 36

On 23 September 2026 the local Reality2 checkout advanced to
`8efd689cddfcfae96de7b178817d0d4869b897b3`. The three commits since the original
inspection concern host receipt routing and sensor evidence. None changes the
browser hive, portal identity or application-secret capabilities inspected above.
`hive-wasm` still uses `MemoryStorage` and documents the need for a persistent
implementation. No Reality2 files were changed by Along.

The pending scope choice remains whether to develop the missing TG capability
as part of this work or wait for Reality2 support. Neither response is assumed.
Direct AT access is ready for that integration; an arbitrary local key store would
not fulfil the requested trust-group architecture.

### Approved browser runtime implementation

The user has now authorized development of the missing TG capability. The earlier
pending scope choice is resolved. Work is isolated on the Reality2 branch
`along-browser-tg`, based on `8efd689cddfcfae96de7b178817d0d4869b897b3`, to avoid
interfering with concurrent runtime development.

The first implementation is an asynchronous IndexedDB persistence foundation
under `hive-wasm/browser`. It requires strict commit durability, uses revisioned
compare-and-swap transactions, and keeps deletion tombstones to reject stale
writers. It is not yet a TG credential store or a replacement for the synchronous
Rust Storage trait. Real-browser checks verify restart/offline behavior and
concurrent tabs using synthetic records and a generated test key. No real AT key
is stored or published. The runtime verification gate and full integration remain
in progress; Along's public live connection remains disabled.

The browser branch now also provides explicit Ed25519 device provisioning and
loading. A committed public/private pair survives browser restart; concurrent
tabs return one committed identity. Ordinary loading never silently replaces a
missing identity. Forgotten identities reject stale signing handles, failed
commits expose no identity, and mismatched custody fails closed. These behaviors
pass real Chromium checks with synthetic material, including offline signature
verification. This remains a platform primitive awaiting the Rust membership and
protocol boundary. Non-extractable Web Crypto keys do not establish a hardware
root, and no L5-derived group keys are persisted.

The runtime branch now exposes Reality2's existing certificate codec and Ed25519
verification through WASM. A real Chromium test connects a stored browser identity,
Web Crypto signing, the compiled Rust verifier and IndexedDB certificate storage.
It rejects wrong subjects/groups, forged signatures, malformed lengths and epoch
overflow. The JS wrapper checks unsigned 64-bit bounds before wasm-bindgen can
coerce an epoch. These are authenticity/interoperability checks; current membership
and revocation enforcement remain to implement.

Focused Rust tests and the WASM build pass. The initial full runtime gate failed
because shared `/tmp` ran out of space; its replacement run uses a dedicated
disk-backed temporary directory and is still running. No full-gate success or
completed TG integration is claimed.

Held membership evidence now uses Reality2's existing current/stale/ahead/revoked
calculation and signature-verified revocation set. Browser transactions preserve
verified revocations across reload, deduplicate subjects and prevent a second
establishment from clearing them. Real WASM/browser tests cover forgery, changed
reason, persistence and quota failure; a failed write makes the active handle
unavailable. These are informational local-state primitives. They do not yet
authorize AT-key release: authenticated enrollment/epoch changes, peer freshness,
revocation propagation and cross-tab failure handling remain required. The full
repository gate is still running; the isolated branch remains unmerged.

Same-origin tab coordination is now implemented for authenticated public
revocation evidence. Each receiver independently verifies the signature, while
subscribers invalidate pending/cached decisions before the write completes. A
real two-tab test passes with a simulated quota failure in the source tab: the
receiver persists the removal and the source remains unavailable. This does not
prove cross-device propagation or authorize application-secret access. The full
runtime gate is still building its platform targets.

The browser now exercises Reality2's L5 member evidence through WASM. A
verifier-owned challenge binds the expected peer and complete statement, expires
after 60 seconds on the monotonic clock, and accepts only one successful response.
The real-browser test rejects replay, another nonce, expiry and learned revocation
while allowing a valid retry after forgery. Membership revision is rechecked
before success. This proves a protocol primitive, not globally fresh membership,
application rights or encrypted key transport; no credential is released.

A direct application-transport prototype now exchanges ordered messages between
two isolated browser contexts after the asset server is stopped. It configures
no signalling, STUN or TURN service; the test harness explicitly copies the
offer/answer. Transcript hashes agree and oversized/closed sends are refused.
This is not yet a Reality2 TN bearer, end-user pairing flow, authenticated
credential channel or automatic cross-network reconnection. No AT key is used.

The full runtime gate has now terminated with a failure in the canon-table
self-test's positive control for check-requirements. Diagnosis is in progress;
no full verification success or merge readiness is claimed.

The hook-path failure was reproduced as a linked-worktree assumption in the
repository checker, with no hook override configured. Work has moved to an
isolated full clone using the tracked hooks unchanged. Its requirements self-test
passes; the complete implementation gate is running again, not yet green.

Application session statements now bind the group, epoch, verifier, prover and
connection transcript with a fixed encoding and domain separation. The real
browser test signs altered contexts using the synthetic member's actual stored
identity and passes them through the compiled L5 verifier. Changes to each field,
including reversing participants, are refused; the intended statement succeeds.
This is proof-context separation, not yet an authenticated transport state machine,
application-secret authorization, enrollment or a public live-data release.

The next browser increment connects those statements to a mutual handshake over
the direct WebRTC channel. Both peers prove their expected identities and confirm
readiness; only locally reconstructed statements are signed. Serialized, bounded
frames, a handshake timeout, current local membership reads, and closure on
membership invalidation constrain the session. This still exposes no credential
exchange or application access grant.

A real-browser test with isolated contexts and compiled L5 verification passes
with the asset host stopped: mutual authentication succeeds, wrong expected peer
or group fails, a learned signed revocation closes both sessions, and reconnect
cannot restore the revoked peer. Premature readiness and authentication queries
after closure are refused. The test harness supplies trusted synthetic enrollment
inputs; it does not prove end-user enrollment, globally fresh membership,
physical-device connectivity or protected AT key storage. Full runtime
verification remains in progress.

Session checks now compare the expected group, local identity and epoch with a
verified, revision-checked snapshot of the persisted membership. The local
certificate must also authenticate under the selected group before connection
creation. A real-browser mismatch test confirms that callers cannot choose a
different epoch merely through session options. Failed rechecks close the session.

Enrollment implementation must preserve L5B's person confirmation, signed
single-use invitation, commit-before-reveal exchange, and atomic OPEN-to-OWNER
installation. Browser nonextractable keys do not by themselves prove the
hardware-rooted sealing required for persistent TG issuer/derived keys by L5
5.3.1a–5.3.2. Those keys cannot be treated as durably supported by the identity
storage prototype. These requirements remain implementation work, not claimed
capabilities of the public app.

Browser storage now supports a bounded atomic compare-and-swap across multiple
records, with all comparisons completed before any write is queued. The real
browser test races two tabs on a synthetic claim/membership pair, confirms one
winner and matching records after restart, and injects a failure during the
second write to verify rollback of the first. Conflict, duplicate-key and clone
failure cases leave no partial update. Existing identity, membership and mutual
session tests also pass using this shared storage path.

This is the transaction primitive for atomic enrollment, not a completed L5B
ceremony or a claim of power-loss qualification. The complete runtime gate is
still running and has progressed from host tests into platform builds. The
public Along app remains unchanged while the integration is unfinished.

A durable invitation journal now reserves each group/code pair once. Consumption
shares the installation transaction; decline is terminal; interrupted or ambiguous
failed attempts cannot reopen the same code after browser restart. Browser tests
verify those cases, repeated-install refusal and rollback when the second write
fails. This is persistence bookkeeping only: signed invitation authorization,
validity, comparison, person confirmation and the validated OPEN-to-OWNER write
set must still be supplied by the enrollment controller. It is not connected to
incoming messages or the public app.

The full runtime gate has reached its explicit WASM build and Android-native
checks. It has not yet returned a complete verification result.

The invitation journal now has a passing independent-tab reservation race and a
concurrent decline/install check. Browser invitation statements also use the
existing core L5B encoder through a new WASM export. With actual member signatures,
the browser test rejects changes to group, issuer, role, code and validity against
the expected invitation, while accepting the intended statement. Invalid browser
numeric bounds and role names are refused before conversion.

The updated WASM build and browser checks pass. The long-running full gate began
before this Rust export was added, so another full pass over the final snapshot
will be required; its current run is being preserved. Signature coverage is not
yet complete enrollment authorization or issuer custody evidence.

The browser boundary now invokes the core L5B invitation authorization function
and retains its opaque result. The actual WASM/browser test accepts the named
issuer but refuses a cryptographically valid signature over the invitation from
a different member. Malformed invitation length, wrong nonce and revoked issuer
also refuse. The new WASM build and focused Rust tests pass.

This low-level result is not a complete ceremony or an install grant. The browser
controller must still own nonce lifetime/consumption, issuer custody, validity,
comparison and consent, and recheck membership before installation. Full
verification is still running through repository tools; another latest-snapshot
pass remains necessary after the new Rust boundary changes. No open Along GitHub
feedback issues were present at this review.

The member-side browser invitation controller now owns nonce issuance, a bounded
monotonic lifetime, single-use/concurrent verification and cancellation on
membership changes. Its authorization path restores the persisted local persona
and rechecks its revision before returning the core result. Real browser tests
pass for one concurrent success, retry after forgery, replay, expiry and learned
revocation. Unused invalidated WASM results are freed.

This helper requires an established local membership; it is not the initial trust
bootstrap for an OPEN candidate. Session comparison, person consent and the
remaining ceremony/install integration are still outstanding. The full runtime
run remains active through its board checks, with a latest-snapshot rerun owed.

An ephemeral browser enrollment exchange now implements candidate commitment
before provisioner reveal, checks the candidate's revealed contribution, and uses
real X25519 plus the existing core L5B comparison-string derivation. Browser tests
confirm matching strings and refusal of premature reveal, altered commitment,
degenerate contribution, substituted invitation and replay. The rebuilt WASM and
focused Rust tests pass. The API follows the
[W3C Web Cryptography X25519 definition](https://www.w3.org/TR/webcrypto-2/#x25519).

No storage or membership installation is connected to this prototype. It currently
discards the shared secret after comparison derivation; protected bundle delivery,
network binding, human confirmation and core ceremony installation remain work.
Byte arrays are cleared without claiming guaranteed erasure of browser/WASM copies.
The full clone run passed the canon-table self-test that failed under the linked
worktree; full latest-snapshot verification remains outstanding.

The ordinary-member comparison exchange now runs over the actual direct browser
channel. Both the commitment and an HKDF-derived comparison session bind its
transcript. With the asset server stopped, isolated browser contexts produce
matching core comparison strings; a substituted invitation closes both ends,
closure invalidates comparison, and key-holder invitations refuse this flow.
This is not yet person confirmation, invitation authorization integration,
protected bundle delivery or membership installation. Signaling still uses the
test harness, not an end-user pairing UI.

The full clone's complete `cargo xtask verify` run finished successfully, including
check, layering, conformance and documentation. Rust source changed during that
run, so it is not being claimed as complete verification of the latest snapshot.
A fresh full pass has started against a recorded source snapshot; runtime source
is being held steady while that pass runs. The latest focused browser tests pass.

While the runtime snapshot is held unchanged for full verification, an isolated
[comparison-screen component](../experiments/tg-pairing/README.md) prepares the
ordinary-member person-confirmation step. It displays the complete code,
full-width explicit match/cancel actions, one decision only, and honest pending
and expired states. It is outside `public/` and the static build; the released
app does not load it.

Its synthetic browser fixture passes keyboard match/cancel, duplicate-action
refusal, cancellation during a pending callback, recoverable failure, narrow
layout, enlarged-text reflow and automated axe checks. The phone-sized rendering
was inspected. These are component observations, not actual TalkBack, co-presence
or completed enrollment. The runtime must independently bind the decision to a
verified ceremony and honor cancellation before any protected operation.

The isolated comparison component now provides a per-view cancellation signal to
its decision handler. Replacing the view automatically disposes the previous one;
external expiry, replacement and disposal all cancel pending work. The browser
fixture confirms that an old button cannot submit again and a late result cannot
overwrite the replacement screen. Controllers still have to observe the signal
before protected operations; UI cancellation does not undo an already-committed
operation. The component remains outside the released app.
