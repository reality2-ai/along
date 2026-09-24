# Pairing comparison component (not released)

Current distribution: [Device Preview 3806](https://reality2.ai/along/preview/public/)
includes the tested Settings integration, group-key update/recovery and
post-rotation sharing. Regular Along remains version 37. The implementation
sections below record development stages; use the
[current release evidence](../../docs/RELEASE_CHECKLIST.md) for qualification and
remaining limits. Both devices must update before pairing or reconnecting.

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


### Interrupted-receipt recovery transport

Runtime dependency: [R2 bf134d1a](https://github.com/reality2-ai/r2-standard/commit/bf134d1a10a5c7bfe75f65a1186b27fdfe50202c),
published on the draft browser-TG branch after full local verification and commit
checks. Hosted verification and end-user integration remain outstanding.

The verified R2 increment adds bounded ordered application messages to
an already mutually authenticated session. Local and peer certificate standing
are checked against held membership evidence around use. Incoming messages carry
an exact sequence; replay closes without redelivery. The receiver gets the
session cancellation signal and remains responsible for application authorization
and atomic side effects. Concurrent outgoing calls preserve order and snapshot
input before asynchronous work. Real-browser tests pass for these boundaries.
The local-persona session wrapper forwards an optional message receiver.
The application recovery path below uses this transport; it does not establish
globally fresh membership or AT-key access.


`receipt-recovery.mjs` now has an initial integrated recovery path. It reconnects
an installed candidate to the recorded issuer through mutual authentication and
sends a fresh nonce with the exact public receipt. The issuer requires a matching
saved receipt, candidate identity, certificate digest and consumed invitation;
the candidate accepts only the matching nonce/receipt and updates its existing
record by revision. It does not repeat enrollment or reopen claim state.
A real-peer test recovers after an intentionally aborted acknowledgment save.
The negative, fresh-document and cancellation checks described below pass; the full
runtime gate also passed against its unchanged recorded snapshot. This is not enabled in the public app.

Recovery counterexamples now pass for missing issuer receipt, wrong requesting
member, altered receipt, unconsumed invitation, wrong reply nonce and a different
valid group-signed certificate. Each refusal preserves the candidate's OWNER state,
acknowledgment flag and storage revision. A copied-module negative control removes
only the certificate-digest comparison; the different-certificate case then fails
at its intended assertion. Production source was not mutated for that control.
Cancellation and fresh-document checks are described below; the full runtime
gate passed against its unchanged recorded snapshot.

Recovery cancellation is now checked during an actual queued IndexedDB write and
during delivery of its completion event. The pending write rolls back without
changing OWNER, acknowledgment or revision; the completed write returns its real
successful result despite cancellation. The test resets only the acknowledgment
flag between fixtures, not the installed identity or invitation.

The recovery cases now run in a newly opened document after disposing the old
enrollment controller and closing its storage connection. Only the database name
and caller-established expected group are supplied; the issuer, receipt and
nonextractable signing handle must be recovered from persisted origin storage.
Success, mismatched evidence and both cancellation boundaries pass in that fresh
document. Test assets are supplied by the harness after its HTTP server stops:
this proves document-lifetime independence, not service-worker caching or a full
browser-process restart. The full runtime gate passed against its unchanged recorded snapshot.

Recovery also refuses a reply when another writer has advanced the local persona
revision after recovery starts. The real-browser check writes a retained marker
through the actual storage API, then completes the authenticated exchange. The
acknowledgment remains false and the newer revision and marker survive unchanged;
recovery does not overwrite the concurrent change.

### Stored claim reporting

The candidate controller now defaults to reading its persisted claim rather than
requiring a fixture callback. `stored-claim.mjs` distinguishes missing, invalid
and unreadable records without writing, minting or resetting anything. Only
recorded OPEN/OWNER values are returned to the core; refused reads carry distinct
error codes. The focused Node check passes, and the real-browser installation
and recovery test now uses that default reader. The separate ceremony check
retains an explicit reader to exercise changes and delayed reads.

This closes the reporting boundary, not initial persona creation: a recorded OPEN
flag alone is not proof of a valid group-of-one. Initial trust, platform facts and
local first-use/reset integration remain experimental.

### Real first-use persona

Runtime dependency: [R2 407a78d5](https://github.com/reality2-ai/r2-standard/commit/407a78d5673c858b74c2f6735112ae27cfcada7c),
published on the draft browser-TG branch after full local verification and commit
checks. Earlier runtime builds do not export `BrowserInitialPersona`.

`initial-persona.mjs` uses the new R2 `BrowserInitialPersona` constructor and
atomically saves the member record, OPEN claim, public initial membership and a
local initialization marker. It refuses any previous record, tombstone or partial
initialization; an unreadable store never causes identity replacement. Concurrent
initializers have a single transaction winner. Cancellation before commit rolls
back all records; cancellation delivered after commit reports the actual saved
identity with volatile issuer custody closed.

The fresh-document test restores and verifies the member key, reports
`loaded-from-storage`, and explicitly reports issuer custody unavailable. No group
issuer or derived traffic key is persisted. Absence is reported as first-use or
cleared storage: this browser cannot distinguish those histories by itself.
The main enrollment/recovery test now starts from this real group-of-one instead
of writing an OPEN flag fixture. Target-group trust, provisioner platform/custody
facts and confirmation remain synthetic; local UI activation and reset are not
yet implemented. The constructor passed the full runtime gate against its unchanged recorded
snapshot. Status prose was refreshed afterwards.

### Local setup screen (updated for the browser software subset)

`showLocalSetup` mounts the explicit first-use action and calls
`initializeSoftwarePersona` only after a trusted button activation. Before creation,
it explains encrypted browser storage, the lack of hardware-backed protection,
access by code running as part of Along, and possible loss when browser data is
cleared. The original volatile-only initializer remains available for its separate
runtime tests; it is no longer used by this setup screen. This is a UI boundary, not protection
against arbitrary same-origin JavaScript. Missing storage is explained as first
use or cleared data; existing or unreadable state never presents a replacement
button. The screen distinguishes saved local identity from connecting to a peer.
Back, Escape and replacement cancel pending work. The screen retains no issuer
handle. A completed atomic save survives leaving the screen; a cancelled
transaction does not create a partial group. Late work cannot update a successor view. After the create action
finishes, keyboard focus moves to Back if it would otherwise be lost.

The browser test exercises actual keyboard creation, programmatic-click refusal,
repeat creation refusal, disposal, failed reads, delayed replacement, and Back
before and after atomic commit. A fresh document restores the real software issuer
and signs a certificate from the group created through the keyboard UI. Axe and
narrow/enlarged-text checks pass; the existing comparison suite also passes with
the shared hidden-control rule. These do not establish TalkBack behavior or
physical-device usability. The component remains outside the public static build;
restoration/recovery navigation, invitations and the enclosing device settings
flow still need integration.

Initial-persona restoration also rejects missing or mismatched initialization
markers, missing/changed claim state, an altered epoch or certificate, and a
substituted nonextractable private key. The fresh-document test independently
verifies the returned signature against the saved public member key. An actual
initialization-marker revision change then invalidates the previously returned
signing handle; these reads do not rewrite the persona or turn a failure into
first-use initialization. These focused checks pass, and the frozen runtime increment also passed its full
verification gate.


## Approved browser software profile

The user chose browser-only R2 with explicit security limits. `software-persona.mjs`
is a separate Along profile: it persists an AES-GCM encrypted issuer with a
nonextractable browser wrapping key alongside the initial member, bootstrap and
membership records in one atomic transaction. It uses the actual R2 certificate
codec, verifies restored issuer possession against the caller's expected group,
and invalidates a held issuer when its stored custody changes. It neither alters
the canonical volatile-only constructor nor silently migrates an old identity.

`software-persona.test.mjs` uses actual IndexedDB, WebCrypto and WASM codecs. It
covers fresh-document issuer restore/issuance, concurrent first use, interrupted
atomic installation, cancellation, wrong group, absent/tampered issuer and closed
or changed custody. This profile does not meet the standard's hardware-rooted
sealing requirement. Same-origin scripts and a compromised browser profile remain
outside its protection; references and temporary byte clearing cannot guarantee
browser-engine memory erasure. Group traffic-key derivation, invitation and full
enrollment wiring remain incomplete. Public Along does not load this experiment.


## Enrollment from the actual software issuer

`loadSoftwareIssuer.enrollmentMaterial(subject)` now returns a certificate and
volatile initial-epoch payload/integrity keys derived from the persisted issuer
seed. It uses HKDF-SHA256 with the group identity as salt and the R2 purpose
strings `r2/v0/group/payload` and `r2/v0/group/integrity`. Restore accepts only the
seed-only Ed25519 PKCS#8 encoding emitted by this profile; it refuses other forms
rather than guessing which bytes contain a seed. Custody is rechecked around
issuance and derivation, and the returned material has explicit destruction.
This currently handles epoch zero only, not group-key rotation.

`software-persona.test.mjs` compares both keys against an independent HMAC-based
RFC 5869 extract/expand calculation and checks purpose separation and destruction.
`software-enrollment.test.mjs` uses separate browser contexts, an actual reopened
software issuer, its installed member's signed invitation proof, the core
candidate ceremony and actual WebRTC carriage. After comparison confirmation, the
candidate generates its member key, receives the issuer-signed bundle, commits
through the existing installer, then restores and signs in a fresh document.
No recipient membership record is inserted by that test's harness.

The harness still supplies the initial trust decision, matching comparison
approval and connection descriptions. The candidate installer's traffic-key
persistence remains unfinished; this test proves member installation and restore,
not complete group-material restoration, discovery, physical co-presence or full
standard conformance. The AT peer scenario still has its separate bootstrap
fixture until these paths are joined. No public app feature is enabled yet.


The AT credential peer test now also uses this actual enrollment path, including
both sides of installation acknowledgment and recipient restore before key sharing.
Earlier references to its bootstrap fixture are historical. Initial trust,
comparison approval and manual signaling are still supplied by the harness.


## Atomic encrypted traffic-key custody

The explicitly selected browser software profile now adds `softwareCustody: true`
to the core candidate adapter. It encrypts the received payload/integrity keys with
a fresh nonextractable AES-GCM key and binds group, member and epoch as additional
authenticated data. The encrypted record joins the same transaction as persona,
membership and consumed invitation. The default adapter path remains volatile-only;
no hardware-sealing qualification is inferred from the software option.

`loadSoftwareTraffic` checks the restored enrolled member, exact current membership
epoch, record shape and storage revisions before returning temporary key bytes.
It checks membership again after decryption. Callers must destroy the returned
material and restore/check again before a subsequent operation; the returned
arrays are not a continuing permission or a revocation-proof capability.

The software enrollment test verifies fresh-document restoration against hashes
of the actual issuer-derived keys, refuses tampered ciphertext, a mismatched epoch
and cancelled reads, and clears returned bytes. With `ABORT_TRAFFIC=1`, it aborts
IndexedDB during the traffic-record write and proves the previous initial persona
survives without target membership or an orphan traffic record. The AT peer test
uses this profile too. Existing default core installation/recovery checks pass.

This closes initial recipient group-material persistence for the chosen software
profile. It does not establish hardware protection, full-profile rollback
resistance, epoch rotation/catch-up, practical discovery or physical-device use.
All of this remains excluded from public Along.


### Browser software invitation lifecycle

`software-invitation.mjs` adds a bounded, versioned public descriptor and a local
issuer handle for the selected software subset. The descriptor is not a secret,
trust decision or standard R2 wire format. It permits ordinary-member invitations
only and rejects invalid field shapes and out-of-range validity values. The
protocol validity field is distinct from the local invitation lifetime.

The local handle expires within 60 seconds, checks its monotonic deadline again
on use, closes on cancellation or failed operations, answers one fresh candidate
challenge and issues at most one enrollment bundle. The trusted enrollment
controller must still gate bundle issuance on the compared and confirmed session.
A descriptor remains copyable after closure but cannot reactivate its issuer.
There is no durable invitation resume or user-facing invitation exchange yet.

The software enrollment test now serializes and decodes this actual descriptor,
uses the installed member's challenge proof and completes real core installation.
It checks malformed descriptors, caller-copy isolation, pre-aborted creation,
cancellation, duplicate challenge refusal, bundle refusal before a challenge, and
expiry while the cleanup timer is blocked. The interrupted-install variant still
checks atomic rollback. This is same-host browser automation; reviewed initial
trust, comparison decisions and signaling remain harness inputs. Nothing here
establishes physical-device usability or hardware-backed protection.

### Invitation sharing screen

`showSoftwareInvitation` creates the real software invitation only on trusted
activation. It offers a full-width Copy action and a labelled, read-only manual
copy fallback. The screen says that copying is not a connection, keeps the local
issuer alive only while the invitation is active, and closes it on Back, Escape
or replacement. Expiry clears visible invitation text and moves keyboard focus
to the retry action when necessary. Clipboard completion cannot overwrite a
successor screen. Clipboard contents cannot be recalled after copying; an expired
descriptor does not reactivate the closed local issuer.

The enclosing controller can obtain the current invitation to answer the peer's
challenge. It still must perform transport, trusted group review, code comparison
and admission. This component sends nothing over the network and is not an
end-to-end device connection or public app feature. The test uses actual persisted
software custody and invitation creation, but mocks clipboard success and failure.
It checks keyboard operation, cancellation, expiry/retry, late completion, manual
copy fallback, automated axe checks and 320px/200% text reflow. Physical clipboard
transfer and spoken screen-reader behavior remain unverified.

### Receiving an invitation

`showReceiveInvitation` provides paste, review, and explicit confirmation that the
invitation was just copied from Along on a device the person controls. It validates
the descriptor and returns a canonical snapshot with a cancellation signal only
after trusted confirmation. It makes no membership or network changes. Recognised
format is explicitly distinguished from source authentication and expiry checks;
the subsequent challenge proof and comparison are still required.

Back/Escape from review returns to editing; leaving after confirmation or replacing
the screen aborts the returned signal. The enrollment controller must retain that
signal through its ceremony. The actual software enrollment test now obtains its
invitation from this screen and passes the signal into the core candidate adapter.
The harness still pastes the descriptor, confirms its physical origin, exchanges
proofs/session descriptions and decides the comparison. This does not establish
usable cross-device signaling or physical-device acceptance.

The receiving-screen checks cover malformed input, synthetic-click refusal,
keyboard confirmation, edit/back, cancellation/replacement, non-rendering of pasted
markup, automated axe checks and narrow enlarged text. No camera or clipboard-read
permission is requested. This remains outside the public app.

### Invitation proof exchange controller

`invitation-proof.mjs` moves the candidate challenge and inviter-proof verification
out of the enrollment test harness. It encodes bounded public challenge/response
messages for copying between devices, with an explicit Along profile identifier.
These are not standard R2 wire messages. A challenge snapshots the reviewed
invitation, generates a fresh nonce, expires locally within one minute and closes
on review cancellation. Verification is single-use and fails closed. The inviter
only answers a challenge naming its exact active invitation.

The real R2 codec checks the member certificate and nonce signature before the
controller returns an owned authorization token for the core candidate ceremony.
Callers must consume/free that token and retain the review cancellation signal.
This profile currently supports initial epoch zero only; it does not infer current
epoch or remote hardware custody from an invitation. It proves possession of the
named member key, not the physical source of the copied invitation, group issuer
custody, a completed comparison, admission or AT access.

The software enrollment test now uses this controller in its actual WebRTC
installation path. Fresh signed responses are separately tested with altered
nonce, certificate, signature and invitation, cancellation, oversized input and
retries after refusal. Reuse after successful verification is refused too. The
harness still carries the public messages and session descriptions between pages;
copy/paste exchange screens and physical-device connectivity remain unfinished.

### Public-message transfer step

`showDeviceTransfer` provides copy/manual-copy, a labelled reply field and a
trusted submission action. The primary action moves from copying to checking once
a reply is entered. The controller validates the message; text is never rendered
as markup and the screen performs no automatic clipboard read or network send.
On cancellation, expiry signalled by its parent, replacement or refusal, it clears
visible messages and aborts its lifetime signal. Late callbacks cannot update a
successor screen. Copying cannot retract clipboard contents already transferred.

The controller owns all protocol results and must pass the view signal into any
created session. This is a flow lifetime: retain the view/controller while moving
to subsequent connection steps, and dispose on cancellation or completion. The
actual software enrollment test now checks the proof through this screen, creates
the core candidate session from the verified reply and connects the cancellation
signal to it. It still uses the harness for message transport, inviter response,
WebRTC descriptions and code confirmation; this is not yet a complete connection
wizard or physical-device test.

The view test covers keyboard entry, copy success/fallback, empty input, next-action
emphasis, synthetic-click refusal, one submission, Back during pending validation,
late completion, protocol refusal, pre-cancelled entry, axe and narrow enlarged
text. Clipboard and the focused view callback are mocked; the separate enrollment
test exercises real proof verification and installation.

### Complete experimental pairing flow

`showPairingFlow` composes both roles from an already initialized local identity:
reviewed invitation, actual nonce proof, manual offer/answer transfer, displayed
comparison, core enrollment, encrypted software installation and acknowledgment.
Opening the provisioner flow is an explicit create-invitation action. It uses the
selected software subset at initial epoch zero; it makes no hardware claim.
Public-message fields can contain network addresses during WebRTC signaling, which
the screen discloses. No Along relay or automatic clipboard read is introduced.

All child views remain owned by the flow until it ends, so moving forward does not
accidentally cancel a session. Back closes protocol resources; late-created
sessions are closed too. Session failure ends the flow. A completed local install
is reported separately if its peer confirmation fails. The provisioner's success
says acknowledgment was sent, not that it knows the recipient received it. Code
confirmation now requires trusted activation; synthetic clicks cannot accept it.

`pairing-flow.test.mjs` drives both sides through their fields and buttons, compares
the displayed codes, completes actual WebRTC installation/acknowledgment and checks
the installed member plus encrypted traffic-key restore. `CANCEL_FLOW=1` rejects
the comparison and checks that both screens end with the candidate identity still
initial. Comparison reflow and axe checks run at 320px/200% text. The harness moves
public text and confirms the physical comparison; it does not inject membership,
proof authorization, session decisions or installation into the controller.

This remains a development flow excluded from public Along. Copying several long
messages under a one-minute invitation lifetime is not the intended seamless
experience. Physical cross-device signaling, simpler transfer, recovery navigation,
current-epoch lifecycle, actual AT-sharing integration and saved-journey sync are
still needed. Passing same-host browser tests does not establish those behaviors.

### Local QR transfer option

The composed flow can display an outgoing public message as a QR code and scan a
reply into the existing input. Invitation review also offers scanning. A scan
never accepts the invitation, submits a reply or confirms a code automatically.
The retained copy/paste path works when a camera or browser QR detector is absent.
Messages larger than 1,800 UTF-8 bytes fall back to copying; dense-code readability
and real phone/desktop camera operation still need device testing.

QR generation uses a pinned, locally vendored MIT library (see `vendor/README.md`).
Camera frames go only to the browser's local `BarcodeDetector`. Camera access is
requested after a trusted scan action, with audio disabled. Scanning stops on a
result, Stop, timeout, hidden document, detached view, cancellation or submission.
Late camera permission and detection results cannot resurrect a cancelled scan.
The camera permission prompt itself is controlled by the browser. Support varies:
see the [BarcodeDetector API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector).

`qr-transfer.test.mjs` renders a real SVG and independently decodes its screenshot
with ZXing-C++, including macrons. Camera lifecycle cases use mocked camera and
native-detector results; they do not establish a physical scan. To run that test,
create a Python virtual environment with `zxing-cpp` and `pillow`, and point
`QR_PYTHON` at its interpreter (default: `python3`). The browser uses neither Python
nor these test-only dependencies. The complete pairing regression still succeeds
through its manual text transport, and view checks exercise actual QR rendering.

### Standalone device lab

`lab.html`/`lab.mjs` provide a runnable development entry point for setup, saved
state restoration and both pairing roles. The user performs no coding. The page
states the course-exercise risk, browser-software custody limits, one-minute
invitation lifetime and likely same-network constraint. It takes no AT key and
syncs no journeys. Its database is `along-pairing-lab-v1`; this separates test data
from app data, but is not isolation from other scripts on the same origin.

Restoration is an explicit user action. This development entry point trusts the
origin's persisted local group choice and then checks actual persona, certificate,
journal and membership consistency. It does not acquire a trust root from incoming
network data or promise resistance to wholesale local-storage rollback. Missing,
partial or unreadable existing state never triggers automatic replacement.
A joined device is shown as installed/acknowledged according to durable evidence;
it is not offered fresh enrollment as if it were an initial device.

Build after producing the experimental R2 WASM/runtime artifacts documented above:

```sh
# First collect runtime notices using docs/PAIRING_LICENSE_AUDIT.md.
python3 scripts/build_pairing_lab.py --browser "$R2_BROWSER_DIR" --wasm "$R2_WASM_DIR"
```

For a distribution candidate, prefer
`python3 scripts/build_pairing_lab.py --runtime releases/along-r2-runtime-1b9229ad`
using the [recorded rebuild procedure](../../docs/PAIRING_LICENSE_AUDIT.md#recorded-runtime-rebuild-24-september-2026).
It verifies source/runtime/browser/notice hashes together and includes the build
record in the output. Separate development inputs above do not establish that
provenance.

Output is `releases/along-pairing-lab/`. The builder follows only local module
imports, copies the required WASM/CSS/HTML, QR license and verified runtime notice
collection, and hashes all payload
files into `build-info.json`. It does not traverse the project tree for data or
credentials. The generated folder can be served by an ordinary static server over
HTTPS (localhost also works for desktop checks). No service worker or Along
backend is involved. It is not included in `npm run build` or the public Pages app.
The standalone [device-test lab](https://reality2.ai/along/pairing-lab/) is published
as build `5dd96dcabf9a`, with the runtime records and notices. It remains an
experiment requiring physical-device acceptance, not a supported app feature.

Run `node experiments/tg-pairing/lab.test.mjs` after building, with the usual
`CHROMIUM_PATH` if required. `PAIRING_LAB_DIR` can select another generated folder.
The test checks payload hashes, absence of test/data/credential filenames, then
uses the built page for both devices: actual first-use setup, visible pairing,
acknowledgment, encrypted-key restore, reload and restored membership display.
No membership fixture or direct controller invocation starts this test flow.
The harness still transfers public text and confirms the physical comparison;
that is not evidence of camera usability or phone-to-desktop reachability.


The [runtime notice audit](../../docs/PAIRING_LICENSE_AUDIT.md) records the exact
56-package closure and outstanding local R2 notice/declaration gaps. The
[S23/desktop check guide](../../docs/PAIRING_DEVICE_CHECK.md) gives the published
URL and build identifier. All deployed payload hashes and HTTPS setup/restore
were checked; physical pairing has not yet been verified.

### Connection loss while a save result is returning

The composed flow now waits for in-flight installation and acknowledgment writes
to settle before choosing its terminal message. A connection abort can arrive
after IndexedDB has committed but before the awaiting UI resumes. The earlier
flow could report “start a new invitation” using an in-memory flag that had not
yet caught up with that commit. Atomic storage was correct; the visible advice
was not. A committed acknowledgment can have the same timing problem.

The failure screen briefly checks saved state, then reports either no installation,
local membership without confirmation, or saved membership with confirmation.
Leaving the screen prevents a late result from replacing the next screen.

`LOSE_INSTALL_REPLY=1` in `pairing-flow.test.mjs` delays delivery of a real successful
installation transaction, closes the other device's actual WebRTC flow, then
releases the result. It verifies retained membership and recovery wording.
`LOSE_ACK_REPLY=1` does the same after the confirmation write and verifies the
acknowledged outcome. These are actual commits, not fabricated membership records.
Comparison cancellation and the rebuilt standalone setup/pair/reload flow still
pass. No physical transport-loss test is claimed.


### Explicit lab-only reset

The home screen offers removal of this browser’s test identity with a separate
confirmation and a prominent keep/back action. `lab-reset.mjs` targets only
`r2-browser:along-pairing-lab-v1`; it does not enumerate or clear origin storage.
Removal requires a trusted activation, waits through an IndexedDB blocked event,
and offers fresh setup only after deletion succeeds. Closing a view cannot cancel
an already-issued deletion; the confirmation explains this before starting.

The built-lab browser test checks cancellation, synthetic-click refusal, a real
blocking database connection, successful removal, fresh setup, and preservation
of Along local preferences and a separate offline database. The other device’s
identity remains usable. This is local test cleanup, not distributed revocation,
provider credential revocation, secure erasure or interrupted-pairing recovery.


### Visible interrupted-installation recovery

`recovery-flow.mjs` exposes the saved-receipt recovery protocol through explicit
message transfer controls. The lab offers it to an enrolled identity without
confirmation and offers the answering action on the original inviting device.
Both restore their existing identity. The responder treats the incoming member ID
as a routing hint: actual installed-key authentication, local membership and the
saved installation receipt must validate before it answers. No invitation, new
certificate, AT credential or sharing permission is created.

`RECOVER_CONNECTION=1 node experiments/tg-pairing/pairing-flow.test.mjs` holds the
real inviting device’s receipt-write result after commit and closes the connection
before its acknowledgment is sent. Fresh documents reopen the databases and
complete recovery through visible controls. The test checks the same member ID,
exactly one confirmation write, cancellation without writes, malformed-message
refusal, narrow-screen reflow at 200% text size, and axe checks. It does not fabricate
membership or clear an acknowledgment flag to produce the interrupted state.

The sender reports confirmation **sent**; only the joining device reports it saved.
If the inviting device never saved the receipt, this path cannot confirm the
installation. Physical-device behavior, broader repair and epoch catch-up remain
unverified or unfinished. The public Along app still does not load this lab.


### AT settings reached from the saved device

The built lab now offers **Test optional AT-key storage** after restoring either
an initial or an enrolled identity. It composes the existing AT settings, explicit
local owner establishment and encrypted vault, rather than using a fabricated
identity or separate test store. The lab asks for dummy text only and makes no
provider request. Saving a key is not enabling live feeds or peer sharing.

The static builder preserves the `tg-pairing/` and `at-credentials/` directories,
resolves relative module imports only inside those roots, and includes their
explicit stylesheets. It still hashes the complete bundle and excludes normal
journey data, tests and credentials. `lab.test.mjs` now follows actual enrollment
with visible key setup, synthetic key save and reload/restore; it verifies a
nonextractable wrapping key, encrypted saved bytes, no displayed plaintext and no
external requests. Local lab reset also removes these test credentials.
## Signed membership-removal evidence

`loadSoftwareIssuer().issueRevocation({subject, sequence, reason})` produces
public signed evidence using the current profile's epoch zero and the actual
R2 revocation signing bytes. It validates the unsigned 64-bit positive sequence
before calling WASM, bounds the reason to 0–3, copies the subject and checks
issuer custody before and after signing. It refuses after cancellation, closure
or a changed issuer record.

Producing evidence does not apply it or prove delivery. The caller must establish
the reviewed target and sequence policy, persist the removal and distribute it.
`software-persona.test.mjs` uses the real membership verifier and IndexedDB to
check valid removal, tamper refusal, replay and reopening. It also cancels during
signing. User-facing removal, distribution and epoch/key rotation remain pending;
journey-sharing permission removal is a different operation.

`removeSoftwareMember()` now composes issuer custody with verified target
membership and a guarded IndexedDB commit. It refuses self removal, an invalid
certificate, unavailable issuer custody and nonzero epochs. The retained signed
revocations are the outbound evidence after restart. A compare-and-swap assigns
the next sequence while preserving concurrent removals; retries return an existing
record without issuing a replacement. Persona, bootstrap and issuer revisions are
checked in the same transaction. The existing membership verifier broadcasts
authenticated local-tab invalidation after commit. A late cancellation does not
change a committed result into a refusal.

The controller reports `removed-locally` and `delivered: false`. It is not wired to
a user-facing removal action, does not distribute evidence to another device and
does not rotate keys or recall previously shared AT credentials. The browser test
checks concurrent removals, failed writes, early/late cancellation, idempotent
retry and authenticated retained evidence in a fresh document. No production
credential is involved.

`member-removal-view.mjs` provides the review for a selected certified member.
It verifies issuer custody and the target before showing the action, includes
the complete identity under a disclosure, and explicitly separates a local
removal from delivery and replacement of keys. Keyboard confirmation returns
focus to Back; Back/Escape and replacement cancel unfinished work. Failure asks
for a fresh review rather than claiming that a commit could not have happened.
An already removed member is shown without a second removal action.

`member-removal-view.test.mjs` exercises that component with actual browser
issuer/membership storage: trusted keyboard activation, synthetic-click refusal,
invalid proof, repeated removal, replaced views, cancellation on both sides of
commit, and 320px/200% layout plus axe. It does not establish physical TalkBack
acceptance. The local experimental app now reaches this component through
**Device and AT-key setup → Connect or recover another device → Review group
devices**. This flow is included in device preview 3802.

`member-devices-view.mjs` lists public certificates retained by the software
issuer in `along-issued-members-v1`. Issuance saves the index with guarded
compare-and-swap before releasing a certificate or enrollment material. Concurrent
issuances retain all targets and repeat issuance does not duplicate them. The
issuer also checks held membership before issuance and guards its revision at
commit; a locally removed member cannot receive a new certificate or enrollment
material through this path. This does not rotate material it already received.
The list is bounded at 256 entries; unknown/damaged records refuse rather than reset.
It is deliberately labelled as issued membership: an interrupted candidate may
never have installed it. Older preview enrollment records are not migrated into
this index, so the UI discloses that older devices may be missing. Complete older
device recovery remains necessary before treating it as a full group directory.

The generated-app journey test now enrolls two browser profiles using Settings,
then selects the issued device, backs out without removal, confirms through the
keyboard while offline and reloads to see the saved removal. Local saved journeys
remain. The software-custody test additionally covers concurrent/repeated issuance
and directory persistence in a fresh document. Delivery to other members and
epoch rotation remain unfinished.

### Manual removal delivery

After local removal, **Share this removal** opens the existing copy/QR transfer
component. It remains available when reopening an already removed device. Any
device with saved membership can choose **Receive a group removal** from device
setup, including a device whose own membership has already been removed. The
receiver uses its established local group rather than adopting the message's
group. Its result reports local enforcement, not delivery to other devices.

`removal-message.mjs` defines an Along-specific, single-removal message bounded
at 1,024 characters, with strict fields and unsigned integer bounds. It includes
public group/member identities and signed revocation evidence, never journey or
credential data. The receiver checks the actual runtime signature before any
write, commits under the membership revision, retains existing removals, bounds
the retained set and deduplicates replay. Authenticated local-tab invalidation
uses the runtime membership adapter. A receiver may accept its own signed removal;
its local data remains, but subsequent membership checks refuse group access.

The software browser test covers tampering, wrong group, truncation, early
cancellation, replay, peer removal and self-removal. The generated-app test now
copies a removal from the real owner review to the enrolled recipient's visible
receive field while offline, observes self-removal and reloads without the journey
sharing action. The harness copies the message; this does not establish physical
QR scanning or automatic propagation. Sending devices get no receipt merely from
copying. Automatic catch-up, delivery tracking and key rotation remain unfinished.

The software issuer rechecks recipient membership between both asynchronous
traffic-key derivations and immediately before returning material. The browser
test removes the target during each derivation in turn, verifies refusal and
observes that every derived buffer is zeroed. This closes the gap between checking
eligibility to issue a certificate and later releasing enrollment keys. Returned
bytes are still not an enduring authorization and cannot be recalled after release.

### Recovering the older device list (next candidate)

The published 3802 preview can omit devices enrolled by 3801. The next candidate's
`legacy-members.mjs` restores their public certificates from retained installation
receipts when the issuer opens **Review group devices**. It checks the certificate
signature, receipt digest, group/issuer/subject/code binding and consumed invitation
journal before merging into the directory. The write checks receipt, journal,
persona and directory revisions; concurrent changes retry without replacing the
existing index. It does not issue a new certificate, reset identity, alter keys or
grant an application permission. Interrupted older enrollments without a retained
receipt remain undiscoverable through this path.

The pinned runtime's storage adapter has no enumeration operation. A bounded,
read-only cursor enumerates only `enrollment-installations` keys for the selected
group in the caller's device database, refusing schema creation/upgrades and more
than 256 receipts. It never enumerates persona or credential values. Validation
reads and all writes use the ordinary adapter. This helper is specific to the
documented version-1 browser database; it is not a general R2 discovery API.

`PREVIEW=1 LEGACY_ENROLLMENT=1 node experiments/journey-sync/app-integration.test.mjs`
first serves the exact published 3801 bundle, pairs two real browser profiles,
then upgrades them to the candidate. It checks unchanged identity/certificate and
encrypted issuer/traffic bytes, refusal of damaged receipts and unconsumed journals,
cancellation and a receipt changing during commit. The rest of the actual app
flow covers sharing and offline selection/removal of the recovered device,
followed by signed removal receipt. The prior bundle must be extracted at
`releases/along-device-preview-3801/`; the test verifies its pinned manifest and all
payload hashes before serving it. These are browser-profile checks, not physical
device acceptance or proof of uninterrupted enrollment.

`removal-set.mjs` supports pre-session catch-up in the next journey-connection
profile. Each fixed-width record stores a subject, epoch, sequence, reason and
signature; canonical base64 stays below 40,000 characters for at most 256 records.
The group comes from the established local context, not the incoming set. All
signatures are verified before a guarded atomic merge; retained removals are never
deleted by a smaller or stale set. Replay performs no write or needless local
invalidation. The result confirms only a local merge, not globally fresh group
knowledge. This is Along-specific framing, not a normative R2 wire format.


### Group key-update review (not enabled in the public preview)

`epoch-rotation-view.mjs` provides the owner review for one key-version change.
It uses real encrypted preparation and atomic installation, refuses approval after
the reviewed version changes, and states that local installation does not confirm
delivery to another device. Back preserves any transaction that already committed.

Run `node experiments/tg-pairing/epoch-rotation-view.test.mjs` with the same
`R2_WASM_DIR`, `R2_BROWSER_DIR` and `CHROMIUM_PATH` used by the other browser tests.
The test checks keyboard activation, cancellation on each side of commit,
fresh-document restoration, stale views/approval and narrow-screen/axe behavior.
The complete recipient recovery and app integration remain pending; see the
[rotation design](../../docs/R2_EPOCH_ROTATION.md#owner-review-screen).


The source group-device list now checks saved key-update receipts through
`readRecoveryReceipt` in `epoch-recovery-receipt.mjs`. It displays installation
confirmation only after verifying the receipt's exact device/version, transition,
member signature, current held removals and unchanged storage revisions. Missing
and unverifiable evidence have separate wording; neither is shown as confirmation.
The status describes saved evidence, not online presence, and is associated with
the device button for screen readers. `EPOCH_INSTALL=1` in the software-enrollment
browser test covers these labels with real network-produced receipts, corrupted
fields, concurrent replacement and removal. This is not yet a new public release.


`epoch-recovery-view.mjs` adds the recipient's review after mutual authentication.
It requires an explicit trusted action, distinguishes newer-key delivery from
confirmation of existing keys, and reports local installation without claiming
the owner's receipt arrived. Back/Escape closes the session while preserving any
committed installation. The `EPOCH_INSTALL=1` browser test drives both review paths
over real WebRTC and checks keyboard operation, cancellation, failure messages,
lost acknowledgment, narrow/200% layout and axe. Signaling remains harness-driven;
message/QR exchange and app Settings integration still need completion before a
new public preview is qualified.


`epoch-recovery-flow.mjs` now composes that review with the actual device-message
transfer screens. A starting owner message, recipient request and owner reply
carry public connection context and signed-removal catch-up. The recipient accepts
before the owner's send action appears. `EPOCH_INSTALL=1` exercises the visible
text areas/buttons for a mismatched reply, saved-key confirmation and delivery of
a new key version. QR controls reuse the transfer component; physical scanning
and Settings/full app integration still need verification. Public preview 3803
remains unchanged.


The local experimental app now exposes rotation and delivery through device
Settings. Owners update keys locally, then choose a device to update; recipients
choose Receive a group key update. Removed devices cannot be selected for delivery.
Group recovery remains accessible when a saved AT binding cannot be verified,
without discarding that binding or offering to replace its authority.
`GROUP_KEYS=1` in `experiments/at-credentials/app-integration.test.mjs` verifies the
Settings path alongside personal-key, planning and offline checks. The visible
multi-device recovery test now starts through the device picker. Shared AT-owner
certificate renewal and complete post-rotation app exchanges remain pending;
these changes are not deployed in public preview 3803.


AT-owner renewal now uses `../at-credentials/owner-certificate.mjs` after recipient
recovery in local Settings. Only the current group-signed certificate for the
already pinned owner can replace its old certificate; the signed policy, chosen
credential and permissions remain unchanged. The real recovery test checks that
binding before/after rotation, invalid evidence, concurrent changes, idempotence
and fresh-document restoration. The certificate comes from the authenticated
recovery result. A different AT owner is not silently replaced with the group
issuer. Full post-rotation shared AT use and journey exchange remain unverified.


The generated-app `ROTATE_GROUP_KEYS=1` checks now pass for both shared AT access
(`MAIN_APP_SETUP=1` in the AT two-app test) and saved-journey sharing (journey app
test). They rotate through Settings, preserve existing consent/key ciphertext,
reload, reconnect and continue mocked contextual AT reads or offline journey-edit
convergence. See [the recorded evidence](../../docs/evidence/group-rotation-app-checks.json).
This covers the AT owner also being the group issuer; a different AT owner,
physical-device checks and release qualification remain outstanding.


### QR pairing timeout follow-up

Following the physical-device report of no progress after scanning and choosing
Use, the pairing flow now explains that the invitation requires messages in both
directions. The challenge screen names the action on the other device, and the
connection wait explains the remaining reply/code step. Failed enrollment reports
the last screen title without including connection messages or identity material,
notes the one-minute invitation lifetime, and preserves saved device data.

`TIMEOUT_FLOW=1 node experiments/tg-pairing/pairing-flow.test.mjs` advances the
browser clock to expire a real invitation, verifies the failure stage and unchanged
identity revision, then completes a new real WebRTC enrollment. The ordinary
runtime/browser environment variables are required. `CANCEL_FLOW=1` also passed,
including stage guidance and preserved initial membership. These are browser
harness checks, not reproduction or resolution of the reported S23 failure.
No invitation lifetime or protocol security rule was changed. Not yet deployed.
