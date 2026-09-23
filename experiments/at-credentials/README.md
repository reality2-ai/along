# Along credential experiments

Not imported by the public app. Use synthetic material only; do not put a real
AT key in this directory. The [credential policy contract](../../docs/AT_CREDENTIAL_POLICY.md)
is broader than the code currently implemented here.

`policy.mjs` encodes and verifies an Along-specific signed device-permission
policy. This is not a normative Reality2 format. Its fixed domain binds the
application, group, pinned application owner, credential identifier, policy
revision, credential generation and explicitly permitted device identities.
The caller must establish the expected owner/group/credential and current
revision/generation floors independently of the received message.

The canonical UTF-8 JSON array has exactly those fields in a fixed order.
Identities are lowercase fixed-length hex, counters are canonical unsigned
64-bit decimal strings, and the sorted grant list contains at most sixteen
unique members. Verification refuses alternate encodings, extra fields,
wrong-owner signatures, unexpected context and replay against the supplied floor.
An empty list is an explicit removal of every device grant. Verification returns
immutable public policy data; it does not deliver a credential or establish
current membership, global freshness or permission on its own.

Run the focused synthetic-signature checks:

```sh
node experiments/at-credentials/policy.test.mjs
```

Passing checks cover real Ed25519 signatures, explicit grant/removal, context and
counter binding, malformed/cross-application messages, and caller mutation while
crypto is pending. Durable policy acceptance, local owner establishment,
encrypted storage and request-time checks are described below. Device delivery,
removal propagation, user-facing rotation and contextual UI integration remain.

## Durable policy acceptance

`openCredentialPolicyStore` binds a storage view to caller-established group,
owner and credential identifiers. It does not learn a new owner from a message.
`establish` is an explicit first-policy path; ordinary `update` refuses an absent
or damaged local record. Both revalidate signatures, and updates require higher
policy revisions and nondecreasing credential generations. Stored signatures are
checked again on load. IndexedDB revision comparison prevents concurrent writers
from overwriting the winning update. A saved-policy result is a commit receipt,
not a lasting access grant.

The real Chromium/IndexedDB check passes for initial establishment, update refusal
on absence, replay and generation regression, racing updates, removal of all
grants, cancellation before/after commit, damaged saved signatures and a fresh
document reopening the policy. Run with `R2_BROWSER_DIR` pointing to the verified
R2 browser directory and the browser environment described in the pairing notes:

```sh
node experiments/at-credentials/policy-store.test.mjs
```

This stores public policies only. It does not establish the owner's authority,
check current TG standing, prevent rollback of an entire browser profile, or
implement credential storage/delivery. Those remain required before public use.

## Initial application owner (experimental)

`establishLocalATOwner` derives the application owner from the actual verified
local member and signs an initial policy with that member's held key. It atomically
commits the owner pin and policy, with read-only transaction checks on the persona,
membership and installation evidence. The runtime must explicitly support those
checks; older runtimes refuse. No persona or membership record is rewritten, and
this does not change TG claim state or make the application owner a TG issuer.

Real-browser checks pass for own-member pinning, granting only that member,
existing-owner refusal, older-runtime refusal, membership changes before commit,
and interruption between policy and pin writes. Failed operations leave neither
an orphan policy nor a partial owner pin. The R2 transaction-check dependency
passed its full local verification; this controller is not loaded by the public app.
The encrypted local record and request-time checks below build on this owner pin.
An explicit local live-information UI and authenticated device delivery remain
to implement.

## Local encrypted AT-key record (experimental)

`openLocalATVault` binds access to caller-established group/owner/credential
identifiers, the saved owner pin, a verified local member, held membership and
installation evidence, and the latest locally accepted signed device grant.
Owner-only saves encrypt the supplied AT string with AES-GCM and a fresh nonce
under a generated nonextractable AES wrapping key. Associated data binds Along,
owner, group, credential, local member, generation and the policy revision at save.
The write transaction checks all evidence revisions without rewriting them.
Replacing a key requires a higher signed credential generation.

Reads validate ciphertext metadata and recheck every evidence revision after
decryption. A newer policy for the same credential generation can change grants;
an older encrypted generation is never returned under a newer generation.
Buffers are cleared where JavaScript permits, but returned strings and browser
engine internals cannot be promised erased. The trusted direct AT client must
cancel pending work and clear live caches when credentials or permissions change.

The initial browser check passes with synthetic keys for encrypted save/use,
private wrapping-key export refusal, ciphertext damage, generation advancement,
replacement, fresh-document reopening and permission removal during decryption.
Run `node experiments/at-credentials/local-vault.test.mjs` with the same R2/browser
environment as `local-owner.test.mjs`. The transaction-check runtime dependency
passed its full local gate.

This is software browser custody, not hardware-rooted sealing and not protection
against arbitrary same-origin script or browser-profile rollback. It stores no TG
issuer/traffic key and makes no claim of globally fresh offline membership. Peer
delivery, local UI consent, public provider-client integration and wider race/
cancellation checks remain before public enablement. No real AT key was used.

## Direct provider adapter (experimental)

`createVaultATClient` connects the local vault to the existing fixed-endpoint AT
client. It reads credentials only for explicit online requests, rechecks access
after the provider response, and suppresses results after observed local removal,
rotation, cancellation or loss of connectivity. Each read has its own client;
there is no shared feed cache that could bypass a later permission check. Cancel
aborts current reads; close also prevents future reads. The timeout covers both
credential checks and the provider request. The adapter retains no key for later
requests, although JavaScript strings cannot be reliably erased.

This is a transport boundary, not the contextual presentation layer. The caller
must still apply Along's verified journey/stop/service-date matching before
showing a feed. Revocation cannot undo a request already sent to AT, and only
locally accepted membership/policy information is known. Device-delivered policy
updates, public UI lifecycle wiring and real provider verification remain open.

Run `node --test experiments/at-credentials/live-client.test.mjs` for simulated
provider checks covering opt-in, offline refusal (including during credential
retrieval), fixed endpoints, removal, rotation, simultaneous-request closure,
reusable cancellation and timeout. `local-vault.test.mjs` additionally exercises
the adapter with actual WASM identity, signed policy and IndexedDB encryption:
removal during a simulated response suppresses that result and prevents another
request; an explicitly signed restored grant permits a fresh request. These
checks pass with synthetic credentials only. Nothing here is shipped publicly.

## Local consent screen (experimental)

`showCredentialSetup` presents a password field and a full-width “Save key on this
device” action, with a separate Back action. It explains offline planning,
encrypted local storage and direct AT use. Saving does not contact AT or grant
another device access. Its enclosing flow must first establish the application
owner and provide that owner's vault; this screen does not create authority.

The input clears when saving or leaving, errors remain generic, and a saved
receipt is labelled as unverified with AT. Back/Escape cancels pending work; a
late completion cannot overwrite a replacement screen. A commit which already
completed is not undone by leaving. The enclosing settings flow must reread saved
state when reopened instead of assuming cancellation proves nothing was saved.

`credential-view.test.mjs` passes keyboard save/focus, validation, generic failure,
input clearing, cancellation, replacement, full-width actions, axe and narrow
enlarged-text checks. It also saves a synthetic key through actual WASM identity,
signed owner policy and the encrypted vault. Run with the R2/browser environment
used by `local-vault.test.mjs`. This is not a TalkBack, physical-device or real AT
validation result. The screen and its CSS remain excluded from the public build;
the enclosing setup/settings flow and device-delivery consent remain unfinished.

On opening, the consent screen now calls the vault's `inspect` method before
showing the field. Inspection returns only a local status and whether this owner
may save: missing, replacement needed after a newer signed generation, saved but
unverified with AT, or unavailable. Saved status requires successful local
decryption and current locally held authorization; damaged ciphertext is not
advertised as usable. Evidence and secret revisions are checked again before
reporting status. No key is returned to the screen and no provider is contacted.
This is a point-in-time local observation, not continuing permission to use a key.

Browser checks cover these states, cancellation, removed grants, reopening a
saved key, and an old asynchronous inspection completing after its screen has
been replaced. An unreadable or unauthorized state never exposes an overwrite
action. This does not implement owner recovery or provider-side key rotation.

## Restoring the local owner binding

`loadLocalATOwner` reopens a previously established own-device application owner
under a caller-established group. It verifies the current local persona, held
membership, installation evidence, owner pin and signed policy, then rechecks
their revisions. It returns the public binding only; the vault still checks
authorization on each use. It does not adopt a peer's owner or initialize missing
state. Missing pins return null; damaged or inconsistent saved evidence refuses.

Real-browser checks pass for fresh-document restoration, read-only behavior,
wrong owner/group, malformed credential identifiers, damaged or absent policy,
cancellation and concurrent anchor changes. The consent-screen integration now
opens its real vault through this restored binding. Recovery of deleted state,
ownership transfer and consenting to another device's owner remain separate work.

## Combined settings flow

`showATSettings` now joins verified owner restoration, explicit first-owner setup
and the credential consent screen. The enclosing device flow supplies an already
established group; this controller does not silently create a device identity.
Opening settings is read-only. When no owner pin exists, a trusted user action
establishes the local owner before displaying the key field. Existing owners go
through restoration and vault inspection. Failures offer Back, never automatic
replacement. Back/Escape cancels the parent and child views; late asynchronous
results cannot replace a successor screen.

`settings-view.test.mjs` exercises keyboard setup, actual WASM owner signing and
encrypted key saving, Back, reopening without owner rewrites, unreadable storage,
replaced views, axe and enlarged narrow text. Use the same browser/R2 environment
as the other browser tests. All keys are synthetic. This combined flow remains
experimental and is not linked from public Along; device discovery, peer delivery,
freshness policy and integration with contextual journey requests remain open.

## Owner policy actions

`updateLocalATPolicy` signs explicit grant changes and optional credential-generation
advancement using the restored owner's actual member key. Callers supply the policy
revision they reviewed; a stale review cannot silently overwrite newer choices.
The write also checks owner, persona, membership and installation-evidence revisions
atomically. It refuses missing state rather than establishing a replacement owner.
The returned policy-saved receipt reflects the actual commit, including cancellation
which arrives after that commit completed.

The browser test covers grant snapshots, removal of every grant, refusal of local
key reads after removal, generation advancement and encrypted replacement, stale
reviews, changing owner evidence, malformed grants, cancellation and concurrent
reviews. Application ownership remains distinct from a device's permission to use
the key: the verified owner can restore grants after removing its own read access.
Run `owner-policy.test.mjs` with the same browser/R2 environment as the vault tests.

A newly added peer grant now requires its certificate to pass the real membership
runtime against the owner's held group/epoch/revocation evidence. Certificate
inputs are copied before asynchronous work. Existing grants can be retained or
removed without presenting certificates again; retention does not refresh their
membership. The owner's own identity is independently verified during signing.
Tests refuse missing evidence, invalid signatures, wrong subjects and a valid
certificate from another group. A positive peer-grant test uses real WebCrypto
signatures and the core certificate verifier under a synthetic issuer fixture;
it does not establish production issuer custody or peer possession.

A device ID in this policy is not a TG membership proof. Authenticated delivery
must still verify the recipient's current held membership and explicit grant.
Advancing Along's generation does not invalidate a key at Auckland Transport.
The owner review UI, provider-side rotation guidance and peer delivery remain open;
these checks use synthetic keys and do not contact AT.

## Credential delivery message

`delivery-message.mjs` defines an Along application message, not an R2 normative
format. Its owner signature covers the whole message: a domain tag, fresh request
nonce, exact recipient, canonical signed policy and credential bytes. Verification
uses caller-pinned group/owner/credential, policy floors and request context, and
requires the recipient's explicit device grant. Lengths are exact and bounded;
the largest supported policy and key fit the peer channel's application limit.

These bytes contain plaintext secret material. They belong only inside the
encrypted, mutually authenticated owner/device channel, never in invitations,
logs, browser caches or feedback. A signature authenticates this payload; it does
not encrypt it. Temporary internal buffers are cleared where possible, but the
returned packet and decoded string remain the trusted caller's responsibility.

`node experiments/at-credentials/delivery-message.test.mjs` passes real-signature
checks for binding, tampering, missing grants, floors, malformed lengths, maximum
sizes and asynchronous input mutation, using synthetic credentials. This codec
does not consume a nonce, establish owner trust, check fresh peer possession or
install a credential. A matching packet can still be verified twice: the pending
request must be consumed atomically with receiver installation. The local
installer below handles that storage boundary; the channel adapter and
end-user device-sharing flow remain unfinished.

## Atomic receiver installation (experimental)

The vault now supplies `prepareDelivery` for an already pinned owner and locally
accepted granting policy. It verifies the owner's certificate against held
membership, creates a fresh request nonce and saves its pending journal with
evidence revision guards. The returned handle expires after a bounded local
interval, supports cancellation, and is superseded by a newer request. It does
not resume a pending request automatically after a browser restart.

Installation verifies the signed message for that exact request, local member and
accepted policy. It rechecks owner membership, encrypts under a fresh local
wrapping key and atomically writes ciphertext plus the consumed request record.
Changed authority/policy, a superseded nonce or an existing same/newer credential
generation refuses. The actual completed commit wins over late cancellation.

`receiver-install.test.mjs` passes signed-message installation, encrypted reopening
in a fresh document, consumed-journal persistence, invalid owner evidence, replay,
competing installs, interruption between writes, cancellation before/after commit,
supersession and changed policy revisions. Existing vault/settings/owner checks
also pass after sharing the encryption helper. Tests use a self-recipient fixture
and synthetic keys: they do not prove distinct-device transport or owner-consent
bootstrap. Channel integration, receiver owner consent,
policy delivery/freshness and the full device-sharing flow remain unfinished.

## Owner send and distinct-member transport check

`sendOwnerCredential` loads the actual local owner, verifies the peer certificate
and explicit grant, retrieves the current encrypted key, and signs the delivery
message. Before sending it rechecks the connection, peer standing and the held
owner/policy/membership revisions. The trusted session controller must supply the
group and peer actually bound to that connection; a caller-provided object is
not a security capability. A `sent-unconfirmed` result does not imply receiver
storage or acknowledgment. The temporary message buffer is cleared after send.

`peer-delivery.test.mjs` passes with two distinct nonextractable browser member
keys, separate IndexedDB stores, actual mutual peer authentication and a direct
WebRTC channel. The recipient consumes its request and encrypts the received key
under its own browser wrapping key. Removing its owner-side grant prevents a
further send. No relay, STUN, TURN or real AT request is used in this check.

The test runs on one browser host. Its issuer and reviewed descriptor remain
synthetic fixtures; receiver policy acceptance now uses the checked operation
below. The user-facing setup workflow remains incomplete. This evidence extends the earlier self-recipient storage checks
to distinct members and an encrypted transport, but does not establish physical
device reachability, automatic discovery, policy freshness after partitions,
durable issuer custody, recipient acknowledgments or public release readiness.

## Receiver owner acceptance

`acceptRemoteATOwner` supplies the explicit receiver-side acceptance operation.
The trusted connection controller supplies the reviewed group, owner and credential
binding independently of the incoming policy. The operation checks the authenticated
connection, owner certificate, local persona and signed grant, then atomically saves
the owner pin and policy with local evidence revision guards. Existing owner state
is never replaced by this first-acceptance path. Cancellation follows the actual
transaction outcome. No credential is stored by accepting the owner.

The distinct-member WebRTC test now uses this operation instead of directly writing
receiver pins. It passes refusal of invalid signatures, mismatched credentials,
wrong owner certificates, a valid signed policy lacking the local grant, cancellation,
interrupted writes and repeated acceptance; then it installs the delivered key.
The issuer and reviewed descriptor are still fixtures. The consent screen below
uses this operation; descriptor exchange, removal propagation and reconnect
freshness remain open.

## Receiver consent screen

`showRemoteOwnerConsent` now presents the checked acceptance path after the
trusted pairing flow has selected the owner. It explains encrypted local storage,
direct optional AT use and the limits of receiving access changes. A full-width
allow action is separate from Back; technical identity details are expandable.
The screen snapshots the reviewed binding and evidence, waits for connection
authentication, and invokes acceptance only on trusted user activation. Back,
Escape, disposal and connection loss prevent a pending choice from silently
continuing. Leaving does not undo a commit that already completed. Completed
acceptance says the key has not arrived yet.

The WebRTC test now drives this screen with actual keyboard input before key
delivery. Back without acceptance, synthetic-click refusal, completion focus,
200% text on a narrow viewport and axe checks pass. The test then continues through
signed delivery and encrypted receiver installation. It is still a one-host test
with a synthetic issuer and reviewed descriptor; no physical TalkBack check or
public integration is claimed. The enclosing descriptor/discovery flow and
connected-device settings after acceptance remain unfinished.

## Reopening on a receiving device

Remote acceptance now saves the verified public owner certificate alongside the
owner pin. `loadATBinding` restores either an owner or recipient role, checking
the saved policy and, for a remote owner, the certificate against held membership.
It rechecks storage revisions before returning. `loadLocalATOwner` remains the
owner-only wrapper used by signing/sending operations; a recipient cannot use it
to obtain owner controls. Missing remote-owner evidence refuses rather than being
silently repaired or adopted from a message.

Settings now use this role-aware restore. A received key can be shown as saved
after reopening in a fresh document without exposing a key-entry or setup action.
A recipient awaiting its first key or a replacement is directed to reconnect,
rather than being told that its saved settings necessarily failed. This is local
evidence only: it does not establish globally current access after a partition.

The distinct-member browser test passes recipient-role restoration, refusal of
owner-only restoration and missing certificate evidence, and fresh-document
settings reopening. Owner, policy and consent/settings regression checks pass.
The enclosing reconnect/discovery flow, policy propagation and public activation
remain unfinished; older experimental pins without certificate evidence refuse.

## Received policy changes

`applyRemoteATPolicy` accepts updates only for an existing recipient binding and
the owner selected by the authenticated session controller. It revalidates the
saved owner certificate and local evidence, verifies the policy signature and
strictly increasing revision, and guards the update transaction against changed
owner/persona/membership/installation records. It never initializes missing trust.
A removal need not grant the receiving device: refusing such policies would
prevent the very update which removes access. `policy-update-message.mjs` supplies
bounded, exact framing for this public signed policy without credential bytes.

The WebRTC test now transmits removal and later regrant policies between distinct
members. Received removal stops local key retrieval, suppresses an in-flight
simulated AT result and prevents another provider request. Wrong-peer, invalid
signature and replayed updates refuse; a newer explicit grant restores access.
The framing check passes malformed-length, domain, bounds and byte-copy controls.

This establishes behavior after a verified update is locally saved. It does not
make an offline device aware of an unseen removal, invalidate a copied AT key,
or implement automatic policy catch-up and freshness after reconnect. The test
uses synthetic credentials/provider responses and fixture issuer/descriptors.

## Delivery acknowledgment

The owner send result remains `sent-unconfirmed` and now includes immutable public
context for the expected acknowledgment. After its installation transaction has
committed, the receiver handle can sign a public saved receipt. It checks the
consumed request and matching encrypted record, signs with the current local
member identity, and rechecks both storage revisions. A pending or failed
installation cannot produce this receipt through the handle.

`delivery-ack.mjs` binds the receipt to group, owner, credential, recipient, request
nonce, policy revision and credential generation. The owner verifies the exact
expected bytes and recipient signature before reporting `recipient-confirmed-saved`.
The session controller must consume its outstanding acknowledgment context; the
codec alone does not prevent a caller from verifying the same bytes twice.
No secret, key digest or continuing access grant is included.

The actual WebRTC test now returns and verifies this acknowledgment after receiver
installation. `delivery-ack.test.mjs` passes wrong-context, wrong-signer, tampering
and input-snapshot checks; receiver tests distinguish committed from interrupted,
cancelled and superseded installations. This is a recipient's authenticated report
of a local commit, not proof of hardware sealing or resistance to physical power
loss. The durable sender journal below preserves the latest result;
receipt recovery over a fresh authenticated session is described below; public
status presentation remains unfinished.

## Durable sender status

`openDeliveryHistory` stores the latest public delivery context per credential and
recipient. The owner records `pending` before attempting the network send; that
state does not prove the packet was sent or stored remotely. Only a matching,
recipient-signed acknowledgment can change it to `recipient-confirmed-saved`.
Confirmation uses revision comparison, so an old receipt cannot overwrite a newer
pending request and concurrent confirmations cannot both commit. Reopening a
confirmed record verifies its signature again. No credential bytes are stored here.

The owner sender and WebRTC test now use this journal, including confirmation
reopening in a fresh document. `delivery-history.test.mjs` passes unsolicited,
tampered, stale and replayed receipt refusal, concurrent confirmation, cancellation
and stored-signature corruption checks. These are historical delivery facts,
never current grants or evidence of provider acceptance.

## Recovering a lost acknowledgment

`vault.recoverAcknowledgment(context)` can recreate a public receipt after the
recipient document reopens. It requires the exact consumed request journal and
matching encrypted record, signs with the restored local member, and rechecks
storage revisions before returning. It neither decrypts nor rewrites the key,
and does not grant or restore permission to use it.

The receiver test verifies recovery in a fresh document, unchanged secret storage,
and refusal for a wrong nonce, missing journal, cancellation or a record changing
during recovery. The WebRTC test deliberately drops the first acknowledgment,
checks that the owner remains pending, closes both connections, then authenticates
new sessions with the restored identities. `delivery-recovery.mjs` sends the
owner's persisted pending context in a bounded, versioned request through that
new channel. The recipient checks the actual controller-supplied peer against its
pinned owner and answers from its consumed journal; the owner verifies and commits
the reply through its delivery history. The key is not sent again.

Tests also refuse malformed/trailing request bytes, zero generation, an unrelated
peer, an unmatched nonce, a closed connection and recovery of an already confirmed
record. The request is public context carried by the authenticated session, not
an independently signed authority or permission to use the key. The runtime
controller must supply actual authenticated peers, rather than trusting payload
identifiers. Existing grants need not be restored to acknowledge historical storage.

This is a one-browser-host test with synthetic issuer and manually exchanged
connection descriptions. User-facing recovery, automatic discovery/signaling,
physical-device reconnection and reconnect policy catch-up remain open.

## Sending policy after reconnect

`sendOwnerPolicy` restores the actual local owner, reads and verifies its saved
policy, checks that the owner pin and policy revisions remain unchanged, and sends
that signed policy on the controller's authenticated connection. Its result is
`policy-sent-unconfirmed`; sending alone does not establish receipt. This sends
public policy even when the remote device's AT grant has been removed, so that
device can learn about its removal. No credential is included.

The receiver can explicitly use `acceptUnchanged: true` for reconciliation.
Byte-identical signed policy is accepted as `policy-unchanged` after checking the
stored policy and local binding evidence again, without a storage write. Newer
policy still uses the existing atomic guarded update. Older policies, invalid
signatures and different contents at the same revision remain refused. Ordinary
update calls retain their strict increasing-revision rule.

The authenticated WebRTC test covers identical policy without rewriting storage,
removal delivery to an ungranted recipient, identical removal without restoring
key access, refusal of an older grant and subsequent explicit regrant. This is
reconciliation machinery, not automatic reconnect scheduling or a live-access
freshness gate. A controller must still order catch-up before contextual provider
requests; no persisted freshness lease or independent challenge-bound owner
confirmation is claimed. Physical-device and public interface checks remain open.

## Policy check before a recipient's live request

`policy-sync.mjs` provides a bounded request/reply exchange on the authenticated
owner connection. Each check uses a fresh random nonce, consumes one matching
response, reconciles its signed policy through the pinned owner, and supports
cancellation, connection loss and timeout. Previous or unsolicited replies cannot
complete a newer check. The trusted session controller routes policy-check frames;
the response binds its nonce through the authenticated channel, not a separate
portable signature or durable freshness certificate.

`createVaultATClient` accepts `synchronizePolicy`, which runs before key access or
provider I/O. Recipient wiring supplies `policySync.check`; locally owned keys do
not need a remote owner check. Failure returns unavailable and preserves the
scheduled experience. The existing post-fetch key/access recheck still suppresses
results when a locally received removal or rotation invalidates them.

The actual WebRTC test confirms a successful provider read after policy catch-up,
then removes the grant on the owner without pushing it. The next recipient read
learns the removal through this exchange, saves it, and makes no further provider
request. It also refuses a previously consumed response, an old nonce during a
new check, and cancellation. Provider responses and keys remain synthetic.
Separate live-client tests cover ordering, synchronization failure and cancellation
before key access. The restoration test explicitly regrants access afterwards.

This experimental recipient mode requires its owner to be reachable for each
live request; there is no persistent lease. Only one check runs at a time per
synchronizer; overlapping requests fail quietly and can be retried. This does not
solve discovery, remote connectivity, owner availability, or the interval between
an owner response and a subsequent owner-side change. Public app wiring and
physical-device tests remain incomplete; offline timetable planning is unaffected.

## Owner device-access review

`showOwnerDeviceAccess` presents one selected member's AT access as a focused
allow/remove decision. The trusted device-selection flow supplies the member and
certificate; a friendly name is display text only, with the exact identity under
an expandable detail. Full-width action and Back buttons use the pairing styles.
The view restores actual owner authority, displays the saved policy, and commits
only against that reviewed revision. The existing policy updater verifies current
membership evidence for a new grant. A recipient cannot use this view as an owner.

Only a trusted user activation changes access. Back, Escape, replacement and
disposal cancel pending work. Completed text distinguishes a local permission
change from key delivery or receipt of removal by the other device, and explains
that removing a grant does not invalidate a copied key at AT. No network send is
performed by this view.

The WebRTC browser scenario now grants and removes through real keyboard use of
this view. Checks include Back without a write, ignored synthetic clicks, focus
return, 320px layout at 200% root font size, axe checks, and refusal of a stale
review after another policy change. The initial run found lost keyboard focus
when disabling the action; focus is now captured before disabling it. Real
TalkBack, physical-device operation, device selection and public integration
remain unverified/incomplete. Provider key rotation has no user-facing flow yet.

## Replacing the owner's key

Experimental owner settings now offer **Replace AT key** when a saved key can be
opened. Recipient settings do not expose that action. The review explains that
continuing stops use of the previous key locally, while changing/revoking a key
at AT and delivering a replacement to other devices are separate operations.
Back before confirmation leaves the current key unchanged.

A trusted confirmation updates the reviewed signed policy to a new credential
generation, preserving device grants, then opens the existing encrypted key-entry
flow. If the user leaves after that policy commit, reopening settings asks for the
replacement; it cannot resume using the old-generation key. Saving the replacement
does not claim provider verification or delivery to other devices. The action
cannot be repeated from missing/replacement-needed settings to keep incrementing
generations instead of finishing entry.

The actual storage/settings browser test covers keyboard confirmation, ignored
synthetic clicks, Back before and after the policy commit, reopening the
replacement-needed state, saving a synthetic replacement at generation 2, and
320px enlarged-text/axe checks. Existing credential consent and authenticated peer
tests also pass. This is still experimental browser UI; no real key was used,
no AT subscription was changed, and public/physical-device verification remains.


## Issuer fixture replaced by software custody

After the user selected the browser-only R2 subset, the peer test switched from
an in-memory synthetic issuer to `software-persona.mjs`: create, persist, close
storage, reopen and load the actual encrypted issuer, then issue the recipient
certificate. The recipient bootstrap and reviewed descriptor remain fixtures;
this is not yet full enrollment or physical-device pairing. Earlier references
to a synthetic issuer describe the previous test arrangement. AT keys and provider
responses remain synthetic, and the public app still excludes these modules.


## AT sharing after actual recipient enrollment

`peer-delivery.test.mjs` now creates the recipient through the actual core
candidate ceremony instead of editing its stored persona, bootstrap and membership
records. The restored software issuer's member signs the invitation challenge;
the issuer derives the bundle and signs the newly generated candidate member key.
The sessions compare, install, exchange an installation acknowledgment and close.
The recipient store reopens and restores its consumed enrollment before the
existing AT owner/recipient consent, encrypted delivery, acknowledgment recovery,
policy catch-up and removal checks run. The original group-of-one member key is
not reused as the enrolled member key.

The test still supplies the initial target-group trust decision, matching
comparison approvals, connection descriptions and reviewed AT owner descriptor.
It runs on one browser host with synthetic AT credentials/provider replies.
These remaining boundaries must become a usable device-selection and pairing
flow; traffic-key persistence is also unfinished. This connected test does not
enable public live data or establish physical-device reachability.


The actual-enrollment AT scenario now opts into encrypted software traffic-key
persistence as part of the candidate installation transaction. The dedicated
enrollment test covers reopening those keys and rollback of an interrupted write.
Earlier traffic-key-persistence limitations describe the previous increment;
epoch rotation, invitation/device UX and physical connectivity remain open.


### Standalone lab integration

The [pairing lab](../tg-pairing/README.md) now mounts `showATSettings` from a
restored real software identity. Its built-bundle test pairs two devices, uses the
enrolled identity for explicit AT-owner setup, saves a synthetic key, reloads and
restores it. The test checks encrypted storage and no external requests. This is
local credential setup only; cross-device delivery and contextual provider reads
are not connected to that lab screen or the public app yet. Lab testers use dummy
text, not a real AT key.


### Restored-settings provider adapter

`saved-client.mjs` exposes `createSavedATClient` for the eventual contextual app
integration. It restores the accepted owner/credential binding for each explicitly
requested read, verifies it again after policy synchronization, and opens the
existing encrypted vault. It accepts no key or owner identifier from a feed.
No credential storage is read when the caller has not requested live data or the
browser is offline. Closing cancels pending operations; no feed is retained.

A local owner can use its own saved key. A recipient without an owner-policy
synchronizer is refused before provider I/O. The enclosing controller must supply
an authenticated policy-sync session for the exact binding passed to the callback;
the callback is a trusted application dependency, not proof by itself. Parallel
feed reads serialize their fresh checks because the policy protocol permits one
outstanding nonce per session. They do not share a cached authorization lease.

The real-peer browser test now exercises this adapter with actual saved owner and
recipient identities, encrypted synthetic credentials and authenticated policy
exchange. It checks local-owner use, no implicit request, offline storage silence,
missing-synchronizer refusal without fetching, simultaneous predictions/alerts,
queued cancellation, and learning owner removal before another provider request.
Provider responses are mocked. These checks do not enable public live information
or establish physical-device reachability.


### Saved-owner connection controller

`policy-session.mjs` now composes saved identity restore, authenticated peer
transport, nonce-bound policy exchange and `createSavedATClient`. A recipient
cannot supply a replacement peer ID: the controller derives the owner from its
previously accepted AT binding and checks that binding on each read. The owner
selects an existing group member; the peer session authenticates the member key.
The controller accepts only policy-check messages for its role and closes with
the peer or caller signal. It does not enroll, grant access, transfer an AT key,
or create an authorization lease.

The real-peer browser check creates fresh owner/recipient controllers from the
stored records, exchanges their connection descriptions and authenticates both.
Parallel predictions/alerts each receive an actual owner reply before mocked AT
I/O. It checks recipient owner-substitution refusal, wrong-role refusal, no fetch
merely because the connection authenticated, discovery of owner removal before
another fetch, and loss of provider access when the owner connection closes.
Manual signaling and physical-device reachability remain separate work. This
controller is still experimental and is not loaded by the public journey app.


### Contextual stop updates

`stop-live-view.mjs` adds an explicitly requested live-information region beside
the enclosing screen’s scheduled board. It snapshots that stop’s verified rows,
uses Along’s existing dated-trip, stop-sequence and alert-scope matchers, and
renders only matching results. Predictions are labelled expected; cancellations
and skipped stops have distinct wording. Old results expire without another
request. Neither schedule data nor ordering is changed. The client receives only
feed kinds and explicit consent, not stop IDs, addresses or journey objects.

The dedicated browser check covers keyboard activation, synthetic-click refusal,
wrong dated trips and unrelated alerts, untrusted text rendering, expiry,
navigation during a pending request, unavailable fallback, narrow text zoom and
axe. The real-peer credential test also mounts this view with `openATPolicySession`
and clicks its button: real saved identities, authenticated owner policy replies
and encrypted synthetic-key access precede mocked AT predictions. This joins the
UI and credential checks, but does not claim a real provider response or public
app integration. The journey component below now shares that lifecycle; the vehicle component below now covers the corresponding map lifecycle.


### Remaining-journey updates

`journey-live-view.mjs` snapshots only the selected itinerary’s remaining legs.
It passes verified boarding calls to the existing departure matcher and all
remaining timed calls to the journey-alert matcher. Completed legs and walking
connections do not become live departure requests. The panel has no live-check
action once no public-transport legs remain. The enclosing flow must remount it
when advancing a leg; replacing a panel cancels and suppresses late results.

Stop and journey panels share the explicit-request, text rendering, cancellation
and expiry implementation. Scheduled itinerary objects are never modified or
reordered. `stop-live-view.test.mjs` covers a mixed bus/train/ferry journey with
prediction, cancellation, skipped boarding stop, intermediate-stop alerts,
completed-leg exclusion, zoom and axe checks. The real-peer test also clicks the
journey panel through `openATPolicySession`, verifying both provider reads follow
authenticated owner checks. Credentials and provider feeds remain synthetic;
these components are not yet mounted in the public journey app.


### Selected-service vehicle position

`vehicle-live-view.mjs` owns one reported-position marker on the enclosing
Leaflet map. It snapshots the selected dated trip and uses the existing strict
vehicle matcher; a route number alone never selects a vehicle. Its explicit check
passes only the feed kind to the client. The panel labels the report time and,
when verified stop coordinates are supplied, distance from the nearest stop in a
straight line. It does not describe the position as an arrival prediction.

Expiry, another check, disposal and unavailable results remove only that marker.
The scheduled route remains. No basemap tiles, location permission or periodic
requests are introduced. Dispose the view before removing its enclosing map.

`vehicle-live-view.test.mjs` checks the actual Leaflet layers with synthetic feeds:
matching position, different service date, stale GPS timestamp, duplicate matches,
expiry, delayed response after navigation, narrow zoom and axe. The real-peer test
also clicks this view and checks an actual marker after authenticated owner policy
exchange and encrypted synthetic-key access. Provider data remains mocked; the
public route screen still needs this experimental controller/view wired in.


### Actual journey-app integration build (local only)

`scripts/build_experimental_app.py` creates a separate generated tree under
`releases/along-experimental-app/`. It follows the required runtime/module imports,
copies the existing journey app and public datasets, and changes only that copy’s
live-client import to `app-live-bridge.mjs`. The normal public build is untouched.
The experimental worker uses a separate cache prefix and includes the runtime
modules for offline reopening. It does not delete the public app’s shell cache.
Every generated payload is hashed in `build-info.json`; no test or credential file
is copied. **Do not publish this build yet:** matching runtime source/compiler provenance
to the collected notices remains pending. The owner has selected MIT for the
included R2 subset. The builder now requires the notice collection described in
[the audit](../../docs/PAIRING_LICENSE_AUDIT.md) and includes it in the output.

```sh
python3 scripts/build_experimental_app.py --browser "$R2_BROWSER_DIR" --wasm "$R2_WASM_DIR"
node experiments/at-credentials/app-integration.test.mjs
node --test experiments/at-credentials/app-live-bridge.test.mjs
```

Serve the generated root locally and visit its `public/` URL. The entry links to
its `experiments/` device/key setup. Use dummy text only. Bootstrap restores that
lab’s accepted local identity and AT binding without creating an identity,
decrypting a key or requesting provider data. Each app screen owns a cancellable
client. Missing or unreadable state leaves scheduled planning enabled.

The generated-app test performs visible first-use/key setup, address search and
a Newmarket–Devonport bus/ferry journey. Clicking the actual journey live button
uses the saved encrypted synthetic key in fixed direct AT requests intercepted
by the test. It checks no startup request or displayed key, then offline reopening,
a second address-to-address route and an unavailable live check without a provider
response. Offline mode also aborts the provider mock so interception cannot bypass
the simulated disconnection; an uncached local request must fail as well. In this
Chromium check `navigator.onLine` remained true: two attempted mock requests were
aborted, and the app still fell back quietly. This does not establish zero request
attempts under every kind of network loss. Bridge checks cover late responses after context change and separate
screen cancellation. This is a local-owner path; shared-key owner-session
reconnection still needs its app interface. Physical devices, real provider feeds
and installed-app update behavior are not established by this build/test.


### Optional startup cannot hold the planner indefinitely

The experimental bootstrap checks for a saved local identity before compiling
WASM and bounds restoration to three seconds. Missing/unreadable settings or an
expired deadline leave live access unconfigured while scheduled planning starts.
A late storage handle is closed, and every later restore step checks cancellation
before it can configure a client. Fetch/compilation may still finish internally;
a timeout is not a claim that the browser cancelled those operations.

The generated-app test holds the optional WASM response indefinitely, completes
an actual bus/ferry search without it, then releases it and confirms live access
stays disabled. It also advances the actual test IndexedDB schema beyond the
runtime’s supported version: the planner starts, no lab record write is attempted,
and the database version and record count remain unchanged. No reset or migration
is inferred from unreadable state. Normal key setup/provider-mock and offline
routing checks continue to run in the same test.

### Reconnect screen for existing AT-key sharing

`showPolicyConnection` in `policy-connection-view.mjs` composes the saved-owner
controller with the existing public-message copy/paste and optional QR controls.
The recipient restores its accepted owner; the owner checks the request against
its saved group, owner and credential binding before opening a peer session.
The incoming member identifier is a routing hint, then authenticated by the
runtime. Reconnection neither enrolls a device nor grants or delivers a key.

After authentication, a trusted press of **Use this connection** passes the
controller synchronously to `onConnected`. The parent then owns it and must close
it when finished. Disposing the completed view does not close that transferred
controller. Back/disposal before handoff closes its resources; a late restore
cannot replace the next screen. The owner must remain open while recipient
requests check its current permission. Provider reads still require explicit
contextual user action and a fresh owner-policy exchange.

`peer-delivery.test.mjs` now exchanges reconnect messages through these visible
controls after actual enrollment and encrypted synthetic-key delivery. It checks
wrong-owner refusal, cancellation during restoration, synthetic-click refusal,
320px/200% reflow and axe, controller survival after view disposal, contextual
stop/journey/vehicle checks, and removal before further provider I/O. The harness
copies the messages on one browser host; provider responses are mocked. QR camera
use and real phone/desktop reachability are not established. This view is not yet
wired into the full application's Settings or public release.
