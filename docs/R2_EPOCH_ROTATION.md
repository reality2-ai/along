# Browser-subset group epoch rotation

Status: transition framing, signature verification, encrypted durable preparation
and atomic issuer/recipient installation implemented and tested, including two
successive issuer advances. Owner review, device selection and recovery are connected in the local
experimental app Settings. Pinned AT-owner certificate renewal is implemented;
two-profile post-rotation shared AT and journey exchanges now pass. None
of this rotation UI is enabled in public preview 3803.
This is an Along application profile using the R2 group authority; it is not a
claim of a normative R2 rotation wire format or full R2 conformance.

## What the existing implementation establishes

The pinned browser membership verifier accepts an explicitly established epoch
and validates certificates against it. It does not authorize an epoch advance
from an incoming certificate. Signed revocations remain terminal across epochs.
Along bootstraps at epoch zero. After explicit installation of a prepared epoch,
issuer certificate issuance uses that epoch and enrollment material comes from
its installed traffic keys. Restoring traffic material requires its epoch to match
both the local persona and membership state. The next candidate's visible pairing
flow now binds enrollment to the verified inviter epoch.

Changing only `membership.current` would strand the local persona and stored
traffic material. Reusing the old traffic keys would also fail to exclude a
removed device that already holds them. Replacing the AT subscription key is a
separate operation at the provider; group rotation cannot recall copied AT keys.

## Verified public transition

`experiments/tg-pairing/epoch-transition.mjs` defines a bounded 152-byte message:

| Field | Bytes | Meaning |
| --- | ---: | --- |
| Domain | 8 | ASCII `ALNGEPC1` |
| Group | 32 | Established Ed25519 group authority |
| From | 8 | Current epoch, unsigned big-endian |
| To | 8 | Exactly `From + 1`, without overflow |
| Key digest | 32 | SHA-256 of domain `along/software-epoch-keys/v1`, payload key, then integrity key |
| Signature | 64 | Group authority's Ed25519 signature over the preceding 88 bytes |

Verification requires the caller's already established group and current epoch.
It rejects substitutions, skipped epochs, replay after advancement, overflow,
truncation and trailing bytes. Caller arrays are copied before asynchronous work.
Digest calculation erases its temporary key-containing buffer, leaving the caller
responsible for the original key arrays. Verification returns public evidence
only: it neither writes storage nor authorizes installation.

Node WebCrypto tests cover each changed message byte, authority/context mismatch,
epoch bounds, role-specific key digests and asynchronous input mutation. These are
format/cryptographic tests, not browser custody, transport or rotation evidence.

## Remaining implementation and acceptance boundaries

`loadSoftwareIssuer().prepareRotation()` now prepares fresh traffic keys, a signed
transition and the issuer's renewed member certificate. It stores the candidate
under `along-prepared-epoch-v1` with an AES-GCM non-extractable wrapping key. The
transaction guards issuer custody, bootstrap, persona and membership revisions.
Concurrent callers may construct temporary candidates, but only the committed
winner is returned; retries authenticate and reuse its encrypted material. No
key bytes are returned and membership remains at its old epoch. Corrupted retained
state is refused, never silently replaced.

The real Chromium/IndexedDB test verifies concurrent preparation, a fresh-document
restore, corrupted certificate/transition/ciphertext refusal, failed writes,
concurrent custody change, early cancellation and cancellation after commit.
A late cancellation reports uncertainty while leaving the committed preparation
available to a later retry. Existing issuer/enrollment/removal tests also run.
This is software custody evidence, not completed rotation or key delivery.

`installPreparedIssuerEpoch()` requires an explicit target and a retained encrypted
preparation. It verifies issuer custody and uses the same atomic installation
boundary, guarding the preparation and issuer records as well as bootstrap state.
The browser test advances through epochs one and two, restores in a fresh document,
checks failed/interrupted writes and explicit-target retry, and verifies that an
old issuer handle refuses further operations. Current enrollment material uses
the newly installed keys and refreshes the issued-device certificate. Removal
accepts authentic older certificates and signs at the current epoch; previously
removed recipients remain excluded. This is local advancement, not peer delivery.

`installRecipientEpoch()` now checks the established group, signed transition,
renewed certificate for this recipient and the digest of both supplied traffic
keys. It retains signed removals, then atomically updates the persona certificate,
membership epoch, encrypted traffic material and a public installation receipt.
The transaction guards the consumed enrollment journal and each replaced record.
An exact duplicate verifies the installed material and returns the retained result
without rewriting; conflicting or substituted material refuses. The API snapshots
and erases its temporary key copies. A cancellation after commit cannot turn the
committed result into a claim that nothing was saved.

`EPOCH_INSTALL=1 node experiments/tg-pairing/software-enrollment.test.mjs` first
enrolls an actual recipient over the existing WebRTC flow. A test fixture then
supplies a renewed certificate and keys from the real prepared synthetic issuer.
It checks substitution refusal, transaction rollback, signed removal during the
commit race, retained earlier removals, duplicate receipt recovery, invalidation
of the old persona signing handle and a fresh-document epoch-one restore/sign.
The same check now opens two authenticated old-epoch WebRTC connections, one in
the installing tab and one in a sibling tab. Both close after commit and refuse
later sends. A notification without a stored change leaves the sessions open.
The fixture does not establish production delivery or issuer advancement. The
installation API is not mounted in the app.

`epoch-watch.mjs` is mounted at the shared local-persona session boundary used by
journey sharing, AT-key connections and receipt recovery. It re-reads established
local group/member/epoch state on an installation notification and on page wake
events. Notifications contain no key material and cannot advance state. The
installer announces successful commits and verified duplicate receipts; the
installing document waits for its local checks. BroadcastChannel wakes sibling
tabs where available, without claiming acknowledgment from them. Suspended tabs
cannot promise immediate delivery; existing runtime checks still compare epoch
and membership before protected send/receive operations. Read failures close the
affected session rather than preserving a cached grant.

## Pairing after local advancement

The next candidate uses `along-browser-invitation-v2` and
`along-browser-proof-v2`. The public descriptor carries a canonical unsigned epoch.
The recipient's proof check requires the inviter's group-signed certificate to be
current at that exact epoch, plus the fresh nonce proof for the reviewed invitation.
The epoch field alone is not evidence. The provisioner also refuses to answer an
invitation created before its own advancement. Both sides pass the checked epoch
to enrollment rather than substituting zero. Prior v1 messages refuse, with an
instruction to update both devices and create a new invitation.

`ROTATED_ISSUER=1 node experiments/tg-pairing/pairing-flow.test.mjs` advances the
issuer, refuses its stale invitation and then completes the visible pairing flow
over actual WebRTC. The acknowledged recipient restores epoch-one keys. The
ordinary enrollment check still covers epoch zero, and additionally rejects an
authentic epoch-zero certificate/proof paired with a substituted epoch-one
descriptor, v1 proof downgrade and malformed epoch values. Invitation review has
keyboard, narrow-screen and automated accessibility coverage. These checks do not
establish the recovery transport for already-enrolled devices on older epochs.

## Recovery-only possession check

`epoch-recovery-proof.mjs` now provides a bounded, verifier-owned challenge for
an enrolled device with an older certificate. The issuer must still be current;
the peer certificate must be authentic, older and not revoked against the issuer's
held membership. The 152-byte Along statement binds domain `ALNGERC1`, group,
issuer member, recovering member, both epochs and a 32-byte connection transcript.
A fresh 16-byte nonce uses the runtime's canonical nonce signing bytes. Challenges
are single-use, cancellable and expire within one minute with a use-time check.

The requester reconstructs the statement from its local enrolled identity, saved
inviter, epoch and caller-supplied connection transcript. Verification uses the
actual core nonce verifier at the older certificate's epoch solely to check this
recovery proof. Before and after verification, the issuer checks its current epoch
and the peer's current removal status separately. A historical certificate is
never promoted to a general current-member grant. A successful result is not a
continuing key-release permission; delivery still needs fresh checks.

The composed enrollment test advances the issuer to epoch two while the recipient
remains at epoch one. It verifies possession, rejects statement/transcript changes,
nonce replay, cancellation and expiry despite delayed timers, and rejects removal
between challenge issuance and response. This test uses fixture transcript bytes;
that proof-only fixture does not establish a real connection or key delivery.
The separate transport check below covers mutual authentication.

`epoch-recovery-session.mjs` now composes the proof with the actual direct WebRTC
link. The older device answers a fresh member challenge bound to the link's SDP
transcript. It issues its own nonce; the issuer answers a separate `ALNGERO1`
statement using its current group-certified member key. Both identities and epochs
remain bound to the same transcript. A ready exchange completes mutual checking.
Malformed/out-of-order frames, identity/epoch changes and held removal evidence
close the connection. Cancellation and a use-time handshake deadline also apply.

The browser check authenticates epoch-one and epoch-two devices over real WebRTC,
rejects a forged issuer proof sent on that connection, rejects a different saved
issuer and bad member certificate, and verifies both ends close after removal.
These low-level checks transfer SDP on one host; physical reachability and discovery
are separate. This session exposes no arbitrary application-payload method.
Its authenticated state is recovery context, not permission to use an AT key or
an assertion that the older member has current application membership.

The owner session now exposes a local `recoveryMaterial(epoch)` operation only
after mutual authentication and only for its bound peer and epoch range. It loads
the retained encrypted preparation, verifies its transition, issuer certificate
and key digest, and produces a renewed recipient certificate. Current issuer
custody, member removal status and preparation/membership revisions are checked
again before returning temporary key arrays. The caller must destroy those arrays
after use. The ordered delivery operation below owns this material while sending.

Browser tests retrieve distinct retained epochs, check current stored keys against
material returned by the real authenticated session, refuse requests before
authentication and from the recipient role, and refuse removed/out-of-range peers.
A removal inserted during actual AES-GCM decryption prevents return and the test
checks that the decrypted buffer was zeroed. This does not erase other previously
copied material or qualify browser memory as hardware-protected custody.

## Ordered delivery and acknowledgment

After mutual authentication, the recipient must explicitly call `acceptRecovery()`
through a trusted controller before the issuer's `recover()` can send key material.
The issuer sends one successor at a time over the authenticated WebRTC channel.
The recipient verifies and atomically installs it, then signs a receipt bound to
the group, member, exact epoch, transition/certificate digest and a fresh
issuer-supplied nonce. The issuer verifies the proof against retained removals and
saves it under `along-epoch-delivery-v1`, with membership/persona transaction guards.
Only that saved acknowledgment allows the next successor or a confirmation result.

The recovery session alone temporarily detaches its epoch watcher during its
expected installation so it can send the receipt. Ordinary sessions still close.
It restores checks against the new local epoch before replying. Each in-flight
step has a timeout and a use-time deadline. Concurrent recovery calls refuse.
Volatile key arrays are cleared after sending/installation; JavaScript strings and
browser-internal transport copies cannot be promised zeroed by application code.

The browser test now recovers epoch one → two → three across two profiles over real
WebRTC, checks both durable signed issuer receipts and recipient installation
records, and restores epoch-three keys/signing in a fresh document. It also checks
recipient acceptance, forged receipts, a transaction interrupted during key write,
no success claim after that failure, a subsequent successful connection and removal.
If the connection drops after the recipient's final installation but before its
acknowledgment reaches the issuer, both documents can reopen and authenticate at
the same nonzero epoch. After recipient acceptance, the issuer requests a fresh
signed receipt using its retained public transition and the peer's current
certificate. The recipient verifies its saved installation against its identity
and decrypted traffic keys through the duplicate-installation verification path.
It sends no keys and rewrites no installation record. Missing or corrupt records
refuse confirmation; the browser test corrupts the saved transition and verifies
refusal before restoring the fixture and successfully reconnecting. The test also
drops the actual final WebRTC acknowledgment, reloads both documents and verifies
recovery, unchanged installation revisions and zero key-delivery frames.

This confirms the final installed epoch. Reconnecting after partial catch-up starts
from the recipient's saved epoch; it does not reconstruct missing intermediate
receipts. The recipient review is implemented below; its visible signaling flow is described below, while app integration remains unfinished. A receipt is a signed peer claim,
not independent attestation of a hostile device's storage.

1. Compose certificate renewal for retained recipients with authenticated delivery.
   Release only the committed successor. Preserve
   prior removals and recheck recipient standing at delivery, rather than treating
   presence in a prepared list as an enduring permission.
2. A reviewed, authenticated recovery exchange must deliver material only to
   retained members, including those still on an older epoch. The current peer
   handshake requires equal current epochs, so it cannot simply be reused after
   the issuer advances. A signed newer certificate alone is insufficient proof
   that the recipient controls its member key. Bind a fresh challenge, recipient,
   transition and encrypted delivery; recheck removal before releasing keys.
3. Compose the tested local installation with ordered offline catch-up. Do not reset identity,
   journey preferences or AT application permissions to work around a mismatch.
4. Compose the tested session invalidation with issuer advancement and interrupted
   delivery recovery. Distinguish local advancement from every retained device
   acknowledging it. Refuse conflicts without replacing state.
5. Test removal during preparation/delivery, competing rotations, offline catch-up,
   replay and forks, crash boundaries, mixed-version devices and fresh-document
   restoration. Verify ordinary offline routing throughout. Only then expose the
   contextual rotation/recovery controls and qualify a new public preview.

Browser software custody still does not resist hostile same-origin code or a
restored copy of old browser storage. Local epoch checks are not hardware-backed
rollback protection or proof that no newer update exists on another device.


## Owner review screen

`epoch-rotation-view.mjs` reviews one explicit successor before calling the real
software issuer and atomic installer. Its heading asks whether to update group
keys; the text explains that other devices will need an update connection, local
journeys remain available, and an AT API key is a separate credential. It advises
removing an unwanted member before changing group keys. The primary action saves
on this device only. Success explicitly does not claim peer delivery.

The review binds the current member and epoch. If another operation advances the
keys while the screen is open, its old approval cannot create the next successor.
Back/Escape cancels pending work where possible; a completed atomic installation
remains saved, and a disposed view cannot overwrite the returned screen. Reopening
reads the actual saved version. Unreadable custody never recreates an identity.

`epoch-rotation-view.test.mjs` exercises the real encrypted issuer and installation
with trusted keyboard activation, synthetic-click refusal, Back/Escape,
fresh-document reopening, stale approval, pre- and post-commit cancellation,
obsolete asynchronous views, unreadable custody, 320px layout at 200% text size,
and axe checks. Physical screen-reader testing is still separate.

This screen is wired into local experimental Settings. The complete app permission flow
must be composed with the visible recovery connection before enabling it and qualifying a public preview. A signed
receipt must be verified before a device is labelled as having confirmed an update;
a saved membership certificate alone is insufficient.


## Verified confirmations in the device list

`readRecoveryReceipt` verifies a saved acknowledgment for an explicitly selected
device and key version without writing or decrypting traffic keys. It binds the
group, subject and epoch, verifies the signed transition against the owner's
retained preparation, and verifies the member certificate and fresh-nonce
signature under the currently held removals. Persona, membership, receipt and
preparation revisions are checked again before returning the result. Missing
receipts return no confirmation; damaged or changed records produce an error.

The source device-list screen uses this reader after a key update. It distinguishes
confirmed installation, no saved confirmation, unverifiable confirmation and
removal saved here. Each device button has its status as an accessible description.
The text says a receipt is not online status. An issued certificate alone never
becomes an installation confirmation. These are saved observations, not a live
roster or proof that a device has retained its data indefinitely.

The composed browser test uses the receipts from its actual WebRTC exchange,
checks the visible confirmed and certificate-only states, damages each signed
field in storage, changes a receipt during its read, and verifies removal replaces
the confirmation label. Reader checks also cover cancellation and prohibit writes.
Public preview 3803 is unchanged; this source UI awaits qualification with the
remaining recovery controls.


## Recipient recovery review

`epoch-recovery-view.mjs` reviews an already connected, mutually authenticated
recovery session. It shows the local and offered key versions and requires a
trusted action before accepting recovery. For equal versions it instead offers
to check the saved keys and send confirmation; that path does not replace keys.
The session's recipient-only `installation()` result resolves when the final
local installation has been verified. It does not assert that the owner received
or saved its acknowledgment. Closing before that result rejects the pending
operation; closing after a saved result does not undo the installation.

The success screen explicitly asks the user to check the other device's
confirmation. Back/Escape closes the session, preserves stored keys and prevents
late completions from changing an abandoned screen. A failed installation offers
reconnection with the saved data rather than resetting identity or credentials.

The actual two-profile WebRTC browser test now drives this screen with keyboard
acceptance, refuses synthetic clicks, cancels via Back before acceptance, checks
an interrupted transaction's failure screen, and distinguishes recipient success
from the owner's lost acknowledgment. After both documents reload, equal-version
confirmation is approved through the same review. Narrow 320px layout at 200%
text size and axe checks pass. Physical TalkBack is not established by these tests.

The earlier review checks supply signaling from the test harness. The visible
message exchange is now composed below and linked from local experimental Settings;
this does not enable a public recovery flow or change preview 3803.


## Device-message recovery flow

`epoch-recovery-flow.mjs` composes the actual transfer and recipient-review
screens. The owner selects a known device and provides a starting message with
signed removals. The recipient checks it against its saved group/inviter, merges
valid removals, opens a recovery-only session, and returns a request with its
current certificate, held removals and connection offer. The owner checks the
selected identity and exchange identifier, merges removals before opening its
session, and returns the connection answer. The underlying mutual proof binds
identities and epochs to the real WebRTC transcript.

Both sides must act: the recipient reviews and accepts; only then does the owner
see a send/confirm action. The owner reports success after its durable signed
receipt. The recipient reports its local installation independently. Messages
contain public identities, removal evidence and network connection details, not
traffic keys or AT credentials. The existing transfer component provides manual
copy/paste and QR controls; physical camera scanning is not proven by this test.

The composed browser test now copies the visible messages through their actual
text areas and buttons. It checks a mismatched reply identifier, equal-version
confirmation, delivery of a new fourth key version, separate completion results,
recipient acceptance without premature key delivery, signed-removal catch-up and
fresh-document restoration. It no longer injects SDP directly for these cases.
The earlier low-level failure tests still supply signaling directly.

Settings entry points are implemented locally. Renewed journey/AT permission
integration remains unfinished. This source flow is not yet deployed in public preview 3803.


## Local Settings integration and remaining permission work

Owner Settings now offers a reviewed local key update and, after the first update,
a device picker for sending keys or checking a saved confirmation. The picker
refuses removed/unverifiable members and opens the actual recovery flow for the
selected identity. Enrolled devices have a receive-update option even when their
original enrollment was already acknowledged. These controls stay under the
existing connection/recovery disclosure rather than the journey-planning flow.

An unreadable AT binding no longer prevents access to group recovery. The binding
is preserved and AT setup actions are withheld, rather than treating the failure
as an absent binding and offering to create a new authority. This matters when a
recipient retains an owner's old certificate after a group epoch change.

`GROUP_KEYS=1 node experiments/at-credentials/app-integration.test.mjs` runs against
the freshly generated local experimental app. It updates group keys through
Settings, opens the device picker, checks unreadable-binding preservation and
recovery access, then exercises personal encrypted AT-key setup, real local
bus/ferry planning, mocked direct AT requests, offline reopening, delayed optional
runtime and incompatible-storage preservation. The composed enrollment browser
test now enters the visible recovery flow through its actual device picker.

Journey permission records are keyed by stable member identities; the journey
connection obtains a fresh certificate from its incoming descriptor. Shared AT
restoration additionally checks the pinned owner's saved certificate for current
epoch membership. The renewal operation below replaces that certificate without
changing the pinned owner, credential identity, consent or policy. Shared-device AT and journey exchanges after rotation now pass the two-profile
checks below. Different-owner renewal is also verified below; full release qualification remains pending.
Only `along-experimental-app` was rebuilt; the qualified preview 3803 artifacts and
public deployments are unchanged.


## AT-owner certificate renewal

`owner-certificate.mjs` renews membership evidence for an existing pinned AT owner.
It verifies both the old and new certificates for exactly that owner and group,
requires the new certificate to match the local epoch and current held membership,
and verifies the existing signed policy. The transaction changes only the owner's
certificate, guarded by persona, membership, enrollment/bootstrap evidence, policy
and anchor revisions. It does not change consent, policy revision/generation,
credential identity or key bytes. Missing bindings are not initialized; local
owners need no remote-certificate renewal. Exact duplicate renewal is read-only.

The recipient recovery result now includes a copy of the public owner certificate
verified by the mutual recovery proof. After recovery, experimental Settings passes
that certificate into renewal and restores the binding. An error preserves the
saved AT state and does not turn successful group installation into a claim of
successful AT access. If the AT owner is a different group member from the group
issuer, this certificate does not match: it is refused rather than changing the
chosen AT owner. Renewal from that other member now uses its reconnect certificate, as described below.

The real two-profile enrollment/recovery test establishes an explicit AT-owner
binding and signed permission before rotation. After the visible update to epoch
four, the old certificate fails restoration. The certificate from the actual
completed recovery renews it, preserving the binding and signed policy bytes.
Wrong-subject, damaged, stale and cancelled renewal refuse, as do membership,
policy and enrollment evidence changed during the transaction. Exact retry does
not rewrite, and the restored binding loads in a fresh document. This does not yet
prove AT-key delivery/provider reads or journey exchange after rotation in the
complete app; those tests and release qualification remain required.


## Composed app evidence after rotation

The generated static app now passes both `ROTATE_GROUP_KEYS=1` variants:

- `MAIN_APP_SETUP=1 ROTATE_GROUP_KEYS=1 node experiments/at-credentials/two-app-integration.test.mjs`
- `ROTATE_GROUP_KEYS=1 node experiments/journey-sync/app-integration.test.mjs`

Both use real Settings enrollment, rotation, device selection and recovery. The AT
case waits for the actual Settings certificate-renewal callback rather than calling
the helper itself. Identities, pinned binding, signed policy and encrypted AT-key
bytes/revisions are unchanged, except for the group epoch and renewed certificates.
Both apps reload, reconnect, make the expected contextual mocked AT requests for a
bus/ferry journey, refuse subsequent requests after permission removal, and reopen
with offline routing. No real AT key or real-provider call is involved.

The journey case first shares saved places and service preferences. It then
rotates group keys, verifies unchanged permission records, reloads, makes offline
edits and reconnects. Copies converge using the saved permissions and fresh
membership certificates; removal, local-history preservation and offline planning
checks still pass. The tests transfer displayed public connection messages through
the visible controls. They do not establish automatic discovery or physical-device
reachability.

[Evidence and exact manifest/test hashes](evidence/group-rotation-app-checks.json)
identify the local build used. These checks do not qualify or deploy a new public
preview. Different-owner renewal is covered below. Remaining capacity/recovery cases,
physical acceptance and full release qualification remain.


## Reconnecting when the AT owner is a different device

The local AT reconnect profile is now `along-at-reconnect-v3`. Its starting owner
message includes the owner's current group certificate. Both devices need this
profile; the published preview 3803 uses v2 and is not changed by this work.

`loadATConnectionBinding` allows an authentic stale owner certificate solely to
recover the already pinned connection identity. Its result explicitly says owner
renewal is needed. It still verifies the saved policy, local identity, held
removals and unchanged storage evidence; revoked or invalid evidence refuses.
Provider clients, vault access and authenticated policy sessions continue to use
strict `loadATBinding`, which refuses stale owner evidence.

During reconnect, the recipient checks the exact saved group/owner/credential,
merges signed removals, and renews the certificate against its current group
membership before opening the strict AT session. A signature for another member,
a damaged certificate, a future/stale epoch or a removed owner cannot replace the
pin. Startup and device Settings expose the reconnect option for a verified stale
binding without enabling live reads or treating it as new AT setup.

`MAIN_APP_SETUP=1 ROTATE_GROUP_KEYS=1 DIFFERENT_AT_OWNER=1 node experiments/at-credentials/two-app-integration.test.mjs`
now passes with the enrolled device owning/sharing the AT key and the group creator
receiving it. After rotation, strict restoration refuses the old certificate while
connection review remains available. The visible reconnect refuses v2 downgrade
and a damaged certificate, accepts the current certificate, and completes shared
mocked AT reads, permission removal and offline routing. Identities, AT-key
ciphertext, signed policy and credential pin survive rotation/reload unchanged.
The standalone `peer-delivery.test.mjs` regression also passes.

[Exact local-build evidence](evidence/group-rotation-different-owner-checks.json)
records both checks. This remains one-host browser evidence, not physical-device
acceptance, real AT-provider verification or a new public preview release.
