# Saved-journey capacity recovery

Status: generation model, signed-checkpoint verifier and guarded durable
preparation implemented and tested in source. The preparation browser check uses
a synthetic custody adapter. No installation, network adoption or recovery control
is enabled. Public
preview 3805 retains its existing 256-pair replication limit and capacity message.

## Why deletion alone cannot free space

The current replica retains the last value or deletion for each address pair.
Deleting that record locally would allow an older snapshot to restore the value.
The bounded outbound-journal compaction in 3805 is different: it coalesces edits
that have not started importing and keeps their final deletions.

Recovery therefore needs a deliberate new sharing generation. This is an Along
application protocol, separate from R2 traffic-key epochs and AT-key replacement.
It must not recreate identities or silently remove application permissions.

## Implemented model

`generation-state.mjs` wraps the current journey model with format 2, a numeric
generation and a checkpoint digest. Initial migration uses generation zero and a
zero digest, preserving every entry and logical clock. Shape validation alone is
not authority to adopt this state from a peer.

Normal merges require the same generation and checkpoint digest, including for
two independently signed successors of the same predecessor. Different or older
generations require recovery; a larger number never wins automatically. Ordinary
same-generation edits retain the current deterministic merge rules and bound.

`checkpointSnapshot` only proposes the currently live entries. It neither changes
the supplied state nor touches storage. More than 256 active saved pairs remains
an active-data capacity problem: a review must preserve excess places locally and
explicitly choose what to share, or a separately validated protocol must expand
that bound. Tombstone compaction does not solve excess active data.

## Signed evidence

`generation-checkpoint.mjs` uses a 120-byte statement:

| Field | Bytes |
| --- | --- |
| Along domain `ALNJCP01` | 8 |
| Group authority public key | 32 |
| From generation, unsigned big-endian | 8 |
| To generation, unsigned big-endian | 8 |
| Previous signed checkpoint SHA-256, or zero at generation zero | 32 |
| Canonical snapshot digest | 32 |

A 64-byte Ed25519 signature follows. Generation numbers must be safe JSON
integers below `Number.MAX_SAFE_INTEGER` and exactly consecutive. The snapshot
digest is SHA-256 of the UTF-8 domain `along/journey-checkpoint-snapshot/v1:` followed
by the JSON encoding returned by strict format-1 state validation. That validation
sorts entries and projects fields consistently; checkpoint snapshots contain no
tombstones. The next generation's checkpoint identifier hashes the full signed
184-byte message.

Verification binds the chosen group authority, exact predecessor, successor and
complete snapshot. It copies mutable inputs before asynchronous work and returns
a proposed next state. It does not establish current membership, consent, durable
installation, global freshness or protection against browser rollback. Authorized
members can deliberately save a journey again; this protects against stale
snapshot resurrection, not malicious actions by a permitted member.

## Durable preparation

`checkpoint-preparation.mjs` retains one signed proposal in
`along-prepared-journey-checkpoint-v1`, keyed by group and successor generation.
Its caller must supply a custody-scoped signer, a current-authority check and
nonempty revision guards. It checks the exact current format-2 replica and revision,
validates its own signature, and uses a transaction guarded by the replica and
custody revisions. It rereads and authenticates the committed winner before
returning it. It never returns a provisional checkpoint or advances the replica.

A retry within the same generation returns the retained snapshot, even if later
local edits changed the replica. Those edits remain in the replica; installation
must archive and review them rather than treating the retained proposal as a fresh
copy of current data. Cancellation after commit cannot erase the preparation.
Corrupt retained evidence refuses instead of being silently overwritten.

`node experiments/journey-sync/checkpoint-preparation.test.mjs`, with
`CHROMIUM_PATH` set, checks real IndexedDB concurrency, reload, later local edits,
pre/post-commit cancellation, custody revision races, corrupt stored signatures,
bad signing output and storage failure. It uses real Ed25519 signatures but a
synthetic custody record/check, so it does not prove integration with the actual
software issuer or its membership/permission checks.

## Required before integration

1. Bind the tested preparation adapter to the actual software issuer, current
   membership and removal evidence. Verify its custody checks and guards through
   real enrollment, key rotation, cancellation and permission changes.
2. Review the live places selected for the new generation. Keep the old replica,
   local saved places and unprocessed edits in a durable recovery record. Do not
   silently replace divergent local data or reinterpret old edits as new saves.
3. Atomically install the verified successor and recovery record, with revision
   guards on persona, membership, application permission and prior generation.
   Tie journal import receipts to the generation so crash retries cannot cross it.
4. Stop old-generation sessions and require ordered checkpoint catch-up. An old
   peer's ordinary snapshot must never establish or replace a generation. New
   peers need authenticated current-checkpoint acquisition as well as membership.
5. Offer a clear review of retained local differences before reapplying chosen
   edits. Cancellation keeps local planning usable. A missing checkpoint or lost
   issuer must explain what can be recovered without suggesting storage clearing.
6. Verify storage faults, concurrent tabs, interrupted installation, replay,
   offline edits, removal and confirmation loss through the actual app. Then
   qualify the exact build and its upgrade path before publishing a new preview.

## Evidence

`node --test experiments/journey-sync/generation-checkpoint.test.mjs experiments/journey-sync/state.test.mjs` checks a full tombstone set, recovered
capacity, refusal of old snapshots/replay/skips, same-generation convergence,
every-byte signature tampering, changed snapshots, wrong authority, conflicting
successors, caller mutation, migration and bounds. These are model/cryptographic
checks in Node, not browser custody, persistent recovery or end-to-end acceptance.
