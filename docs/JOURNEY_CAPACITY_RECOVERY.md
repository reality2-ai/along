# Saved-journey capacity recovery

Status: generation model, signed-checkpoint verifier and guarded durable
preparation implemented and tested in source, including the real software issuer
adapter. Atomic format migration and local checkpoint installation also pass
browser tests. No network adoption or app recovery control is enabled. Public
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

## Real issuer adapter

`loadSoftwareIssuer().prepareJourneyCheckpoint({expectedRevision})` now reads the
format-2 replica directly from the issuer's group. It refuses a stale review
revision and supplies the internal signing closure, existing live-custody check,
and revision guards for encrypted issuer custody, bootstrap, local persona,
membership and journey-sharing permission. Absence of a permission record is also
guarded; creating that record during preparation is a change, not a free pass.
No general signing key or arbitrary signing operation is exposed to the UI.

`experiments/tg-pairing/epoch-preparation.test.mjs`, using the pinned runtime,
checks real software initialization/custody, concurrent preparation, restoration
in a fresh document, retention across group-key rotation, stale review refusal,
old/closed/cancelled issuer handles and a permission creation during the actual
preparation commit. It verifies that the journey replica does not advance.
This is not yet a recipient adoption or complete enrollment/recovery-flow test.

## Atomic format migration

`generation-migration.mjs` is an explicit local operation with a reviewed legacy
replica revision. It verifies local membership and atomically writes three records:
the format-2 generation-zero replica, an archive of the exact prior replica and
its import receipt, and a format-2 marker in the legacy replica slot. Migration
preserves all values, tombstones and logical clocks; it does not reclaim capacity.

The legacy-slot marker matters for an older app: its strict format-1 parser
refuses the marker. A write already in progress loses its compare-and-swap because
the legacy revision changed. Keeping the old slot writable alongside a new replica
would instead allow silent divergence. The source replica remains in the archive;
localStorage saved places and pending edits are untouched.

Persona, membership, bootstrap/enrollment evidence, application permission and
import-receipt revisions guard the transaction. An interrupted transaction rolls
back all three records. Concurrent or reloaded retries confirm an existing
migration without rewriting it, and cannot reinterpret a different review revision
as approval. An empty replica can migrate without inventing an import receipt.

`generation-migration.test.mjs` runs these boundaries with real software identity,
WASM verification and IndexedDB, including an in-flight old writer and permission
changes. The issuer preparation test now uses this migration for its primary
fixture before preparing a checkpoint. The migration tests currently initialize
the group issuer; enrolled-device migration still needs composed verification.
No installed app invokes migration yet. Enabling it before the format-2 bridge,
review and network handling are ready would intentionally stop legacy sharing.

## Planner journal bridge

`generation-app-store.mjs` now imports the existing local journal into an already
migrated replica, under the same per-group Web Lock as the legacy bridge. It never
migrates, trusts an incoming checkpoint or changes the active generation itself.
Generation-zero import can consume the receipt archived during migration without
reapplying an operation committed just before the old document stopped. A new
format-2 receipt records operation ID, generation and checkpoint with the replica
in one IndexedDB transaction. Corrupt receipts refuse rather than silently replay.

Both the queue and each new operation carry a generation/checkpoint marker.
Unmarked legacy operations are only eligible in generation zero. Changing the
queue marker cannot relabel an older operation. Compaction keeps operation markers
and refuses mixed-generation tails; it does not promote their edits. The planner
preferences writer retains these optional markers but ordinary format-1 behavior
remains the default in the installed app.

The migration browser test now runs the bridge after real migration and reload.
It checks archived-receipt deduplication, queued deletion, retained local learning
counts, interruption between IndexedDB commit and local journal consumption,
corrupt receipt refusal and old/untagged edits after a fixture generation advance.
The advance is deliberately a storage fixture, not authenticated installation.
The existing two-tab legacy bridge/compaction test also still passes.

The future checkpoint installer must use the same Web Lock, archive the current
local journal/differences, and install a matching new-generation import receipt.
It must not merely replace the replica and leave an old receipt or relabel an
old queue. The installer below now handles the durable cutover while preserving localStorage;
the local-difference review remains unimplemented. The
format-2 bridge is not mounted by the app and its use is not public qualification.

## Atomic checkpoint installation

`checkpoint-installation.mjs` takes the exact reviewed replica revision and local
preferences string, plus the signed checkpoint and its snapshot. Under the same
per-group Web Lock as the journal bridge, it verifies current local membership,
the exact signed successor and unchanged review inputs. A guarded transaction
writes the new replica, a matching generation-specific empty import receipt, and
`along-journey-checkpoint-recovery-v1` containing the old replica, old receipt,
reviewed local preferences, signed checkpoint and snapshot.

The installer never writes localStorage. Existing saved places and pending edits
remain available, including edits made while the IndexedDB commit is in flight.
They are not silently retagged for the new generation. The result explicitly
requires local review; the new bridge refuses the old journal until that separate
review/cutover is completed. This avoids pretending that IndexedDB and localStorage
form one atomic transaction.

A retry authenticates the retained checkpoint/snapshot and confirms the matching
current generation and receipt without rewriting them. Cancellation after commit
can report an interruption, but cannot undo durable installation. A retry restores
that result. This is local installation evidence, not confirmation from a peer.

The migration browser suite now also composes real issuer preparation and local
installation. Cases include concurrent retry, reload, a damaged retained snapshot,
permission changes during commit, an interrupted real transaction, stale replica
or local-data review, altered signature, cancellation after commit and a local edit
arriving during commit. Every pre-commit refusal preserves the old replica and
leaves no partial receipt/recovery record. Local preferences remain unchanged by
the installer itself. Enrolled-device and app-flow acceptance are still pending.

Installation can free active-replica tombstone slots; retained recovery records and
checkpoint history still consume browser storage. No archive-deletion policy is
implemented, and a failed storage write must preserve the previous generation.

## Local-difference review model

`checkpoint-review.mjs` now verifies retained checkpoint evidence against the
installed generation and builds a read-only comparison. It combines the prior
replica, current locally saved projections and final pending operations. A final
pending operation must agree with the visible local saved state; inconsistent
copies are refused rather than guessed. Old unmarked operations are only valid
for the original generation. Learning counts, hours and mobility preferences are
not included in the shared comparison or resulting changes.

Every difference requires an explicit local/shared choice. A local deletion is a
real option, not an absent value that defaults to a save. Shared entries unknown
to the previous local state remain in the installed dataset. Resolving choices
simulates the result against the actual replication bound, so it cannot silently
trim entries or expand capacity. Inputs and editable display copies cannot alter
the captured decision model. No storage write occurs.

The review identifier binds the captured current state, predecessor, signed
checkpoint, actor and exact local data. It is not an authorization token. The
future writer must rederive the review from current guarded records and compare
its identifier before accepting choices. A screen or caller holding an older
model cannot authorize overwriting a newer local edit merely by returning its ID.

`node --test experiments/journey-sync/checkpoint-review.test.mjs` checks changed
service preferences, local-only saves, retained deletions, explicit shared choices,
unknown peer additions, malformed choices, corrupted evidence, wrong generations,
inconsistent pending data, changing review input and full-replica refusal. These
are model checks; the accessible review screen and durable application of the
chosen differences remain unimplemented.

## Required before integration

1. Wire the tested migration and format-2 bridge to explicit reviewed opt-in,
   and verify enrolled-device migration. The installed app still uses format 1.
   Never use an arbitrary peer snapshot as authority.
2. Review the live places selected for the new generation. Keep the old replica,
   local saved places and unprocessed edits in a durable recovery record. Do not
   silently replace divergent local data or reinterpret old edits as new saves.
3. Connect the tested installer to reviewed issuer/recipient flows and verify
   enrolled-device installation, authorization changes and session invalidation.
   Finish the separate local-difference review without relabelling old edits.
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
