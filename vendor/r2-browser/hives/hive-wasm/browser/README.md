# Browser trust-group foundations (experimental)

Development for Along's server-independent trust-group integration. This module
provides asynchronous IndexedDB transactions, not a complete TG runtime or an
application-secret store. Do not put a real AT key in it yet.

## Current verification status

### Transaction evidence checks

`compareAndSwapMany` now accepts optional `checks`: bounded read-only revision
comparisons performed in the same IndexedDB transaction as its writes. No write
is queued until every comparison succeeds. Checked records are never rewritten
and contribute no result revisions. Duplicate read/write keys, malformed checks
and oversized combined batches refuse. `capabilities.transactionChecks` lets an
application refuse older runtimes which would silently ignore the new option.

Along uses this to commit an initial application-owner pin and signed AT policy
only while the verified persona, membership and installation evidence retain
their checked revisions. Browser tests cover preserved evidence revisions,
conflict refusal without partial writes and caller mutation. A copied storage
module with only guard comparison removed fails the intended stale-evidence
assertion; production bytes were not changed for the control. `cargo xtask verify`
passed against the unchanged recorded snapshot; this status prose was refreshed
afterwards. This is storage consistency, not authorization.

### Initial persona construction

`BrowserInitialPersona.generate()` creates fresh group entropy and a fresh
Web Crypto member key, then constructs the core group-of-one persona through the
member mint proof. It signs the initial member certificate and derives payload
and integrity keys with the core purpose-separated HKDF implementation. Issuer
and traffic custody remain volatile; closing the handle drops them. The only
record transfer contains public evidence and the nonextractable member CryptoKey,
explicitly labelled unqualified browser custody. There is no issuer/traffic-key
export or persistence method.

The targeted host certificate test, WASM build and real Chromium test pass for
fresh identities, authentic initial certificates, wrong-group refusal, private
export refusal, one-shot member transfer and closure. This is a construction
primitive, not permission to initialize over a stored device. Along now checks atomic first-use installation, restored member custody and
cancellation using actual IndexedDB. Its enrollment test uses the real initial
persona; target-group trust and provisioner custody are still fixture supplied.
Local activation/reset and issuer reacquisition remain to integrate.
This initial-persona increment passed `cargo xtask verify` against its unchanged
recorded snapshot. This status prose was refreshed afterwards. Along additionally
checks refusal of damaged restoration evidence and an explicit local setup view;
these are browser checks, not physical-device or TalkBack acceptance.

### Authenticated application carriage

The peer session now accepts bounded ordered application bytes only after mutual
proof completes. It checks local and peer certificate standing against held
membership evidence at use, snapshots outgoing inputs and serializes concurrent
sends. Exact incoming sequence numbers reject replay without redelivery. The
callback receives the session abort signal and must still enforce application
policy and atomic effects; this is not permission to release a credential.
These are Along experimental messages over the bound encrypted browser channel,
not a new normative Reality2 wire format or a TN bearer.

Real-browser checks pass for early-send refusal, ordering, replay, expected
identity/group/epoch and revocation. Along's recovery controller uses fresh nonce
and receipt binding over this session, with actual browser tests for missing or
mismatched saved evidence and cancellation around the acknowledgment write.
Initial setup and signaling remain fixture supplied. This increment passed
`cargo xtask verify` against the unchanged recorded snapshot. This status prose
was refreshed afterwards. Along also checks fresh-document recovery and refusal
to overwrite a concurrently advanced persona revision.

### Receipt integration

The experimental Along carriage now separates encrypted installation receipts
and acknowledgments from claims and bundles. Session methods enforce direction,
ordering and single use. Candidate receipts require completed local consumption;
the provisioning controller validates the exact invitation/member/certificate
binding and commits its public installation record with invitation consumption
before acknowledging. A failed acknowledgment never rolls back a committed persona.

Browser tests cover actual peer receipt exchange, premature-send refusal, replay,
purpose substitution and controller-level acknowledgment matching. The candidate
persists acknowledgment separately from local installation. This does not supply
reconnection recovery, group announcement, initial trust or credential authority.
The earlier local-installation increment passed the full gate; the receipt
snapshot has now also passed `cargo xtask verify` unchanged. Status prose was
refreshed afterwards without implementation changes.

### Core candidate ceremony bridge

`BrowserCandidateCeremony` consumes a verified `BrowserInvitation` and delegates
ordering, build/custody/validity checks, ordinary-member confirmation, candidate
request and certificate validation to the core `Ceremony`. Request consumes a
`BrowserCandidateKey`; arbitrary public bytes cannot replace that key. Every
adapter error closes the ceremony and drops retained volatile custody.

`prepare_install()` runs the core's second OPEN check and produces an opaque
`BrowserPreparedPersona` owning the generated candidate key and validated public metadata. This is **not a durable
installation receipt**. The enclosing runtime must read actual claim state and
atomically commit custody, persona and invitation consumption before announcing
success or allowing application-secret access. Initial group trust, issuer
custody, epoch freshness, actual person decisions and authenticated exchange
observations remain caller responsibilities. The bridge must not be driven by
invented values or by replaying a transcript after the fact.

The compiled-WASM `ceremony.test.mjs` passes with native browser signing keys and
the actual cryptographic exchange: consumed binding handles, refused ordering,
decline, changed claim state, wrong candidate/group certificates, forged signatures
and invalid platform facts. Its initial group trust and person consent are
explicitly synthetic. No key-holder enrollment is offered by this adapter.
The bridge snapshot passed the full `cargo xtask verify` gate unchanged. The
live-session hooks now forward the actual commitment, verified exchange and
mutual confirmation into that bridge. The session reports confirmation only
after the core accepts it. Cancellation closes the core alongside the link.
Along's real-peer controller tests pass, including delayed setup/state reads,
reservation cancellation, key generation and controlled core refusal. Initial
trust and platform facts are synthetic in those tests. The combined increment
passed `cargo xtask verify` against its unchanged recorded snapshot. Status prose
was refreshed afterwards without implementation changes. Run with the same environment variables as `candidate.test.mjs`.

### Atomic local persona installation

`into_browser_record()` consumes a prepared persona and transfers its
nonextractable member CryptoKey with the validated certificate, group and subject.
The record explicitly identifies browser custody as unqualified: this is not
hardware-rooted sealing, and no group issuer or traffic keys are persisted.
Trusted code in the same origin can use the signing handle; nonextractability
protects against private-byte export, not malicious application code.

The candidate session's `consume()` commits the invitation with an installation
write set in one revision-checked IndexedDB transaction. Cancellation aborts a
pending transaction. Once committed, its receipt remains successful even if
cancellation arrives before the caller receives it. A failed or interrupted
invitation remains unavailable rather than becoming reusable.

Along's experimental `installLocal()` reads the actual stored claim and binds
the core's second OPEN check to that record's expected revision. It returns a
local installation receipt with `peerAcknowledged: false`; it is not evidence of
completed distributed enrollment or authority to read application secrets.

`storage-cancellation.test.mjs` tests cancellation before writes, after queued
writes and during completion delivery. `persona-install.test.mjs` exercises
compiled core validation, atomic persistence, reload and signing with the stored
key. Along's `core-install-session.test.mjs` additionally uses actual peer
exchange and competing claim updates. All bootstrap authority and local claim
initialization remain explicit synthetic fixtures. Run with the browser test
environment described below. The integrated snapshot passed `cargo xtask verify` unchanged. This status prose
was refreshed afterwards without implementation changes.

### Candidate mint adapter

`BrowserCandidateKey.generate()` creates a fresh Ed25519 pair through Web Crypto
and obtains the core `Minted` proof through its platform keystore entry point.
It accepts no public identity or imported private key from the caller. The
private key is nonextractable and held only in volatile browser custody.
`public_key()` returns public bytes; `sign()` accepts bounded canonical protocol
bytes. The enclosing runtime still owns authorization for any signed operation.

`close()` drops this handle's key reference and refuses subsequent use, including
results of signing that was pending when it closed. This does not promise physical
erasure by the browser engine, hardware-rooted protection, durable storage or
membership. The actual enrollment ceremony and atomic installation remain work
in progress. Unsupported browser cryptography rejects without a fallback.

`candidate.test.mjs` exercises the compiled WASM in Chromium: private export
refusal, real signature verification, input copying, distinct generated keys,
closure during signing, and unsupported or extractable-key refusal. Run with
`R2_WASM_DIR` pointing to the compiled package and `PLAYWRIGHT_MODULE` and
`CHROMIUM_PATH` set as for the other browser checks. The integrated runtime
passes this browser check and Along's actual encrypted peer-bundle test. The full
`cargo xtask verify` gate passed against the unchanged recorded snapshot. This
status paragraph and the handover were refreshed afterwards without implementation
changes. Hosted Android provisioning still needs verification.

### Protected enrollment carriage increment

The experimental exchange now derives separate nonextractable AES-GCM keys for
the candidate's claim and the provisioner's bundle from its ephemeral X25519
material. HKDF and authenticated associated data bind the purpose, canonical
invitation and actual channel transcript. Each direction permits one payload,
at most 2048 plaintext bytes, with a fresh 96-bit IV and 128-bit tag. Keys remain
volatile; this is not hardware-rooted custody or a normative R2 bundle format.
The transport does not parse or authorize the contents of either payload.

`enrollment-session` exposes `sendClaim`, `claim`, `sendBundle` and `bundle`.
Both local and peer confirmation must precede protected messages. A bundle may
follow only a received claim. Malformed, replayed, tampered or out-of-order
messages close the channel and trigger durable invitation voiding. Reads and
asynchronous crypto completion recheck the session lifetime. Returned plaintext
copies remain the caller's responsibility; closing cannot recall bytes already
delivered to a caller.

`enrollment-protection.test.mjs` exercises real browser cryptography, purpose and
context substitution, direction, input snapshotting, size bounds, concurrent use
and cancellation across asynchronous operations. `enrollment-carriage.test.mjs`
uses actual peer channels and durable invitation sessions with the asset host
stopped. It checks synthetic claim/bundle delivery, tampering, replay within and
between sessions, premature messages and access after closure. Existing
certificate, comparison, confirmation and Along screen tests still pass.

Initial invitation trust/validity, claim and bundle codecs, issuer custody,
certificate/epoch validation, core ceremony installation and atomic commit remain
required before real membership material or AT credentials may use this path.
This increment's full runtime gate is recorded separately from earlier snapshots.
Web Crypto operations follow the [W3C API](https://www.w3.org/TR/webcrypto/).

### Live confirmation increment

`enrollment-session.mjs` now owns a durable invitation reservation and a live
ordinary-member comparison link. `decide(matched, viewSignal)` admits one local
decision; both endpoints must confirm on that same channel before `confirmed()`
resolves. Neither this promise nor the `comparison-confirmed` state authorizes
installation or credential access. A subsequent call rechecks whether the link
is still open. The enclosing ceremony must also bind its protected operation to
the session's abort signal; a previously resolved promise cannot be revoked.

Decline, duplicate/invalid decision, timeout, transport closure and view abort
end the link immediately. The session then voids the durable reservation. Failed
void writes reject `cancel()` and leave the reservation unavailable for reuse;
they never reopen the invitation. Transport failures conservatively require a
fresh invitation too. Every comparison/confirmation use also checks elapsed
monotonic time, so a delayed browser timeout cannot preserve an expired session.
Initial trust, invitation validity, persona installation and protected
bundle delivery remain separate work. Session construction does not prove that
an invitation is authorized or current.

`enrollment-session.test.mjs` uses real IndexedDB and two isolated Chromium
contexts with the asset host stopped, checking both decisions, decline, duplicate
decisions, cancellation before and after confirmation, durable reuse refusal and
an elapsed lifetime whose timeout callback has not yet run. That last regression
failed before adding the use-time deadline checks and passed afterwards.
Along's isolated `session-view` adapter additionally exercises actual rendered
match/cancel controls against these sessions; it is not in Along's public build.
The full runtime gate for this increment must be recorded separately from the
earlier verified snapshot below.

### Previously verified foundation

The implementation in commit `4d4977141f3b9b35023e00a8d36c6e463fe6c06c` passed
`cargo xtask verify` against a recorded unchanged source snapshot. The storage,
certificate, direct peer-link, mutual peer-session and enrollment-link browser
checks also passed against that snapshot and its compiled WASM. Tests use
synthetic material only. This is a verified development increment, not a runtime
release, a declaration of complete TG conformance, or a completed Along feature.

The ordinary-member enrollment comparison now crosses the actual direct data
channel. Its commitment and HKDF-derived comparison session bind the connection
transcript. Isolated-context tests stop their asset server before the exchange;
matching strings, substituted-invitation refusal and close invalidation are
checked. Key-holder invitations are refused by this ordinary-member flow.
Signaling still comes from the harness. Person confirmation, initial trust,
protected bundle delivery, core ceremony installation, credential custody and
rotation remain outstanding, as do physical-device/network checks.

The sections below retain incremental evidence and limitations. Earlier references
to a running gate, unpublished code or not-yet-connected transport describe those
earlier snapshots; this section states the current component status.


`openBrowserStorage(name)` returns `read(scope, key)`,
`compareAndSwap(scope, key, expectedRevision, value)`, `compareAndSwapMany(changes)`,
`remove(scope, key, expectedRevision)`, `persistence()` and `close()`.
Revision zero means absent. Deletion writes a versioned null tombstone, so stale
tabs cannot recreate a record using the revision from before deletion. Writes
resolve only at transaction completion and require reported strict durability.
Quota exhaustion is `full`; other failures are `fault`, never missing data.
Namespacing avoids collisions but does not isolate hostile same-origin code.

IndexedDB is asynchronous. This module must not be wrapped in the synchronous
Rust `Storage` trait with a fire-and-forget write: that would falsely acknowledge
durability. The browser runtime needs an asynchronous commit boundary before any
identity, enrollment or membership change is acknowledged externally.

## Evidence and limits

Run the real-browser check with Node and Playwright installed. If Playwright is
installed outside this tree, set `PLAYWRIGHT_MODULE` to its `index.mjs` absolute
path. Optionally set `CHROMIUM_PATH` to the Chromium executable, then run:

```sh
node implementations/rust/hives/hive-wasm/browser/storage.test.mjs
```

The test uses a temporary browser profile, synthetic records and a generated
test key. It tests clean browser process restart, offline reads, concurrent tabs,
stale-write rejection, tombstones, cloning failure, quota classification,
transaction abort rollback and corrupt records. It does not test physical power
loss, all browsers, hardware-backed sealing, TG enrollment or revocation.

Strict transaction durability and eviction protection are different properties.
`persistence()` reports the browser's eviction-protection status; it does not ask
for permission. A future explicit setup action must handle persistence denial,
storage clearing and identity loss. No silent memory fallback is provided.

References: [IndexedDB durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction)
and [persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).
L0 5.3 and the downstream key-protection requirements remain separate conformance
obligations; this foundation does not declare them satisfied.

## Next integration work

1. Establish an asynchronous Rust/browser state-commit boundary.
2. Retain the actual runtime device identity and TG membership with enrollment
   validation; avoid reusing the website's central challenge service.
3. Implement application-secret encryption and authorized access separately from
   management-wallet material, with explicit lock and revocation behavior.
4. Verify authenticated peer exchange, two-device enrollment, restart, removal
   and credential rotation before connecting Along's direct AT client.

## Device identity primitive

`identity.mjs` adds explicit `provisionDeviceIdentity(store)` and
`loadDeviceIdentity(store)`. It uses the standard's 32-byte Ed25519 public identity
format with a browser-generated, non-extractable private CryptoKey. Competing
provisioners return only the committed winner. Normal loading never generates a
replacement identity. A removed identity remains a tombstone; deliberate recovery
and reenrollment are still to be implemented.

Loading verifies the public/private pair. The returned handle exposes the public
ID, signing of caller-supplied canonical protocol bytes, and local forgetting.
Signing rechecks the stored revision before and after the crypto operation to
reject stale handles. This is a platform primitive, not an authorization endpoint:
membership proofs, peer admission, signing policy and actual Rust protocol codecs
must govern its use before it is exposed to an application.

Tests cover concurrent provisioning, browser restart, independent verification
of signatures, offline access, forgetting, failed commit, absent identity and
mismatched custody. Web Crypto non-extractability is not evidence of a hardware
root. No L5-derived group key is persisted by this module; the absolute sealing
requirement in L5 5.3.2 remains in force.

## Certificate interoperability

`src/browser_membership.rs` exposes the existing `r2-trust::Certificate` codec and
Ed25519 verifier through WASM. `certificate.mjs` validates JS argument types and
u64 epoch bounds before calling it. This avoids wasm-bindgen's modulo conversion
silently changing a negative or oversized epoch. Expected subject and group are
explicit verification inputs; authenticity does not establish their provenance,
current epoch, revocation state or application authority.

Build the web-target WASM package using stable Rust and an output/target directory
outside the shared source tree. Run the interoperation test with `R2_WASM_DIR`
pointing to that package and the same Playwright variables as the storage test:

```sh
node implementations/rust/hives/hive-wasm/browser/certificate.test.mjs
```

This test executes the compiled Rust codec in Chromium, provisions a synthetic
device identity, signs with a volatile synthetic group key using Web Crypto,
verifies through Rust and independently through Web Crypto, and checks a stored
certificate roundtrip. It refuses wrong identities, forgery, truncation, trailing
bytes, changed epoch, negative/overflow epochs and numeric values instead of
BigInt. It is not a two-device enrollment or revocation test.

The first full `cargo xtask verify` attempt failed when the machine's shared
`/tmp` filesystem filled during composer tests. A new run uses a dedicated
disk-backed TMPDIR. Until that full gate passes, these focused checks must not be
described as full repository verification.

## Held membership evidence

`BrowserMembership` applies the existing core standing calculation and verified
revocation set. A certificate ahead of the established epoch cannot advance that
epoch. Stale evidence remains distinguishable from revoked membership. Revocation
is terminal and the bounded set refuses new entries rather than dropping old ones.

`membership.mjs` stores only public evidence using revisioned transactions.
Establishment requires an already trusted group, subject and epoch policy; it is
not a trust-on-first-received-certificate enrollment protocol. Restoration checks
certificate and revocation signatures through WASM. Revocations append after
verification, deduplicate by subject, survive reload, and cannot be cleared by
reestablishment. A failed revocation write makes that active handle unavailable.

The browser test covers those persistence/refusal paths. Standing remains
informational, not a credential-access grant: fresh peer verification after
startup/partition, authenticated epoch changes, cross-tab failure invalidation,
enrollment consent, two-device removal propagation and key access are still
required. A reload cannot recover an uncommitted revocation from failed storage;
therefore local restored state alone must never grant application-secret access.

Membership handles now broadcast authenticated public revocation evidence to
other tabs on the same origin. Receivers reverify before applying it and do not
rebroadcast. `subscribe()` notifies consumers to invalidate pending work/cached
decisions; it never grants access. A pending verified write makes status
unavailable until commit. Closing the handle closes its channel and invalidates
subscribers. Callers must close handles when leaving their runtime context.

A real two-tab check confirms that the receiver can persist a valid revocation
when the source tab has a simulated quota failure. This is same-browser
coordination, not two-device networking. Broadcast delivery can be delayed or
unavailable, so every protected operation still needs the eventual peer/epoch
freshness gate and a current state read. Reopening after a failed write cannot
recover evidence that no participant saved.

## Interactive member evidence

`tg_nonce_signing_bytes` and `BrowserMembership.verify_nonce` reuse the core L5
evidence encoder and verifier. `challenge.mjs` owns a fresh 16-byte browser-random
nonce, immutable expected peer/statement, a 60-second monotonic lifetime, single
use and concurrent-verification exclusion. Only a valid response consumes it;
learned membership changes cancel it. Verification rereads the membership
revision before returning success. A closed or uncertain handle cannot verify.

The real browser/WASM test checks one accepted concurrent response, retry after
forgery, replay, another nonce, expiry and revocation. The helper does not supply
network transport, prove that local revocation state is globally fresh, or grant
application rights. The application protocol must bind the full operation,
participants and channel/session context into its canonical statement before
this helper can protect credential exchange. No secret is released here.

## Direct application transport prototype

`peer-link.mjs` uses an ordered WebRTC data channel with no configured ICE servers,
no media and no signalling service. Its offer/answer objects must be exchanged
explicitly. This is an Along application transport prototype, not a declared
Reality2 TN bearer or a new standard binding. The data-channel API follows
[WebRTC's documented interface](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel).

The test `peer-link.test.mjs` copies signalling through its local harness; it does
not implement an end-user pairing flow. It uses isolated contexts on one computer,
stops the asset server before negotiation, verifies bidirectional ordered delivery
and equal transcript hashes, and checks message/closed-state limits. It saves no
SDP, candidate address, fingerprint or credential. Physical-device and remote-NAT
connectivity are untested. Without STUN/TURN this cannot promise reachability
across arbitrary networks or seamless reconnection after browser restart.

The transcript hash covers both complete offer/answer descriptions and their
order. It is intended for binding the existing L5 identity proof to the actual
connection; the hash alone authenticates nobody. No credential exchange or
application authorization is connected yet. Pairing consent, membership checks,
authenticated session framing and revocation-triggered closure remain required.

## Session statement binding

`session-statement.mjs` creates a fixed-layout, domain-separated application
statement for establishing a peer session: group identity, unsigned big-endian
epoch, verifier identity, prover identity, and the connection transcript hash.
The participants must be distinct. Each side constructs the expected statement
locally from its approved pairing context; a peer-supplied statement must never
replace that expectation. This is not a new Reality2 wire format and does not
authorize credential access or any application operation.

The browser certificate test signs altered bindings with a real synthetic member
identity and the same verifier nonce. The compiled trust verifier rejects each
changed group, epoch, participant, direction and transcript, then accepts the
intended binding. This checks signature context separation; an authenticated
transport session state machine and enrollment consent are still required.

The earlier full verification failed because the repository hook checker assumes
a full clone and misclassifies the linked worktree's shared hooks. Development
has moved to an isolated full clone with byte-identical tracked hooks. Its
requirements self-test passes; full implementation verification is running there.
The earlier linked worktree is retained as a backstop, not the active edit tree.

## Mutual peer session

`peer-session.mjs` connects the channel, canonical application statement and core
L5 proof verifier. Each side sends a verifier-owned nonce, signs only its locally
reconstructed expected statement, verifies the other member, and acknowledges
readiness after verifying and responding. Incoming frames are bounded by the
transport and processed serially; unexpected or repeated handshake frames close
the connection. There is a bounded handshake lifetime. Membership invalidation
and channel failure close the session and discard authentication state.

`authenticated()` waits for mutual evidence and rereads local membership standing;
it refuses after closure even if an earlier call succeeded. `state()` is an
informational snapshot. Neither method is an application-secret grant. There is
no application payload API or credential exchange yet. Pairing inputs must come
from a trusted enrollment context, not an unverified received description.

Run `peer-session.test.mjs` with the same Playwright, Chromium and WASM environment
as the certificate test. It uses separate browser contexts and synthetic test
bootstrap certificates. After stopping the asset server, it verifies mutual
possession through real WebRTC and the compiled L5 verifier. Wrong expected peer
and group refuse; a signed revocation learned by one side closes both sessions;
reconnection cannot restore the revoked peer. A premature ready frame refuses,
as does querying authentication after closure. This is same-computer browser
evidence, not physical-device connectivity, global revocation freshness, user
consent, enrollment, or persistent application-secret security.

Handshake context is also checked against `membership.sessionContext()`, which
restores and verifies the persisted persona, requires current standing, and checks
that the storage revision has not changed before returning its public group,
subject and epoch. Each handshake continuation compares that context with its
immutable expected binding. A caller cannot select a different local epoch or
persona merely by supplying different session options. The local certificate is
also authenticated against the selected group and local identity before any
connection is created. The browser test includes refusal of a mismatched epoch.

## Atomic enrollment storage foundation

`compareAndSwapMany(changes)` validates and snapshots a bounded set of distinct
record keys, reads and compares every revision inside one strict IndexedDB
transaction, then queues all writes. A conflict writes nothing. A write failure
aborts the whole set. Success resolves only after transaction completion. The
single-record API uses the same implementation and preserves its return shape.

The real-browser storage test races two tabs updating a synthetic claim and
membership pair. Exactly one wins, and both matching records survive browser
restart and offline reading. It also injects a quota failure on the second write:
the first write is rolled back and the previous pair remains intact. Conflicts,
duplicate keys and uncloneable values do not leave partial records.

This supplies the transaction primitive needed for L5B's atomic install. It does
not itself check ceremony completion, claimability, invitation consumption or
key custody, and the synthetic pair is not a real persona install. Actual
power-loss qualification remains distinct from browser process restart testing.

## Single-use invitation journal

`invitation-journal.mjs` reserves a group/code pair exactly once in durable
storage. Its handle can void the reservation or consume it atomically with an
installation write set. Concurrent calls on a handle cannot both proceed. Any
ambiguous write failure makes that handle unavailable; there is no reopen API.
After process loss, a fresh authorized ceremony must use a fresh code. A transport
retry before verification can retain the same live reserved handle, provided the
ceremony controller supplies a fresh exchange and still-valid authorization.

The storage test verifies decline, successful consumption, interrupted reservation
and failed installation across browser restart. Re-reserving every used code is
refused, a consumed code cannot install again, and a second-write quota failure
leaves no partial installation. All records in this check are synthetic.

This journal is bookkeeping, not a ceremony authorization surface. The caller must
supply already-verified invitation evidence, validity, the required comparison and
person confirmation, and a validated installation write set including OPEN-state
and identity revision checks. It must not be called directly from incoming peer
messages. Distributed installation receipts and recovery still need integration;
these tests do not claim that complete enrollment works.

The journal's concurrency check uses independent tabs: only one can reserve a
code, and simultaneous decline/install handlers on that handle cannot both
commit. This tests browser coordination rather than only a single call sequence.

## Canonical invitation statement

`invitation.mjs` validates browser field widths, role names and unsigned validity
bounds before calling `tg_invitation_statement`. That export uses the existing
core L5B invitation encoder directly. The real browser test signs each altered
field with the synthetic member identity and the same challenge nonce: changed
group, issuer, role, code and validity all fail against the expected statement;
the original succeeds. Negative/overflow/non-integer validity and unknown roles
are refused before WASM numeric conversion.

Encoding and valid member evidence still do not establish issuer custody, the
provisioner's validity ruler, comparison or consent. The complete core ceremony
must enforce those before installation. The latest WASM build and browser test
pass. The already-running full gate began before this Rust export was added, so
it cannot prove the latest snapshot complete; a subsequent full pass is required.

`BrowserMembership.authorise_invitation` now invokes the core L5B authorization
function, using held epoch/revocation state and authenticating the issuer's
certificate. It checks the invitation's group against the expected group and
returns an opaque `BrowserInvitation` containing the core's authorized result.
There is no browser constructor for that result. Its public statement can be
read back for comparison; it has no install or secret-access method.

The actual browser/WASM test accepts the named issuer and refuses a valid member
signature covering the invitation when that member differs from the named issuer.
It also refuses a changed nonce, malformed length and revoked issuer. Nonce
issuance, lifetime and consumption remain the enclosing controller's obligation;
this low-level boundary does not own them. The opaque result is not proof of
issuer custody, invitation validity on the issuer's ruler, comparison, person
confirmation or current membership after a later change. Those checks must still
be enforced by the ceremony before install. Focused Rust tests and the rebuilt
WASM/browser check pass; complete latest-snapshot verification remains required.

`issueInvitationChallenge` supplies a fresh verifier-owned nonce, immutable expected
statement, bounded monotonic lifetime, concurrent-verification exclusion and
single successful consumption. Membership invalidation cancels it. It delegates
to `authoriseInvitationEvidence`, which restores the existing local membership,
uses the core authorization check, and rereads the storage revision before
returning the opaque result. Failed or invalidated results are freed. The caller
owns a successful WASM result and must free it or pass it into the eventual
ceremony controller; it is not a permanent authorization token.

Real-browser checks cover one concurrent success, retry after forgery, replay,
expiry and learned revocation. This member-side helper presupposes an established
local persona; it does not establish initial trust for an OPEN candidate. That
candidate's invitation/session comparison and the remaining core ceremony stages
still need integration. The earlier durable journal is a separate boundary and
must be connected only after those conditions are satisfied.

## Ephemeral enrollment exchange prototype

`enrollment-exchange.mjs` uses browser X25519 with nonextractable private keys,
following the [Web Cryptography Level 2 X25519 API](https://www.w3.org/TR/webcrypto-2/#x25519).
The candidate commits to its public contribution and random salt, bound to the
canonical invitation, before the provisioner reveals its contribution. The
provisioner verifies the candidate's reveal against that commitment. Both derive
the comparison string using the existing core L5B/HKDF function through WASM.

The real-browser test confirms equal comparison strings and refuses premature
reveal, commitment mismatch, degenerate contribution, substituted invitation and
replay. Exchange handles expire and can be closed; no storage API is involved.
Temporary shared-secret byte arrays are cleared, but this is not a claim that
browser engines, Web Crypto or WASM erase every internal copy on command.

This prototype supplies the exchange/comparison material, not a complete ceremony.
It currently discards the shared secret after deriving the comparison string;
protected bundle delivery, binding to the network session, human comparison,
issuer validity/custody and the core ceremony/install stages still need to be
connected. It does not enroll a device or claim cross-browser/device qualification.
The rebuilt WASM and focused Rust/browser checks pass. The full clone verification
has passed the canon-table self-test that rejected the linked worktree earlier;
complete verification over the latest source snapshot is still outstanding.
