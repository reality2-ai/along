# Browser-subset group epoch rotation

Status: transition framing and signature verification implemented and unit tested.
No rotation control or installation path is enabled, including in preview 3803.
This is an Along application profile using the R2 group authority; it is not a
claim of a normative R2 rotation wire format or full R2 conformance.

## What the existing implementation establishes

The pinned browser membership verifier accepts an explicitly established epoch
and validates certificates against it. It does not authorize an epoch advance
from an incoming certificate. Signed revocations remain terminal across epochs.
Along's initial software persona, issuer certificate issuance and enrollment
material currently use epoch zero. Restoring traffic material requires its epoch
to match both the local persona and membership state.

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

1. The issuer must prepare exactly one durable successor with fresh traffic keys,
   a signed transition and renewed certificates for retained members. Concurrent
   requests must reuse the same prepared successor, never sign conflicting keys
   for the same epoch. Keep prior removals. Guard issuer and membership revisions.
2. A reviewed, authenticated recovery exchange must deliver material only to
   retained members, including those still on an older epoch. The current peer
   handshake requires equal current epochs, so it cannot simply be reused after
   the issuer advances. A signed newer certificate alone is insufficient proof
   that the recipient controls its member key. Bind a fresh challenge, recipient,
   transition and encrypted delivery; recheck removal before releasing keys.
3. The recipient must verify the ordered transition chain, renewed certificate,
   exact key digest and local predecessor. Commit persona, membership, encrypted
   traffic material and durable installation receipt in one guarded transaction.
   The initial issuer needs this same consistency. Do not reset identity, journey
   preferences or AT application permissions to work around a mismatch.
4. Close old sessions across tabs when advancement commits. Resume interrupted
   delivery using durable receipts, and distinguish local advancement from every
   retained device acknowledging it. Refuse conflicts without replacing state.
5. Test removal during preparation/delivery, competing rotations, offline catch-up,
   replay and forks, crash boundaries, mixed-version devices and fresh-document
   restoration. Verify ordinary offline routing throughout. Only then expose the
   contextual rotation/recovery controls and qualify a new public preview.

Browser software custody still does not resist hostile same-origin code or a
restored copy of old browser storage. Local epoch checks are not hardware-backed
rollback protection or proof that no newer update exists on another device.
