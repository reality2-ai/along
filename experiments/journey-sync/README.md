# Saved-journey synchronization data layer

Experimental storage and authenticated peer controller, not an enabled app feature.
The public app and published pairing lab do not import these modules. The model
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

The constructor's group and actor are caller-supplied context. The future adapter
must derive them from the verified local persona and bind each incoming snapshot
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
This does not yet establish authenticated peer delivery, receipt exchange,
automatic reconciliation, preference migration, public UI or physical-device use.

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
Settings integration remains unfinished. The connection component below reviews
the peer identity from a transferred public device message.

## Authenticated snapshot exchange

`journey-session.mjs` composes the actual local-persona runtime with the permitted
state adapter. No AT owner or subscription key is required. `synchronize()` sends
one durable snapshot to the selected peer; both devices must send to reconcile
both sides. Local calls are serialized. This is not automatic discovery or
background reconciliation yet.

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
host. App preference migration, Settings integration,
automatic reconciliation and physical-device acceptance remain unfinished.

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
remove permission while that channel is open. This is a component in a test page,
not yet the commuter Settings flow, TalkBack acceptance or public deployment.

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
not automatic device discovery, app Settings integration or physical-device proof.
