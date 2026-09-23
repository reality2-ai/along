# Along AT credential policy — implementation contract

This describes the implementation contract. The public app still uses downloaded
schedules and does not store or share AT keys.
The owner performs no coding; the AI implements and verifies this contract.
The [signed-policy experiment](../experiments/at-credentials/README.md) now checks
owner signatures, explicit grants and context/revision binding with synthetic
material. Durable policy acceptance additionally checks signatures on reopening
and rejects replay, generation regression and conflicting concurrent writes.
The isolated experiment also has encrypted local storage, consent/settings screens,
owner restoration and signed grant/rotation actions. New peer grants require
certificate validation against locally held membership evidence. These components
are not a deployed access-control system or completed device-delivery flow.

## Separate authorities

An authenticated TG member proves a device identity under held group evidence.
It does not automatically have permission to receive an AT credential. Along
needs an application-specific owner and an explicit list of authorized devices.
The application owner is also distinct from the TG issuer: the ability to sign
an Along policy does not permit issuing TG membership or undoing TG revocation.

For a new local Along credential, the person explicitly chooses to save their own
AT key. That action binds the initial application owner to the current, verified
local member identity. It must not accept an owner identity proposed in an incoming
message. Adding a device requires local owner confirmation, verified same-group
membership, and a signed policy update naming that device and the specific grant.
The receiving device must have the owner binding established by the confirmed
connection; a payload cannot nominate its own trusted owner.

| Action | Required authority |
| --- | --- |
| Save a person's first AT key locally | Explicit local action and verified current local identity |
| Read it for a contextual AT request | Current local device grant for Along and this credential generation |
| Deliver it to another device | Current owner policy grants that exact verified peer access; authenticated same-group session |
| Add/remove a device grant | Signature from the pinned application owner and increasing policy revision |
| Replace a saved AT key | Explicit owner action, increasing credential generation and updated signed policy |
| Change application owner | Separate confirmed ownership-transfer protocol; refuse until implemented |
| Issue TG membership or revoke TG membership | TG authority; an Along policy cannot substitute |

A successful recovery receipt, matching comparison code, certificate alone,
or inclusion in saved-journey sync is insufficient for any credential grant.

## Stored record and request boundary

Credential records belong in a separate Along-only storage scope, bound to the
application identifier, group, pinned application owner, credential identifier,
policy revision and credential generation. Encrypt secret bytes with fresh
nonces and bind those public fields as authenticated associated data. Do not use
TG issuer or traffic keys as an application wrapping key.

A browser-generated nonextractable wrapping key is software browser custody;
it must not be described as hardware-rooted sealing. Storage encryption cannot
protect against arbitrary script running with the app's origin privileges.
The implementation must identify its actual protection and its restart behavior
before presenting a “remember this key” choice. It must not silently fall back
to plaintext, base64, localStorage or an embedded shared key.

The direct AT client receives a credential only for its fixed provider endpoints
and a current contextual request. Cancellation, disablement, local grant removal
or generation change must invalidate pending retrieval and cached live results.
Never include keys in URLs, logs, feedback, journey exports, analytics, exception
text, service-worker caches or screenshots. Tests use synthetic credentials.

## Removal, rotation and offline behavior

A removed device receives no later credential generations or policy authority.
Local receipt of a valid removal clears usable local access and cancels live
work. Offline peers cannot know an unseen removal: do not report globally fresh
authorization from old local evidence. The implementation must define and test
its freshness/reconnection policy before enabling key delivery.

TG revocation cannot recall an AT key already copied by a device. After a lost
or compromised device, the person must rotate the key with AT; Along can then
distribute the replacement only to retained authorized devices. Replacing the
local record is not proof that AT invalidated the old key. Preserve downloaded
routing and saved journeys throughout removal, rotation and provider failures.

## Evidence required before public enablement

Verify explicit owner establishment, refusal of ungranted same-group members,
wrong-group and wrong-owner refusal, record substitution, older policy and
credential replay, authenticated device delivery, restart, concurrent updates,
cancellation, offline refusal/fallback, device removal and provider-key rotation.
Exercise the actual contextual client, not just an isolated decrypt call.

The existing initial-persona, enrollment and recovery checks establish useful
prerequisites. They do not satisfy this contract. First-use TG issuer custody
across restarts, usable device discovery and the complete application-secret
lifecycle remain outstanding. See [the integration status](REALITY2_INTEGRATION.md)
and [the experiment notes](../experiments/tg-pairing/README.md).
