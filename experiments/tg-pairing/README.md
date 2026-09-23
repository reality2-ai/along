# Pairing comparison component (not released)

This isolated component prepares the person-confirmation step for ordinary-member
browser enrollment. It is not imported by Along or copied into its static build.
It does not authenticate an invitation, compare another device's code, install
membership, or authorize an AT key. The runtime must supply the correct
connection-bound comparison and bind the person's answer to that ceremony.

`showComparison(container, {code, onDecision, signal, focus})` accepts the four
comparison bytes and an explicit decision callback. It displays every character,
provides full-width match/cancel actions, admits one decision only, and stops
accepting input after abort. The callback receives `(matched, signal)`, where the
second argument is scoped to this view. External abort, disposal or replacement
of this container aborts that signal. Mounting a replacement automatically
disposes the previous view. A pending callback cannot overwrite an expired
comparison message. The controller must itself observe the supplied cancellation signal before any
protected operation: disabling UI does not revoke a permission already issued.
A resolved callback never displays “paired” or “connected”. The component can be
replaced only when actual enrollment completion has been established.

Focus moves to the heading only when the opening action explicitly requests it.
Escape declines while focus is within the component. The visual code is paired
with digit/letter-separated screen-reader text. This text is not evidence of
correct spoken pronunciation on a particular device.

The AI can run the isolated browser check after `npm ci`:

```sh
node experiments/tg-pairing/comparison.test.mjs
```

Set `CHROMIUM_PATH` if the environment uses a separately installed Chromium.
The fixture exercises a narrow viewport, keyboard match/cancel, duplicate actions,
abort, disposal and replacement during pending confirmation, failure, enlarged-text
reflow and axe checks.
It uses only a synthetic comparison code. It does not test real enrollment,
physical co-presence, Android TalkBack, hardware protection or AT access.

## Connection to the experimental runtime

Use Reality2 revision
[`5af4caab`](https://github.com/reality2-ai/r2-standard/commit/5af4caabb3ff6bcac1536dc892ded0db00f79ada)
or a compatible later revision, with WASM built from the same source. This is a
draft branch dependency, not a merged runtime release.

`session-view.mjs` supplies the actual code from Reality2's experimental
`createEnrollmentSession`, and sends the person's decision back to that same
session. Both peers must confirm. Replacing or disposing the view cancels the
old session; the runtime's abort signal disables the displayed controls when
the peer disconnects or declines. Cancellation also prevents durable invitation
reuse. This adapter remains outside Along's public build and does not enable
membership installation or AT credentials.

Run the integrated browser check with `R2_BROWSER_DIR` pointing to the runtime's
`implementations/rust/hives/hive-wasm/browser` directory and `R2_WASM_DIR` to its
compiled web WASM package:

```sh
node experiments/tg-pairing/session-view.test.mjs
```

The check uses synthetic invitations, real isolated browser contexts, IndexedDB
and the actual data channel; the asset host stops before comparison. It exercises
rendered controls, both confirmations, keyboard decline, remote disconnection and
replacement while confirmation is pending. It does not establish initial trust,
protected bundle delivery, full enrollment or physical-person co-presence.

## Enrollment payload validation

`enrollment-profile.mjs` defines an **Along experimental application format**,
not a normative Reality2 wire format or a claim of Notekeeper compatibility.
The test harness serves the runtime's `invitation.mjs` and `certificate.mjs`
alongside this module. Use the candidate-mint increment of runtime draft PR #1
with its matching compiled WASM package, including `BrowserCandidateKey`. Earlier
protected-carriage builds alone do not provide that candidate-key API.

| Message | Exact contents |
| --- | --- |
| Claim, 129 bytes | `ALNGCLM1`, canonical 89-byte invitation, candidate public key (32 bytes) |
| Bundle, 345 bytes | `ALNGBND1`, original claim, epoch (8-byte unsigned big-endian), core certificate (136 bytes), payload key (32 bytes), integrity key (32 bytes) |

The certificate must verify through the actual core WASM for the requested
candidate and group, with its issuance epoch equal to the expected epoch.
Lengths, version markers and the original invitation must match exactly.
Authenticating the traffic-key bytes depends on the protected transport and
authorized issuer custody; the codec cannot prove their derivation.

`enrollment-payloads.mjs` connects this profile to the confirmed runtime session.
It snapshots the invitation, validates received payloads, rejects duplicate
operations and cancels enrollment on failure. It clears received traffic-key
arrays when the session aborts, and clears intermediate bundle copies. The caller
must clear any further copies it makes; JavaScript cannot promise physical memory
erasure. A decoded bundle is not permission to persist keys or install membership.

With the same `R2_BROWSER_DIR`, `R2_WASM_DIR` and optional `CHROMIUM_PATH` as above:

```sh
node experiments/tg-pairing/enrollment-profile.test.mjs
node experiments/tg-pairing/enrollment-profile-carriage.test.mjs
```

The first check uses actual certificate verification and controlled transport
delays for cancellation races. The second uses real peer sessions and durable
invitation journals after stopping the asset host. Its initial trust bootstrap
is explicitly synthetic. A malformed encrypted claim or bundle must close both
peers and void their reservations. Neither test establishes issuer authority,
fresh epoch policy, core ceremony completion, durable installation or AT access.

`candidate-session.mjs` owns the candidate key for a confirmed peer session. It
generates the key through the actual WASM adapter, emits the claim using that
key, and closes/frees its handle when the session aborts or the controller is
disposed. Cancellation during asynchronous key generation rejects creation and
closes the late key without emitting a claim. Repeated disposal is safe. The
peer test covers this delayed-generation case and automatic cleanup after a
successful bundle exchange. This connects key lifetime to the session; it still
does not perform the core ceremony's admission or installation steps.

## Core-driven candidate session (experimental)

`core-candidate-session.mjs` starts from an authorized invitation and explicit
platform facts, then connects the live peer exchange to the core ceremony. The
runtime must provide actual claim state, build modes, custody and epoch; the
controller refuses missing or out-of-range facts instead of defaulting them.
The invitation passed to the session must match the verified statement.

The exchange records its actual commitment and contributions as they happen.
Both peer confirmations advance core verification once. The session reports
confirmation only after the core accepts that transition; a refusal closes it. Claim generation transfers
the newly generated key into the core request; receiving a protected bundle runs
certificate validation and a fresh claim-state read before core preparation.
`prepare()` returns public metadata only. It does not persist membership, consume
the invitation successfully, or grant access to a credential. Atomic installation,
qualified custody and the provenance of platform facts remain unfinished.

An optional setup `signal` cancels even before the session has been returned.
The real-browser test covers cancellation during the initial state read, after
an invitation reservation commits, during key generation and during the final
claim-state read, as well as early claims and changes to OWNER. It runs with
the asset server stopped. Initial trust, issuer custody and person consent are
explicitly synthetic fixture facts.

This increment requires Reality2
[`5af4caab`](https://github.com/reality2-ai/r2-standard/commit/5af4caabb3ff6bcac1536dc892ded0db00f79ada)
or a compatible later revision, and WASM compiled from the same source. The
combined core/session snapshot passed `cargo xtask verify` unchanged; status prose
was refreshed afterwards. `core-candidate-session.test.mjs` passes against that
tree and fails at missing core confirmation without the hooks. The existing
protected-carriage test also passes. A separate control restoring the premature
confirmed-state expression fails at the expected state assertion; the corrected
expression passes. Do not copy
these components into the public app or treat them as a released TG connection.


### Verified local installation increment

`installLocal()` now reads `candidate-persona/active` directly,
runs the core installation check against that claim, and uses its expected
revision in the same transaction as invitation consumption and initial public
membership evidence. Existing membership evidence is never overwritten; initial
admission accepts only the enrollment epoch, with no grace window. It stores the
requested nonextractable member key and validated certificate; group issuer and
traffic secrets are not persisted. This requires R2 [`5aae14c4`](https://github.com/reality2-ai/r2-standard/commit/5aae14c4e0e2416f3395dee072f5f9e75b258ba6) and matching compiled WASM,
not merely the earlier core/session revision above.

Its receipt says `installed-local` and `peerAcknowledged: false`. Cancellation
before commit rolls everything back; cancellation after commit preserves the
actual receipt. A competing claim update refuses installation without overwriting
the winner. Initial claim creation/reset and group trust remain synthetic test
setup, not finished user flows. Browser custody is explicitly unqualified and
no AT credential authority follows from this local receipt.

`core-install-session.test.mjs` passes against the integrated WASM build using
actual peer exchange. The R2 `persona-install.test.mjs` also reloads the document
and verifies a signature from the persisted key against the requested identity.
The original core-session test remains a separate regression check. The full
R2 implementation gate passed against its unchanged recorded snapshot. Status
prose was refreshed afterwards. This is not enabled in the public webapp.


`local-persona.mjs` restores only local custody. The caller supplies an already
established expected group; the loader never learns trust from its own saved
record. It validates the core certificate, exact certificate epoch, consumed
invitation and a fresh signing challenge against the member public key. It
returns a bounded signing closure, not the private key handle. Saved-record and
journal revisions are rechecked around signing, so replacement invalidates old
handles. This does not establish network-fresh membership or access
to application secrets. The integrated peer test also covers altered certificates,
epoch metadata, invitation references, mismatched keys, wrong groups and record
replacement before and during signing.

Restoration now consults the R2 membership implementation before returning a
handle and around each signature. A valid signed local revocation refuses both
new restoration and signing through an existing handle. Missing, stale, revoked
or invalid membership evidence cannot act as current membership. These checks
use locally retained evidence; fresh peer verification after a partition and
application-specific credential authorization remain separate requirements.

The integrated test also pre-populates conflicting membership evidence and proves
that a new enrollment preserves it while leaving the claim OPEN. Cancellation
before commit leaves no membership record. These checks cover the complete local
write set, including the revocation-bearing record, rather than only the persona.

`installation-receipt.mjs` binds a public receipt to the exact invitation, member
and certificate digest. The controller returns it only after local commit. Its
bytes alone are not evidence of a commit; eventual transmission must use the
confirmed encrypted session. Changed version, invitation, subject, digest and
truncated receipts are refused in the integrated test. Receipt transport is connected by the controller described below.


### Receipt integration

The controller exposes `acknowledgeInstallation()` after local
installation. The provisioning payload controller's `acknowledgeInstalled()`
validates the receipt against the certificate it actually sent and commits a
public receipt with invitation consumption before sending acknowledgment. The
candidate persists only an exact matching acknowledgment, and restoration can
report that saved fact. Loss, mismatch or failure leaves local installation intact.
This requires R2 [`7634c3a9`](https://github.com/reality2-ai/r2-standard/commit/7634c3a9b19cd0fe6f3d5102aa95902ceceb29ab) and matching compiled WASM.
Real-peer controller and carriage tests pass; reconnect recovery and group
announcement remain unfinished, and acknowledgment grants no credential access.

Fault-injection checks abort actual IndexedDB transactions on either side while
saving receipt state. Provisioner failure emits no acknowledgment and persists
no receipt; candidate failure leaves its installed OWNER persona and consumed
invitation intact with acknowledgment false. Cancellation during delivery of a
completed candidate save still returns the committed acknowledgment. These tests
do not simulate hardware power loss or establish interrupted-session recovery.


`local-persona-session.mjs` connects restored local custody to the existing R2
mutual peer handshake. It checks local membership, binds the expected peer and
owns cleanup of its membership subscription. The real-browser installation test
closes enrollment, opens a new channel using the installed candidate key and
completes mutual authentication. An authenticated local revocation closes that
connection and refuses a new one. Provisioner bootstrap and signaling remain
explicit test fixtures; this does not establish automatic discovery, remote-network
reachability, globally fresh revocations or application-secret rights.

The reconnect factory accepts the view's `AbortSignal`. Pre-cancelled setup and
cancellation during a delayed storage read create no peer connection; cancellation
after setup closes the connection and membership subscription. Browser tests
observe actual peer construction, not merely the returned status. Cancellation
does not erase the installed persona or its receipt records.

A fresh-document check restores the candidate and its acknowledged status from
origin storage without reusing enrollment objects. Test assets are supplied by
the fixture while the original asset server is stopped; this is not a service
worker/offline-installation test. The persisted acknowledgment records a past
exchange, not present reachability or newly established credential rights.

The R2 receipt snapshot passed the full `cargo xtask verify` gate unchanged;
status prose was refreshed afterwards without implementation changes. The
Along controller tests additionally cover receipt persistence, restoration,
cancellation and authenticated reconnection. These remain experimental components
outside the public PWA, not a completed user-facing TG feature.
