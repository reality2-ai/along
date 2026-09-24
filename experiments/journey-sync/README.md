# Saved-journey synchronization data layer

Current distribution: [Device Preview 3805](https://reality2.ai/along/preview/public/)
includes the tested Settings integration, group-key update/recovery and
post-rotation sharing. Regular Along remains version 37. The implementation
sections below record development stages; use the
[current release evidence](../../docs/RELEASE_CHECKLIST.md) for qualification and
remaining limits. Both devices must update before pairing or reconnecting.

Experimental storage, authenticated peer controller and local app integration.
The regular version-37 app and standalone pairing lab do not import these modules;
the separately published device preview does. The model
and store send no data; the explicitly opened controller can transfer snapshots
to an authorized enrolled peer.

`state.mjs` stores one register per ordered endpoint pair. Each register contains
the endpoint records and chosen service preferences, or a deletion tombstone.
`projectJourney` explicitly selects those fields from the planner's richer objects;
learning counts, time/day patterns, precise current location, active form, app
screen, credentials and accessibility settings are not included. Saved endpoint
addresses are private data and must only be transferred after deliberate consent.
Stop IDs are resolved against the receiving planner's local network; a stored
address coordinate is not proof of an accessible entrance.

Registers use a Lamport counter and actor identifier, with the actor breaking
ties. Changes observe the highest received counter before advancing it; wall-clock
time is unused. Independent endpoint pairs merge independently. Concurrent edits
to the same pair use this deterministic ordering, including a concurrent save and
delete. This is not a general remove-wins policy. An old snapshot cannot resurrect
a later deletion; a deliberate save after observing that deletion can restore it.
The pair's endpoints and route preference are one value, not field-level merges.

Deletion tombstones are retained indefinitely in this version. The limit is 256
distinct pairs, including tombstones; exceeding it refuses the change rather than
silently dropping history. A future retention/compaction protocol must account for
offline devices before removing tombstones. Forget-history generations and learned
history synchronization are separate unfinished work. Unknown schema/fields,
wrong groups, invalid endpoints, inconsistent retained operation stamps and
counter exhaustion are rejected. This is bounded schema validation, not protection
against a malicious group member or restored copies of old browser storage.

`store.mjs` uses the existing browser storage adapter's compare-and-swap transaction
to persist the clock, visible register state and outbound snapshot together. It
retries concurrent writers against the latest state. It reports a saved receipt
only after the storage adapter reports commit. Cancellation and storage failures
do not authorize discarding an earlier saved copy. No read silently replaces an
unknown existing schema. The snapshot is sufficient for later retransmission;
there is no volatile-only outbound queue.

The storage constructor's group and actor are caller-supplied context. The app adapter
derives them from the verified local persona and binds each incoming snapshot
to an authenticated, authorized group session. `merge` does **not** authenticate
its caller. Do not expose it directly to network messages. At-rest records use the
same browser-origin boundary as the current personal preferences; this module
does not encrypt journey data or establish protection from same-origin scripts.

Verification:

```sh
node --test experiments/journey-sync/state.test.mjs
CHROMIUM_PATH=/path/to/chromium node experiments/journey-sync/store.test.mjs
```

The browser check uses the recorded runtime bundle described in
[the build procedure](../../docs/PAIRING_LICENSE_AUDIT.md#recorded-runtime-rebuild-24-september-2026).
It exercises actual IndexedDB transactions through two simultaneous handles,
deletion/replay, a fresh-document reopen, and cancelled/failed/invalid changes.
Model checks cover reordered three-replica convergence and privacy projection.
These storage checks alone do not establish authenticated delivery or app behavior;
the separate controller and app checks below cover those boundaries.

## Application permission boundary

`permission.mjs` adds per-peer journey-sharing permission, separate from both TG
enrollment and AT-key access. Granting it requires the selected peer's current
membership certificate and the exact permission revision reviewed by the caller.
The write also checks the persona and membership revisions atomically. Permission
on one device never automatically grants permission on another. A missing or
unreadable record does not opt in; records are limited to 16 peers.

The permitted-state adapter checks saved consent when exporting a snapshot. An
incoming merge additionally guards the same consent/persona/membership revisions
in its storage transaction, so removing permission between review and commit
prevents that commit. An existing adapter does not retain a permanent permission
lease. Removing permission does not erase copies already read or revoke membership.

The actual-enrollment fixture in `experiments/at-credentials/peer-delivery.test.mjs`
runs `permission-check.test.mjs` before creating AT settings. It checks refusal
without consent, mismatched membership proof, independent directions, stale
review, authorized merge, and removal during commit with saved journeys retained.
It uses real WASM identities, membership evidence and IndexedDB. Consent grants
now use the visible permission component; race/stale-state setup still uses
harness calls. The controller binds packets to the selected authenticated peer.
The local-only Settings integration below uses this boundary. The connection component reviews
the peer identity from a transferred public device message.

## Authenticated snapshot exchange

`journey-session.mjs` composes the actual local-persona runtime with the permitted
state adapter. No AT owner or subscription key is required. `synchronize()` sends
one durable snapshot to the selected peer; both devices must send to reconcile
both sides. Local calls are serialized. The app adapter sends on connection and
local edits; automatic discovery and reconnect remain unfinished.

`exchange.mjs` transfers at most 2 MiB in 1,024-byte chunks below R2's 2,048-byte
message limit. One incoming and one outgoing transfer can coexist. A random
transfer ID, byte count, contiguous offsets and SHA-256 digest bind the snapshot.
These are framing checks; the authenticated direct WebRTC session supplies
confidentiality and peer identity. The framing is Along-specific, not a general
R2 application interoperability claim.

Each chunk waits for acknowledgment. Final confirmation follows a committed merge
and names the exact snapshot digest; it does not prove delivery of later edits or
bidirectional convergence. Idle timeout closes the channel and drops partial receive
bytes. A lost receipt leaves saved data intact; retransmission on a new connection
merges idempotently. Closure during commit never produces a false confirmation.

Permission is checked before each application send/receive and guarded atomically
at incoming commit. It cannot recall bytes already released or erase a peer's copy.
Group freshness remains limited by the runtime's held membership evidence.

Run `node --test experiments/journey-sync/exchange.test.mjs` for chunking, duplex
transfer, commit ordering, lost receipts, retry, malformed/tampered packets,
oversize headers and closure checks. The real-enrollment fixture additionally runs
`session-check.test.mjs` over authenticated WebRTC and actual IndexedDB before any
AT settings exist. It checks multi-chunk transfer, bidirectional convergence,
offline save/deletion and reconnect, then removal on an open channel. Consent and
removal use visible controls; the connection component reviews peer messages and
manages signaling while the harness copies public text between panels on one
host. The separate generated-app check below exercises actual saved preferences
and Settings. Physical-device acceptance remains unfinished.

## Journey-sharing review component

`permission-view.mjs` names the selected device and explains the exchange of saved
endpoints, service preferences, changes and removals. It explicitly separates
current location/history and AT-key access. A full-width action saves permission;
Back and Escape leave it unchanged. The complete device identity sits under a
disclosure. Success names a saved local choice, not delivery or remote consent.
Removal explains that already shared copies remain on the other device.

The real-enrollment browser fixture checks synthetic-click refusal, keyboard
confirmation/focus return, Escape, stale-review refusal, 320px/200% reflow and axe.
It uses this component to grant both sides before the real journey exchange and
remove permission while that channel is open. The generated-app test also exercises
removal from the Settings device list. TalkBack acceptance and public deployment
remain unfinished.

## Journey connection component

`connection-view.mjs` guides two already enrolled devices through Start or Join,
identity review, independent sharing permission and connection-message transfer.
It verifies the group, current membership certificate and intended recipient
before accepting the peer. Reconnection asks for confirmation of the saved peer;
it does not silently connect because permission exists. AT-key setup is separate.

The setup screen sends no journey snapshots. Only after authentication and the
trusted **Use journey connection** action does it hand its session to the caller.
Back, Escape and disposal close unfinished connections; disposing after handoff
preserves the caller's session. Public signaling messages contain identities and
may include network addresses, but contain neither saved journeys nor AT keys.

The enrollment fixture drives the controls and copies the public messages between
panels. It checks wrong-group/self messages and cancellation without permission
changes, keyboard review, narrow layout and automated accessibility, then exchanges
durable journeys over the handed-off channel. This is still a component test,
not automatic device discovery or physical-device proof. The generated-app test
below separately covers Settings integration.

## Actual app saved places (local experimental build)

Settings now offers **Share saved journeys with my devices** after identity setup,
independently of AT credentials. The Start/Join flow uses the connection component.
Once both devices confirm, each sends its durable snapshot. Subsequent local saved
place/service-preference edits send while connected; received changes update saved
choices without changing the selected route, current leg or learning settings.
Closing Settings retains the channel; explicit disconnect or pagehide closes it.
Reconnection still requires manual message transfer, not automatic discovery.

The next candidate uses `along-journey-connect-v2`. Its initial messages include
the sender's retained signed group removals, which the recipient verifies and
commits before membership/permission review and opening the journey session.
Both directions catch up without separately copying each removal. This still
requires transferring the connection messages; it is not automatic discovery,
continuous background propagation or proof that no newer removal exists elsewhere.
The v1 connection profile used by published preview 3802 is refused by this new
flow; both devices need the newer candidate. No v1 downgrade silently skips catch-up.

The set carries group-member identifiers and signatures, not addresses, history
or AT keys. Each message discloses the added group information. The bounded binary
encoding supports 256 removals within the transfer component's message limit.
Every incoming signature is checked before a single atomic membership write;
bad signatures, malformed encoding and duplicate subjects refuse the entire set.
Existing evidence is retained, replay makes no new write, and authenticated local
invalidation follows commit. Removal of either session participant prevents the
subsequent membership checks from opening a journey connection.

The full generated-app check starts each device with a different authentic
removal for an unrelated synthetic subject, then connects through visible controls
and verifies that both retain both removals before sharing journeys. The component
and browser-custody tests also cover the new framing and tampered-final-signature
refusal without partial state. Preview 3803’s AT-key reconnection also
exchanges this set before opening its session; the existing manual removal flow
remains available. Neither flow establishes automatic peer discovery.

Incoming changes refresh the saved-service button without rebuilding the selected
journey or its steps. If keyboard focus is inside the saved-journey shortcuts,
the existing shortcuts remain in place until focus leaves that group; the latest
list then appears without moving focus. Saved state is committed immediately even
when this visible refresh is deferred. This avoids removing a control while the
user is about to activate it. It is not a physical screen-reader acceptance claim.

`app-preferences.mjs` adds a local outbound journal to the same localStorage value
as the existing preferences. A save/removal and its queued change are one write.
Tracking begins only when the user starts or joins sharing. Existing saved places
are projected on first opt-in; unsaved history, counts and mobility settings stay
local. The public build continues to use the ordinary preferences module.

`app-store.mjs` consumes that journal under a same-origin Web Lock. Each IndexedDB
transaction commits the projected state and an operation receipt together. If the
browser stops before consuming the local journal, replay recognizes the committed
operation. New local edits during an asynchronous read/commit remain queued and
are applied before incoming state is rendered. Failed writes retain pending data;
an unknown/different saved sharing group is not silently replaced. This does not
make the app's existing localStorage preferences a general multi-tab transactional
database or provide rollback resistance. Web Locks are required for sharing.

Saved places are retained separately from the thirty-item learned-history bound.
The replication model's 256-pair bound also includes retained tombstones; reaching
it can prevent further sharing changes without discarding local saves. The journal is bounded
at 256 pending operations. The source now compacts unstarted operations when a
new edit would exceed that bound: repeated changes to a pair retain its last value
or deletion. The head is unchanged because it may already be committing or have a
saved receipt; replacement batches receive fresh IDs and retain final-edit order.
No replicated tombstones are removed. This avoids blocking repeated offline edits,
but does not recover the separate 256-distinct-pair limit. A user-facing capacity
recovery path and broader preference sync remain required.

`node --test experiments/journey-sync/app-store.test.mjs` covers compaction,
commit/replay interruption and failed local writes. With `CHROMIUM_PATH` set,
`node experiments/journey-sync/app-store-browser.test.mjs` checks real localStorage,
IndexedDB and Web Locks across two tabs: one compacts while the other is paused
before committing its head; after a simulated interruption and reload, the receipt
prevents duplicate import and final deletion/service preference/history survive.
These compaction changes are included in preview 3805; its exact candidate
qualification also runs the two-tab test against the generated modules.

**Manage journey-sharing devices** lists locally saved permissions, including when
the other device is offline. Selecting a device opens the existing removal review,
with its complete identity behind a disclosure. No membership certificate is
supplied to this removal-only path, so a stale list cannot silently regrant access.
Successful removal closes a connection to that peer and retains local saved places.
It does not erase the other device's copies, remove TG membership or change AT-key
permission. A channel ending in the background does not dismiss an open review.

Verification:

```sh
node --test experiments/journey-sync/app-store.test.mjs
python3 scripts/build_experimental_app.py --runtime releases/along-r2-runtime-1b9229ad
CHROMIUM_PATH=/path/to/chromium node experiments/journey-sync/app-integration.test.mjs
```

The generated-app test enrolls two isolated browser profiles through actual Settings,
saves real address pairs and a service preference, connects through the visible
flow, checks local-history separation and current-step preservation, then tests a
connected removal and offline reopening/edit/reconnect convergence. It also checks
320px/200% layout and axe in the sharing screen, with zero AT provider requests.
Permission-management checks cover the empty list without opting in, Back and
synthetic-click refusal, keyboard confirmation/focus, active-channel closure,
refusal of subsequent peer edits, retained copies and offline permission removal
after reopening. These are independent from removing an individual saved journey.
The same test removes/restores a preferred service from the other profile and
checks both the saved-service button state and the identity of the existing step
DOM node. It also removes a focused shortcut remotely, checks that focus and the
button survive, then checks the list refresh when the user leaves the group.
The harness copies public connection messages; this is one-host browser evidence,
not S23/TalkBack acceptance, remote reachability or a public release.

## Preview candidate with separate storage

`build_experimental_app.py --preview --runtime …` prepares
`releases/along-device-preview/`, app version 3801. It requires the recorded runtime
bundle and uses separate localStorage names, a separate device database and
timetable database, and a separate shell-cache prefix. Its manifest identifies
**Along Device Preview**. Raw candidate output retains its `DO-NOT-PUBLISH.txt`
marker. `prepare_preview_release.py` verifies qualification against that exact
candidate manifest, packages the approved payload without the local marker, and
adds notices, device guidance and qualification evidence. The published test copy
is not a replacement for the regular installed app.

Separate names prevent accidental mixing during ordinary app operation. They are
not a security boundary: scripts on the same origin can still access each other's
storage, and browser storage clearing can affect both apps. The preview starts
with its own saved places and device setup; it does not copy existing credentials.

```sh
python3 scripts/build_experimental_app.py --preview --runtime releases/along-r2-runtime-1b9229ad
PREVIEW=1 CHROMIUM_PATH=/path/to/chromium node experiments/journey-sync/app-integration.test.mjs
CHROMIUM_PATH=/path/to/chromium node experiments/journey-sync/preview-coexistence.test.mjs
```

The coexistence check also needs the regular app in `dist/`. It serves that app
and the preview on one origin, sets up a preview identity, updates/reopens the
preview, then reopens both offline. It checks the original app's preferences,
feedback draft, pairing record and every cached shell response remain unchanged.
Window storage-access observation also verifies preview use of the separate names.
The regular and preview timetable databases coexist. A simulated older 3800 shell
updates to 3801 and retains the exact saved preferences, device identity revision
and encrypted AT-key ciphertext. This is a fixture upgrade; 3800 was not released.

The candidate now includes [preview-specific installation/privacy guidance](../../docs/PREVIEW_INSTALL.md),
rendered with the regular browser/platform instructions. Settings distinguishes
local history from optional saved-place sharing, describes direct AT requests and
labels the history-clearing action's effect on saved places. The guide is verified
offline with narrow/zoom and axe checks. Owner and shared-key app checks also pass
with the preview namespaces, including key replacement, withheld access removal,
browser Back, unreadable schema and stalled optional runtime. AT responses are
mocked and keys synthetic; this does not establish real-provider or physical-device
acceptance. [Preview 3801 is published](https://reality2.ai/along/preview/public/),
with a [downloadable bundle](https://github.com/reality2-ai/along/releases/tag/device-preview-3801)
and [S23/desktop guide](../../docs/PREVIEW_DEVICE_CHECK.md). The
[HTTPS check](../../docs/evidence/device-preview-3801-public.json) verifies all 242
payload hashes, identity setup/reload, offline help and new-address bus/ferry routing.
Physical observations remain pending.


### Distinct-place capacity reporting (preview 3805)

Local imports that exceed 256 replicated pairs now produce a distinct capacity
error. Settings retains it across failed connection attempts and explains that
reconnecting or deleting a place cannot free the retained deletion records. Local
saved places, the pending journal and committed replica remain intact. This does
not reset the sharing dataset, reclaim tombstones or resolve a peer-side merge
failure; those recovery paths remain unfinished.

`CAPACITY=1 node experiments/journey-sync/app-integration.test.mjs` exercises the
built app with a 257-place boundary fixture through its production preferences
writer. It checks reload, the visible capacity message, retry, exact retained
journal/local saves, unchanged replica and identity, and automated accessibility.
The fixture creates the large dataset programmatically; it is not 257 manual
journey searches or a physical-device result.


### Capacity recovery generation model (not integrated)

`generation-state.mjs` and `generation-checkpoint.mjs` implement the first model
and signature-verification layer for a deliberate restart of shared journey data.
Normal merges require identical generation/checkpoint identity. Signed exact
successors can propose a live-only snapshot without changing local data. This
is not yet a recovery action: durable preparation/installation, journal retention,
current authorization, peer catch-up and user review remain unfinished. See the
[protocol and evidence](../../docs/JOURNEY_CAPACITY_RECOVERY.md).


`checkpoint-preparation.mjs` now retains one authenticated successor across
concurrent callers, later local edits and reload without advancing the replica.
Its browser storage test covers cancellation before/after commit, custody revision
races, invalid signatures and failed writes. The signer and authority guard are
synthetic in that test; binding actual issuer custody and durable installation
remains required. Run `node experiments/journey-sync/checkpoint-preparation.test.mjs`
with the documented `CHROMIUM_PATH`.


The actual software issuer now exposes only a scoped
`prepareJourneyCheckpoint({expectedRevision})` operation. The pinned-runtime
`experiments/tg-pairing/epoch-preparation.test.mjs` additionally checks restoration,
key rotation, stale/closed/cancelled handles and a permission change during the
commit. Journey replicas are still fixture-seeded for this check: reviewed
format-2 migration and checkpoint installation are not integrated into the app.


`generation-migration.mjs` now atomically archives the format-1 replica/import
receipt, creates generation zero and places a format-2 marker in the old replica
slot. Real browser tests cover concurrency, reload, empty state, stale review,
permission changes, interrupted storage and an old write already in progress.
Saved values, tombstones and the local pending journal survive. No startup or UI
calls this migration; the format-2 planner bridge and reviewed app flow remain
required before enabling it. See `generation-migration.test.mjs` with the pinned
runtime environment used by the issuer preparation test.


`generation-app-store.mjs` imports pending edits after migration, transferring an
archived import receipt into the new receipt scope without duplicating the edit.
Queue and per-operation generation markers prevent old or unmarked edits from
crossing a checkpoint. Compaction preserves those markers. The browser migration
check covers real migration/reload, receipt corruption, duplicate prevention,
local history and interrupted localStorage consumption. Checkpoint advance itself
is a fixture; installation and reviewed cutover remain required. The app continues
to mount the format-1 bridge until that flow is complete.


`checkpoint-installation.mjs` now composes a real signed checkpoint with guarded
atomic replacement of the replica and import receipt, retaining an exact local
recovery record. It leaves planner localStorage untouched and returns
`localReviewRequired: true`. The migration browser suite covers real preparation,
installation, interruption, permission races, corrupt evidence, concurrent local
edits and reload. Local-difference review, peer delivery and app controls remain
unfinished; no installed preview calls this operation.
