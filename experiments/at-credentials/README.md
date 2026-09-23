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
crypto is pending. Still required: owner establishment, atomic policy acceptance,
current TG standing, storage encryption, request-time authority, device delivery,
removal propagation, rotation and the contextual live-client integration.
