# Proposal: private cross-device synchronisation through Reality2

Status: design investigation, 23 September 2026. No sync functionality is enabled
in Along. This proposal extends the product; it is not evidence that the existing
release has cross-device sync.

A [saved-journey data layer](../experiments/journey-sync/README.md) now implements
strict endpoint/route projection, deterministic logical ordering, retained deletion
tombstones and atomic snapshot persistence. Model and real IndexedDB checks cover
concurrent saves, replay, deletion and restart. It now connects to an authenticated
peer controller, but not the app's preferences; public sync remains absent.
Its documented limits include whole-journey conflict resolution and a bounded
tombstone set without garbage collection.
The next increment adds independent per-peer application permission, verified
against actual enrollment evidence, and transaction guards that prevent a merge
when permission is removed during its commit. These checks use real browser
storage and a visible consent component; race setup remains a harness action.
The authenticated journey exchange now moves
bounded snapshots in acknowledged chunks and confirms only committed merges.
The real-enrollment browser fixture checks offline changes, reconnect/convergence
and visible permission removal on an open channel, independently of AT keys. Settings integration,
automatic reconciliation, discovery and physical-device tests remain unfinished.

The earlier implementation references below are historical: those projects are
now archived. The [current runtime investigation](REALITY2_INTEGRATION.md) pins
the active monorepo and identifies missing durable browser TG/application-secret
support. Do not use an archived example as proof that Along can already pair or
synchronise securely. The latest requirement excludes an Along-operated central
service; any transport or storage proposal must preserve that independence and
make user-controlled peer dependencies explicit.

## Intended experience

A person deliberately pairs their devices into a personal trust group once. Saving
or removing a journey on one device is reflected on the others when reachable.
Every change takes effect locally immediately. Offline devices keep working and
reconcile on reconnection. Background failures stay quiet. Settings can show paired
devices, last successful sync and a revoke/unpair action.

A browser app can be suspended or terminated by the OS. Promise reconciliation
when it can run and reach a peer/store, not continuous background sync merely
because the phone has an internet connection.

## Evidence inspected (historical)

- [Published L5 trust and identity](https://reality2.ai/standard/L5-trust-and-identity.html):
  deliberate membership, trust-group delivery gates and payload protection.
- [Published L7 application layer](https://reality2.ai/standard/L7-application.html):
  fire-and-forget events, idempotent effects and application-level assurance.
- Local `r2-core` checkout at `0093a033`: `crates/r2-wasm` exposes framing, trust,
  cryptographic operations and engine functions to JavaScript. Its Notekeeper
  example includes a sync plugin, tombstones and a browser transport bridge.
- Local specifications checkout at `8ebc07a` was also inspected. Published pages
  carry newer dates than some local files; implementation must pin a compatible
  revision and check conformance, rather than assume every example matches it.

The example sync plugin has in-memory queues and returns an error while the relay
is disconnected. Its existence is useful starting evidence, not proof of durable
Along synchronisation, enrolment or revocation working in the deployed browser.

## Recommended boundary

Keep the current local route engine and data downloads. Add a dedicated sync
adapter around personal state, backed by IndexedDB. Reuse the relevant R2 WASM
trust/wire machinery and browser transport rather than inventing cryptography.
Use an authenticated encrypted path through an R2-compatible WSS bridge or relay.
A browser-held R2 persona is an app/browser identity, not automatically every app
or browser on the physical device. Tailscale reachability is not R2 membership.

For devices that are not online at the same time, use a reachable trusted R2 hive
with durable application storage, or an explicitly implemented encrypted mailbox.
A forwarding relay alone does not establish store-and-forward durability. A
trusted hive can keep the sync state, but should not receive routing queries or
public datasets merely to make sync work. Verify crypto/key storage and revocation
against the selected implementation before claiming end-to-end guarantees.

## What to synchronise

| Data | Proposed policy |
| --- | --- |
| Saved journeys | Sync stable IDs and endpoints; merge independent records |
| Walking/access preferences | Sync explicit values, with an understandable per-device override if needed |
| Learning enabled/disabled | Explicit shared setting, clearly explained during pairing |
| Learned search patterns | Separate opt-in; event IDs or per-device counters prevent double-counting |
| Current location, active form, current screen | Keep device-local by default |
| Timetables, street graph, addresses, live predictions | Do not put in personal sync; download public data independently |

## Correctness contract to implement

- Persist each change and its outbound event before attempting transmission.
- Identify events by device/persona ID and monotonic sequence; deduplicate replays.
- Exchange version/digest information and request missing events or snapshots.
- Use explicit application receipts where delivery assurance is needed.
- Merge saved journeys by stable ID; resolve concurrent edits deterministically
  using logical ordering rather than wall-clock time alone.
- Preserve deletions as tombstones. Define retention and snapshot rules so an
  old device cannot resurrect a deleted journey.
- Treat “forget history everywhere” as an explicit reset generation. Distinguish
  it from removing only this device's local copy.
- Authenticate membership and bind data to the chosen group and application.
  A group identifier by itself is not authorisation.
- Pair deliberately; handle a new browser profile, lost key and revoked device.
  Revocation prevents future authorised access; it cannot erase copies already read.
- Continue local operation throughout network, peer, relay and storage failures.

The existing `localStorage` preferences object cannot simply be broadcast and
last-write-wins replaced: that can discard concurrent saves, duplicate learned
counts and restore cleared history. Introduce a schema and migration first.

## Suggested proof of concept

1. Pair two browser profiles and synchronise one saved journey through actual R2
   framing/trust checks. Confirm an unpaired third profile cannot read or write it.
2. Disconnect one profile, edit both sides, reconnect in both orders and verify
   convergence, duplicate handling, deletion and clock-skew behaviour.
3. Close one browser completely. Prove later delivery through the persistent hive;
   restart the hive and demonstrate recovery without losing queued changes.
4. Test revocation and re-enrolment. Inspect traffic/storage for the intended
   confidentiality boundary; document what the relay or trusted hive can observe.
5. Repeat on installed Android and desktop, preserving Along's existing offline
   routing, accessibility and quiet-update behaviour.

Saved journeys first, preferences second, optional learned history last. This
keeps the initial proof small while testing the actual trust and durability model.
