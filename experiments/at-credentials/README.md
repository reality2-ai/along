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
crypto is pending. Durable public-policy acceptance is described below. Still required: owner establishment,
current TG standing, storage encryption, request-time authority, device delivery,
removal propagation, rotation and the contextual live-client integration.

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
