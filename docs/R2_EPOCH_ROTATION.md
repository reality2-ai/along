# Browser-subset group epoch rotation

Status: transition framing, signature verification, encrypted durable preparation
and atomic issuer/recipient installation implemented and tested, including two
successive issuer advances. No composed rotation flow is enabled, including in
preview 3803.
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
it does not yet establish binding to a real recovery WebRTC connection, mutual
authentication, encrypted recovery delivery or installation through that flow.

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
