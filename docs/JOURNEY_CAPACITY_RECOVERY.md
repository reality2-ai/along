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
the local-difference review and planner cutover are described below. The
format-2 bridge is now selected for ready migrated state in experimental Settings;
its use is not public qualification.

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
guarded writer must rederive the review from current records and compare
its identifier before accepting choices. A screen or caller holding an older
model cannot authorize overwriting a newer local edit merely by returning its ID.

`node --test experiments/journey-sync/checkpoint-review.test.mjs` checks changed
service preferences, local-only saves, retained deletions, explicit shared choices,
unknown peer additions, malformed choices, corrupted evidence, wrong generations,
inconsistent pending data, changing review input and full-replica refusal. These
are model checks; the durable decision stage below now applies the chosen
differences to the shared replica, with the separate planner cutover described below.

## Local-difference review screen

`checkpoint-review-view.mjs` presents one differing journey at a time, with
full-width local/shared choices and a final confirmation. Back retains selections;
leaving returns the draft choices to the owning flow without applying them. The
final screen checks the model's capacity limit and exposes the complete choice
summary on request. A pending write can be cancelled, but the screen does not
promise to undo an already committed write. Late callbacks cannot replace the
screen after leaving. Unconfirmed writes direct the user back to recovery to
check the retained result.

`checkpoint-review-view.test.mjs` checks keyboard focus, Back/Escape retention,
320px layout with 200% text, full-width controls, automated axe checks, capacity
refusal, empty comparisons, failed confirmation and completion after leaving.
The test uses a fixture writer: it proves presentation behavior, not persistent
recovery or physical screen-reader usability. The first run exposed a test-harness
issue (axe requires an explicit browser context); the corrected harness passes.
The screen is not mounted in the published app. The Settings integration below
now connects it to the real guarded writer; complete migration/installation and
peer recovery-flow tests remain required before publishing it.

## Durable recovery decisions

`checkpoint-choice-commit.mjs` implements the first storage stage. It reloads the
actual browser identity, membership, permission and recovery evidence, rebuilds
the review and requires the exact reviewed identifier and complete choices.
One guarded IndexedDB transaction commits the resulting replica, import receipt
and retained decision. The retained record includes the original replica, exact
local preferences, choices and resulting replica; retries reconstruct and verify
that decision rather than incrementing clocks again. Records use the review digest
as their key because concatenated group/review digests exceed the runtime key limit.

This operation never writes localStorage. Its result is explicitly
`journey-recovery-choices-committed` with `localReviewRequired: true`, which cannot
be mistaken for the review screen's completed-recovery result. An edit arriving
during the transaction remains in the planner. Cancellation after commit may
report an unconfirmed result; retry finds the retained decision. A later replica
change requires fresh review rather than replaying the retained decision over it.

The real runtime/IndexedDB migration suite now also checks concurrent and reloaded
decision retries, changed choices, stale local review, permission changes,
transaction abortion, late cancellation and a local edit during commit. The
initial run exposed the key-length constraint; the corrected suite passes.
The separate planner cutover below now implements the local replacement protocol.
No installed-app flow invokes these operations, and no archive pruning policy is
implied by retaining another recovery record.

## Planner cutover and cooperating writers

`applyCheckpointChoices` uses the same verified decision path and per-group Web
Lock, then replaces planner preferences only if their exact bytes still match
the reviewed copy (or the already-applied result). It preserves learning settings,
history and counters, projects the selected saved places/services, empties the
old pending journal and tags the new generation. It checks the written result
before returning `journey-recovery-applied-locally`. A failed local write leaves
the retained IndexedDB decision available for retry. A newer local edit is refused
rather than overwritten; recovery must build a fresh comparison for it.

The new `writePreferencesLocked` path requires the caller's original raw envelope,
uses that same lock and refuses stale input. Two real browser tabs with identical
starting data produce one accepted write and one refusal, retaining one correctly
tagged operation. The migration suite also checks failed local writes, cutover
retries, preserved history and refusal of newer local data.

This is a cooperating-writer protocol, not an atomic localStorage compare-and-swap.
The experimental builder now routes planner writes through the async adapter
described below. Older app tabs do not participate yet; excluding those writers
is required before mounting recovery. App UI, enrolled-device coverage,
peer/session integration and release qualification remain separate gates.

## Planner write integration

The generated experimental app uses `writePlannerPreferences`, which retains each
read snapshot through both in-place edits and immutable learning updates. Under
the shared lock, it refuses changed planner data or a changed generation. It
allows consumption of pending journal entries when the planner data and generation
remain identical; that bookkeeping must not make the next ordinary save fail.
The two-device integration test exposed this distinction during implementation.

Planner actions now await persistence before announcing success, temporarily
disable editing controls, refresh their stored view afterwards and show failures
on the current screen. The ordinary app still uses its original local writer;
the experimental builder substitutes the cooperating adapter. Source tests cover
stale snapshots, immutable learning, journal-only changes, generation changes and
storage failure. The generated app's two-profile sharing test passes, including
save/delete, service preferences, offline edits and focus preservation.

Validation also passed 11 journal/adapter tests and the core 68 JavaScript/18
Python checks. The initial 20-browser-test run passed; after the final focus and
status refinements, the targeted commute run exposed an existing five-second
offline route expectation while calculation was still in progress. It now uses
the route helper's 30-second budget; the complete guided journey passes. A new
forced-storage-failure browser check verifies visible failure, unchanged stored
data, an unsaved button state and restored button usability.

These changes do not exclude an already-open older build from writing the same
localStorage key. That upgrade boundary remains a release gate, alongside mounting
the recovery flow and qualifying a new preview. Public preview 3805 is unchanged.

## Isolating older planner writers

`isolated-preferences.mjs` now supplies an explicit storage primitive for that
boundary. A single localStorage write installs a new profile containing the exact
reviewed predecessor and the active planner data. An adapter exposes only the
active data to the existing planner API. It retains the predecessor on subsequent
writes and never falls back to the old key if the isolated copy is missing or
corrupt. Repeating the same isolation request preserves the current active data.

Older builds still write their original key. Those writes cannot accidentally
replace the isolated copy, and `inspectLegacy` reports divergence with both the
captured predecessor and current legacy bytes for a future explicit review. An
old write arriving during installation is also reported. No old key is deleted,
and neither old edits nor learning history are silently merged into the new copy.
This is upgrade isolation, not protection against hostile same-origin scripts,
browser rollback, storage eviction or a user clearing site data.

`isolated-preferences.test.mjs` verifies the released 3805 ZIP digest, manifest
digest and individual preference-module bytes before loading that actual old
writer in a second browser tab. The test verifies independent old/new service
preferences, predecessor retention, reload, concurrent/repeated installation,
quota failure, stale review, cancellation before/after installation, corruption
without fallback and an old edit during the write. It reads release bytes from
the archived ZIP, not the mutable local candidate directory.

The caller must still authenticate membership and complete reviewed generation
migration before requesting isolation. Creating the isolated profile is not yet
mounted in the app. Startup selection and format-2 bridge/recovery defaults are
connected below; storage-event handling, verified Settings lifecycle and review
of later legacy edits remain required before enabling recovery.

## Reopening and using the isolated profile

Envelope validation now lives in `preference-envelope.mjs`, avoiding circular
imports between storage selection and planner operations. The experimental planner
selects an existing isolated profile when reading preferences. The generation-aware
bridge and checkpoint installation/application use the same selector by default.
None creates isolation on startup. The old format-1 bridge keeps its old storage
binding and remains subject to the migrated IndexedDB refusal marker.

The real-runtime migration suite composes isolation with the default planner and
generation bridge: pending-journal import, a later service preference, preserved
history, separate old-key edits and reload all pass. Corrupt isolated data produces
no writable planner snapshot. An already-bound adapter refuses a missing record
instead of reading the old key. The journal/review unit tests, archived-version
isolation, two-tab compaction and rebuilt two-profile app integration also pass.

Selection is not authorization. A missing profile on a fresh startup is
indistinguishable at this synchronous storage layer from a device that never
isolated its data. Verified Settings/bootstrap must check retained migration
history before authorizing further sharing. Completing that lifecycle, mounting
reviewed migration/recovery and handling legacy edits remain release gates.

## Verified startup diagnosis and Settings guard

`startup-state.mjs` reads the actual local persona/membership, migration marker,
archive and generation replica. Later generations require the retained signed
checkpoint evidence. It checks observed record revisions and local storage bytes
again before reporting legacy state, required isolation, required local review or
a ready generation. Cancellation, damaged evidence, changed records and corrupt
profiles report unavailable. The result is a read-only diagnosis, not a token
authorizing a future write.

Settings now checks that diagnosis on opening, before starting a legacy connection
and before reconciliation. Migrated or unavailable state closes an existing legacy
session and offers recovery status instead of legacy connection controls. A ready
generation may reconcile local pending edits through the generation bridge, but
peer connections for that format remain disabled. Settings listens for isolated
profile changes as well as legacy storage events and reports retained old-tab
edits without merging them. Offline planning remains available.

The real-runtime migration suite checks legacy startup, unfinished isolation,
completed generation, pending review, missing/corrupt profiles, damaged checkpoint
signatures and cancellation. `startup-settings.test.mjs` checks actual generated
Settings/bootstrap with real identity and explicitly fixture-created migration
records: connection controls stay absent, missing storage does not reopen legacy
sharing, older-copy edits are explained and Back returns to Settings. The full
two-profile app sharing integration also passes. The fixture UI test is not proof
of an end-to-end migration wizard; that flow and authenticated checkpoint delivery
remain unfinished.

## Settings local-difference review

When startup diagnosis reports `local-review-required`, Settings now makes
“Review saved-place differences” the primary action. It reloads the current
replica, retained checkpoint and planner copy to build the review, then connects
the one-journey screen to `applyCheckpointChoices`. The writer still revalidates
all evidence at confirmation. Leaving keeps a draft in this Settings session;
it is reused only when the freshly built review has the same identifier. A newer
local edit invalidates the old review and draft rather than being overwritten.

The generated Settings test now prepares and installs a real issuer-signed
checkpoint through Settings over its fixture initial generation. Through the UI it
leaves/reopens the review, verifies the retained choice, injects a newer learning
setting, observes refusal of stale confirmation, then completes a fresh review.
The real guarded writer preserves history, the newer setting and the old storage
copy, consumes the old journal and reopens the recovered generation. Separate
screen tests retain their keyboard, reflow, axe, capacity and cancellation checks.

This connects the local review and writer to the issuer checkpoint controls
described below. The test's initial generation/planner data remain fixtures;
installation records are now produced by the actual installer through the UI.
Enrolled-device composition, peer checkpoint delivery, later legacy-edit review
and exact-build qualification are still required before publishing recovery.

## Reviewed migration setup

`migration-setup.mjs` composes the real generation migration with local storage
isolation under the planner lock. It checks the reviewed local bytes before
migration and again before copying, verifies startup evidence after each stage,
and reports only generation-zero setup. It explicitly reports that capacity has
not been recovered and peer sharing is unavailable for the new format.

If IndexedDB migration commits but the isolated-copy write fails, the retained
migration remains available. Retrying checks the same original replica revision
and resumes isolation without rewriting the replica. The composed browser tests
cover concurrent setup, stale local data, a permission race and quota failure
between the two storage systems. Original preferences remain intact.

Settings offers this review after a capacity error, or as “Finish saved-journey
setup” for a retained generation-zero migration. Back before confirmation does
not migrate data. Confirmation disconnects any current legacy session, performs
the guarded setup and returns to a status explaining that peer connections remain
unavailable. Setup can preserve more than 256 local saves without importing or
silently trimming them; a later checkpoint and explicit difference review must
resolve replication capacity.

The generated Settings test now resumes isolation through the real setup action,
rather than seeding that isolated record. `CAPACITY=1 MIGRATION_SETUP=1` on the
two-profile app test exercises the capacity-error entry, cancellation and real
migration/isolation over all 257 retained local saves and exact pending bytes.
Checkpoint preparation/installation UI, enrolled-device composition and peer
delivery remain separate unfinished steps.

## Issuer checkpoint review and installation

Experimental Settings now offers checkpoint review on the group's original device
after generation-zero setup, or after a later capacity failure. It displays the
actual retained/proposed snapshot, with saved endpoints and service preferences
under a disclosure. A previously prepared checkpoint is identified explicitly.
Confirmation loads the scoped software issuer, checks the displayed snapshot
against the preparation result, and invokes the guarded installer with the exact
reviewed replica revision and local bytes. Local-difference review follows.

Back before confirmation does not advance the generation. A local edit after
review causes installation refusal; any signed preparation is retained for a
fresh review. The Settings test exercises that retry, then real signing,
installation, choice application and reload. It separately refuses a stale
local-choice confirmation and preserves the newer local setting. Initial
generation/planner records are fixtures; checkpoint installation is no longer
fixture-seeded in this test. The existing storage-fault/migration suite and normal
two-profile app integration also pass.

The composed test exposed a startup-render race: cached actions could be clicked
before a pending diagnosis replaced their screen. Opening Settings now presents
the checking state until that diagnosis finishes. This does not claim automatic
peer delivery, enrolled-device checkpoint acceptance or a qualified public release.

## Enrolled recipient and checkpoint consent

`checkpoint-permission.mjs` adds a local application-consent boundary around the
installer. It validates the selected peer's current membership certificate,
requires saved-journey permission for that peer and carries the observed persona,
membership and permission revisions into the install transaction. It rechecks
those revisions for retained-install retries too. Removing permission before or
during acceptance therefore cannot authorize an ordinary retry merely because a
valid checkpoint signature exists.

This is not peer authentication: possession of the selected member's private key
must be established by the enclosing transport. A copied public certificate is
insufficient. The adapter is not called by network messages or mounted in a
recipient transfer UI yet.

`ENROLLED_CHECKPOINT=1` on `experiments/at-credentials/peer-delivery.test.mjs` uses
the actual acknowledged browser enrollment fixture. Both devices perform real
generation migration and isolation; the issuer prepares a signed checkpoint; the
enrolled recipient installs through the consent adapter, retries, reviews local
differences and reopens the recovered copy in a fresh page. Its independent save
and history remain. Absent consent, self/wrong peer, damaged signature and a
permission removal during commit refuse without a partial installation. Removing
consent also refuses an already-installed retry. Existing credential delivery and
journey-session checks still pass in the same run, using synthetic AT keys.

Checkpoint bytes are handed directly between the fixture's controllers, so this
does not establish checkpoint framing, authenticated wire delivery, ordered catch-up
or remote confirmation. Those remain the next transport gates.

## Checkpoint transfer framing

The separate `checkpoint-exchange.mjs` codec uses frame types 17–20 and the
`along-journey-checkpoint-transfer-v1` payload profile. Ordinary journey frames
remain unchanged. Payloads are limited to 2 MiB and paced in 1 KiB chunks; the
final receipt binds the transmitted bytes. The decoder verifies the root signature,
snapshot digest and signed identifiers before invoking retention. The receiving
application must additionally check the actual local predecessor, membership and
consent, and durably retain the bundle before acknowledging it.

Its receipt means retained for review, not installed or reconciled. Tests cover
lost receipt/retry and cancellation after the memory fixture retains a bundle,
without inventing a successful confirmation or undoing the retained input. The
combined exchange/checkpoint suites pass 15 tests. A durable bounded inbox,
authenticated session composition, ordered catch-up and recipient UI remain
unfinished. Public preview 3805 is unchanged.

## Durable checkpoint staging

`checkpoint-inbox.mjs` uses one `along-journey-checkpoint-inbox-v1` record per
group, containing the signed checkpoint, snapshot and verified local predecessor.
`retainPermittedJourneyCheckpoint` applies the same current peer membership and
local consent guards as reviewed installation. The inbox write additionally checks
the replica revision atomically. Readback verifies the saved bundle before a
retention receipt; retries also verify consent and the predecessor or installed
successor. An uninstalled pending checkpoint cannot be replaced; advancing the slot
now requires the installed successor and its verified recovery archive.

The actual enrolled-browser fixture tests denied consent, consent removal during
commit, storage quota failure, signature damage, cancellation after a committed
write, retry, unchanged planner/replica and cryptographic verification after opening
a fresh page. This verifies IndexedDB retention, not checkpoint wire delivery.
Session composition and successor advancement are described below; receiver review
controls are still required. The public build remains unchanged.

## Authenticated checkpoint channel

`checkpoint-session.mjs` composes the codec and consent-guarded inbox with the
installed-persona WebRTC session. Both traffic directions check application
permission; membership and possession are checked by the underlying authenticated
session. The channel retains its opening permission revision and local
generation/checkpoint, refusing use after either changes. A retained checkpoint
does not itself advance that generation or overwrite planner preferences.

The real enrollment fixture now transfers the signed multi-chunk checkpoint over
WebRTC. A forced disconnect after the receiving IndexedDB commit leaves the sender
unconfirmed; a fresh authenticated connection confirms the retained copy. Tests
also revoke consent and install the checkpoint while a channel is open, then
verify it refuses further transfer. Fresh-page verification of the retained bundle
and recovered local history still passes. Public signaling is copied by the test
harness on one host. This is not a device reachability test or recipient UI
acceptance; automatic ordered catch-up and app integration remain.

## Successive checkpoint recovery

The inbox now permits a next checkpoint only when its existing signed bundle has
been installed and retained in the installation recovery archive. It verifies
both copies and includes the archive revision in the inbox transaction checks.
The new bundle must be the exact next generation with the current parent. It
cannot replace a pending predecessor, skip a generation or erase the prior
recovery record. Local planner data stays unchanged during receipt.

The actual enrolled-browser test now covers two issuer-prepared checkpoints,
authenticated transfer of each, guarded installation and explicit adapter-driven
local review twice. It checks missing-archive and skipped-predecessor refusal,
late replay refusal, preservation of the first archive, and retention of the
recipient-only save and history through both recoveries and fresh-page reopening.
This proves successive checkpoint handling with harness signaling, not automatic
catch-up discovery, receiving UI or physical-device acceptance. Long-term recovery
archive bounds/pruning remain unresolved.

## Received checkpoint review in Settings

For a ready generation, Settings reads and verifies the inbox before presenting
**Review received saved places** as the primary recovery action. It shows received
place and service details on demand. Back leaves the inbox, replica and planner
unchanged. Continuing uses `installReceivedCheckpoint`, which binds the action to
the reviewed inbox and replica revisions plus exact local preferences, and adds
the inbox revision to the install transaction guards. It then opens the existing
local-difference review; receipt alone never invokes installation.

The generated-app test verifies Back, a changed inbox while review is open,
keyboard confirmation at 320px with reduced motion, actual installation and local
review, preserved route preference/history and fresh-page restoration without a
repeat prompt. The signed inbox is populated by a fixture; the separate enrolled
test verifies real wire delivery. These are not yet one Settings-to-Settings
connection flow. Local review works offline over retained signed data, while new
transfers continue to require peer authentication and current sharing consent.

## Visible checkpoint connection component

The shared connection view now has a checkpoint-specific profile and controller.
It keeps existing membership/removal checks and explicit journey-sharing consent,
then authenticates through `openCheckpointSession`. A final handoff explains that
no checkpoint has been sent yet and that received places will wait for review.
Ordinary journey descriptors cannot enter this profile.

The real enrollment fixture uses visible controls to reconnect after interrupted
checkpoint delivery. It checks keyboard consent, axe results at narrow width,
wrong-profile refusal without permission changes, and successful authenticated
retention after the setup view is disposed. Signaling is still copied by the test
harness. This component is not yet mounted by Settings; selecting the correct
retained checkpoint and connecting the full sender/receiver app flow remain.

## Selecting the receiver's next checkpoint

An authenticated checkpoint session now exchanges a 41-byte position message:
type 32, an unsigned 64-bit generation and a 32-byte checkpoint digest. The
generation must fit the validated application range; the zero digest is valid
only at generation zero. A session accepts one such message, waits for it with
a timeout, and refuses checkpoint frames before receiving it. Current consent
and the local generation remain checked throughout.

The advertised position is only a selection hint. `nextCheckpoint()` looks up
the exact successor in prepared/recovery records and verifies its group signature,
snapshot and predecessor, then rereads source revisions. It never signs, installs
or changes preferences. The receiver still independently checks its actual state.
Missing evidence produces no candidate; contradictory or changed evidence fails.

The enrolled-device browser test now selects and sends both successive checkpoints
using this exchange. It also checks selection from an installed archive, missing
successors and wrong parents. Node tests check malformed positions, signature
damage and changed source revisions. Settings mounting and complete app-based
catch-up remain unfinished.

## Settings-to-Settings checkpoint flow

Experimental Settings now offers reviewed migration without first forcing a
capacity error. Ready generations can start or join the checkpoint connection.
After authenticated handoff the connected screen chooses the peer's next retained
checkpoint and offers an explicit send action. The status distinguishes retention
from installation. Checking received places closes the channel and returns to the
local received-checkpoint review; receipt does not navigate or replace saved data.

`CHECKPOINT_APP=1 node experiments/journey-sync/app-integration.test.mjs` exercises
this through the generated app in two separate browser profiles: real UI enrollment,
saved places and service preferences, migration on both, issuer creation, connection,
send, receipt while the recipient remains at generation zero, recipient Back,
review/application and reload at generation one. Local saved places, services and
learning histories compare unchanged. It includes axe on the receiving review and
keyboard sending at narrow width. The harness transfers public signaling text;
physical devices, discovery/reconnect, generation-aware continuous snapshot sharing
and exact public-preview upgrade qualification remain outstanding.

## Ongoing generation snapshot foundation

The new internal generation store and exchange bind ordinary snapshots to one
installed generation and checkpoint. They reject missing storage, legacy shapes,
different checkpoints and a generation advanced during a compare-and-swap retry.
Same-generation merges retain deletion records and concurrent saves. The dedicated
frame domain (49–52) preserves the existing bounded/chunked transport behavior;
its receipt means the replicated snapshot was stored, not that local preferences
have been reconciled.

Sixteen combined Node tests pass, including cancellation, concurrent writers,
multiple chunks and mismatched receiver generations. The store fixture is in
memory. Permission/identity guards, authenticated session integration, local-review
gating and actual browser/app composition remain required before this becomes
ongoing device sharing.

## Required before release

1. Qualify the reviewed migration and format-2 bridge against the exact published
   preview and its older open tabs. Experimental issuer/recipient UI migration
   now passes; the public installed app still uses format 1.
2. Finish the policy and usable recovery path for more than 256 active saved
   places, plus long-term recovery archive bounds. Preserve divergent local data;
   never silently trim or reinterpret old edits as new saves.
3. Verify multi-checkpoint catch-up through the full app UI, including interrupted
   review, permission changes and session invalidation. Two successive checkpoints
   pass at the enrolled component level; the full Settings flow checks one.
4. Implement generation-aware ordinary snapshot sessions and ordered catch-up.
   An old peer's ordinary snapshot must never establish or replace a generation.
   Newly enrolled devices need checkpoint acquisition as well as membership.
5. Add review of later edits retained from older app tabs. The current received
   checkpoint/local-difference flow preserves its copies; older-tab reconciliation
   remains separate. Missing checkpoints or a lost issuer must explain recovery
   without suggesting storage clearing.
6. Verify storage faults, concurrent tabs, interrupted installation, replay,
   offline edits, removal and confirmation loss through the actual app. Then
   qualify the exact build and its upgrade path before publishing a new preview.

## Evidence

`node --test experiments/journey-sync/generation-checkpoint.test.mjs experiments/journey-sync/state.test.mjs` checks a full tombstone set, recovered
capacity, refusal of old snapshots/replay/skips, same-generation convergence,
every-byte signature tampering, changed snapshots, wrong authority, conflicting
successors, caller mutation, migration and bounds. These are model/cryptographic
checks in Node, not browser custody, persistent recovery or end-to-end acceptance.
