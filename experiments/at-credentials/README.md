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

A device ID in this policy is not a TG membership proof. Authenticated delivery
must separately verify the recipient's current held membership and explicit grant.
Advancing Along's generation does not invalidate a key at Auckland Transport.
The owner review UI, provider-side rotation guidance and peer delivery remain open;
these checks use synthetic keys and do not contact AT.
