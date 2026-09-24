# Optional relay transport — development only

The user approved an optional user-selected R2 relay on 24 September 2026.
Relay controls are mounted only in the local experimental build, not deployed.
No endpoint is selected by default. A saved explicit opt-in restores connection
while Along is open. Planning and direct AT access remain independent.
The sections below record implementation stages; see the final Settings section
for current integration and test scope.

`transport.mjs` implements a bounded WebSocket connection lifecycle shaped around
Notekeeper's observed client at revision
`f771c3b7e258394fc4d7998c369a9b2668dd9b35`, `index.html`, class
`R2RelayTransport`: signed text greeting, welcome, binary frames, ping/pong and
backoff. It deliberately has no durable queue or catchup claim. Disconnect cancels
all retry/heartbeat/deadline timers and invalidates late asynchronous greetings.
Authentication refusals stop retries; connection failures back off up to 60 seconds.
WSS URLs are explicit and cannot embed credentials, query strings or fragments.

The caller must supply the actual signed greeting and protected binary frames.
A relay welcome means transport readiness, **not peer authentication or permission
to share journeys**. This module neither encrypts nor verifies group membership.
Do not send personal data through it until the existing authorization and payload
protection have been integrated and verified. Relay operators can observe network
addresses, timing, message sizes and the greeting's routing/identity metadata.

Along's pinned `along-r2-runtime-1b9229ad` generated WASM JS has no
`sign_relay_hello` API. Source tracing found that the same greeting can be signed
through Along's existing local device signer, without exporting keys or adding a
runtime API. `hello.mjs` hashes the established group public key with SHA-256,
uses the first eight bytes as lowercase routing hex, and signs the UTF-8 string
`trust_group:device_id:timestamp` with Ed25519. It independently verifies the
result before returning JSON. `local-hello.mjs` reloads the existing installed
persona, whose signer checks current local identity/membership evidence; this
wrapper now has real IndexedDB integration coverage described below; it remains
unmounted.

Sources inspected: `r2-core` revision `0093a0331e51afde5ff4eff3771d0a6b17fc632d`,
`crates/r2-wasm/src/lib.rs` (`sign_relay_hello`, `trust_group_hash`), and `r2-relay`
revision `b4ae9487bb0b721487b4765b210839c1c7055742`, `src/ws.rs` and
`src/protocol.rs`. The relay verifies device-key possession and timestamp but does
not establish membership merely from the advertised routing hash. Protected
application frames and peer authorization still require integration.

Run `node --test experiments/relay/transport.test.mjs`. Six tests use controlled
socket/timer doubles: URL restrictions; greeting/frame/heartbeat bounds; reconnect;
disconnect during pending authentication or retry; pre-greeting and unauthorized
traffic; and disconnect from a status observer. These do not establish actual
server interoperability, durable sync, encryption, browser network reachability or
physical-device success. Next: verified greeting/protection integration, real local
WebSocket tests, peer authorization and replay handling, persistent user-selected
configuration, app lifecycle/reconciliation, then physical checks.


Greeting and real network checks:

- `node --test experiments/relay/hello.test.mjs`: two tests verify the greeting
  independently using Node crypto, and refuse wrong groups, invalid signatures
  and cancellation.
- `CHROMIUM_PATH=… TMPDIR=… node experiments/relay/browser-transport.test.mjs`:
  real Chromium connects to a loopback TLS WebSocket fixture, with a temporary
  test certificate and synthetic nonextractable device key. The fixture verifies
  the signature, echoes synthetic binary bytes and closes the connection; the
  browser reconnects with another verified greeting, then disconnects explicitly.
  Requires OpenSSL and the installed Playwright bundle. Test certificates are
  removed afterwards. TLS certificate exceptions apply only to the test context.

This is not a deployed R2 relay interoperability test or a test of encrypted
journeys. The fixture implements the inspected greeting contract; actual server,
real stored-persona, protected-frame, peer permission and app integration checks
remain required. No relay has been contacted with the user's identity or data.


Stored-identity integration now passes with `STORED_IDENTITY=1` and the pinned
`R2_BROWSER_DIR` / `R2_WASM_DIR` in the browser transport command. It initializes
an actual Along software persona, uses its nonextractable IndexedDB signing key
for two WSS connections, reloads the document and verifies the same member ID.
It exercises cancellation, a concurrent identity revision change, a membership
revision change during the final signature verification, and a real issuer-signed
local revocation. The latter is synthetic self-revocation for verification only;
the app does not offer self-removal through ordinary member removal controls.

`local-hello.mjs` now audits every observed storage revision and rereads those
records after greeting verification. Changes invalidate the pending greeting.
This is a use-time check, not a grant for the socket lifetime: application send and
receive still need current peer membership, consent, epoch and replay checks.
No actual AT key, user identity or saved journey is used in this fixture. Real
enrolled-member relay coverage, protected frames and app integration remain.

### Protected application envelope prototype

`protection.mjs` is an Along browser-subset envelope, not R2-WIRE and not yet
connected to the transport. It requires a **fresh pairwise session secret** and
an authenticated transcript supplied by the future peer handshake; passing an AT
key or shared TG traffic key is not permitted by its contract. It uses Web Crypto
HKDF-SHA256 for directional AES-256-GCM keys and Ed25519 device signatures.
Bindings include the full group public key, epoch, transcript, sender and recipient.
The receiver verifies the device signature before decrypting; current-authority
callbacks run before and after asynchronous operations. Callers must implement
those callbacks using actual membership and journey-sharing permission checks.

The binary packet is version byte 1, an eight-byte big-endian sequence, twelve-byte
random GCM IV, ciphertext with a sixteen-byte tag, then a 64-byte Ed25519 signature.
Plaintext is limited to 2048 bytes to match the existing journey exchange chunks.
Signatures bind direction/context plus the header and ciphertext. AES associated
data binds direction/context plus the header. HKDF uses the transcript as salt
and `along/relay/application/v1` followed by NUL and the context as directional info.
Sequence starts at one in each direction. Replay, ordering, authentication or
permission failure closes this envelope instance. Concurrent operations in the
same direction refuse; the session controller must serialize them and bound queues.

`node --test experiments/relay/protection.test.mjs` passes five model checks for
bidirectional encryption; duplicate/out-of-order input; changed epoch, transcript,
key, signature or direction; authority loss while signing; maximum size; and
caller mutation during asynchronous work. This is not yet an authenticated relay
session: peer discovery, fresh signed key agreement, replay-resistant handshake,
real membership/consent adapters and encrypted WSS integration remain required.
No claim of standard wire compatibility or whole-protocol security review is made.

### Fresh peer handshake prototype

`handshake.mjs` now composes message protection with fresh X25519 key agreement,
using the same Web Crypto curve as the pinned enrollment runtime. Each side signs
its role, random 32-byte nonce and ephemeral public key, bound to the full group,
epoch and ordered initiator/responder identities. Contributions are exactly 129
bytes. The transcript hashes both contributions' bodies with that context. The
raw shared secret is cleared after deriving directional protection keys; ephemeral
private-key references are released. Each side must successfully open the other's
protected confirmation before obtaining application send/receive methods. The
confirmation consumes sequence one. A one-minute timeout, abort or failed step
closes the instance. Protection errors after confirmation also abort its signal.

`node --test experiments/relay/handshake.test.mjs` passes four tests, including
bidirectional protected messages, mutated contributions, reflected roles, different
epochs, premature confirmation, permission callback rejection and cancellation.
A captured signed contribution plus its old confirmation fails against a fresh
local contribution. These tests supply peer identities and authorization callbacks;
they do not prove actual stored-peer membership/consent or relay interoperability.
The existing protection suite also passes (nine combined checks).

Inspection of pinned `r2-relay` `src/ws.rs` confirms that after greeting it buffers
and broadcasts opaque binary messages within the routing group, excluding the
sender connection. Thus an Along envelope need not pretend to be normative
R2-WIRE for that inspected forwarding implementation. Other versions/relays can
have different rules. The relay can retain ciphertext and handshake metadata;
Along does not request catchup or infer delivery/durability from forwarding.
Still required: actual two-browser encrypted WSS flow, real enrolled-peer
membership/consent integration, bounded dispatch and reconnect orchestration,
selected-relay settings and public release qualification.

### Enrolled permission adapter and two-browser network checks

`local-handshake.mjs` loads the actual local persona, verifies the selected peer's
certificate/current membership and requires explicit saved journey-sharing consent.
It freezes every observed authority record revision, so removal/regrant, identity
replacement or membership changes invalidate the held handshake and subsequent
protected operations. It neither grants permission nor reads/merges journey state;
replica commits still require their existing guarded merge adapter.

With the pinned runtime/browser environment, run
`ENROLLED_RELAY=1 node experiments/at-credentials/peer-delivery.test.mjs`.
This passed using the fixture's actual acknowledged enrollment: absent permission
refuses, consenting peers exchange protected bytes, remove/regrant invalidates the
old channel, identity revision changes refuse, and a corrupted peer certificate
refuses. The existing credential and journey tests in that fixture also pass.
Message carriage in this enrolled check is still harness-controlled on one host.

`PEER_HANDSHAKE=1 node experiments/relay/browser-transport.test.mjs` adds two
isolated Chromium contexts to the local TLS fixture. They exchange signed fresh
contributions, encrypted key confirmations and application bytes in both directions
over actual WSS forwarding. The harness supplies synthetic selected identities and
an always-allow check: this network test is distinct from the enrolled consent
check above. Combining both with the real app and actual relay remains required.

The first two-context run timed out waiting for handshake completion. After adding
nonsecret stage diagnostics (`statuses`, message kind numbers and failure text),
seven consecutive reruns passed, including a five-run batch. The initial stall's
cause is **not resolved**; retain it as a reliability investigation item. Do not
interpret reruns as proving physical-device reliability or fixing the user's QR
timeout. No relay feature or changed preview has been deployed.

### Addressed, bounded peer exchange

`peer-exchange.mjs` now composes a single fresh handshake with addressed relay
packets and a queue capped at 32 pending messages. Its 137-byte header contains
`ALNRLY01`, message kind, sender and recipient IDs, and each side's handshake nonce.
These outer routing fields are untrusted hints; signatures, transcript binding and
protected sequence checks remain authoritative. Other recipients, senders, protocols
and session nonces are ignored before cryptographic work. Message size is bounded.

The exchange repeats its contribution and cached confirmation once per second
until its peer confirms, within the handshake's existing one-minute lifetime.
Duplicates reuse the exact confirmation bytes without consuming another protected
sequence. A ready peer responds to repeated matching contributions, allowing its
other peer to recover a lost confirmation. Application sends still require local
key confirmation, and the existing acknowledged snapshot protocol must establish
actual delivery/commit. No persistent delivery guarantee is inferred.

Three controller tests pass: a peer joining after the first contribution was
lost; a dropped confirmation followed by duplicates and successful encrypted
application delivery; ignored unrelated traffic and queue overflow closing the
session. The two-context WSS test now uses this controller and starts exchanges
when each socket connects, without a harness step transferring contributions.
It passed with synthetic identities. The initial earlier stall remains unexplained;
these deterministic recovery cases do not retroactively identify its cause.

One instance covers one peer and one fresh transport session. Its caller must
replace it on reconnection or a peer restart and must serialize application sends.
Automatic multi-peer lifecycle, real enrolled WSS composition and Settings remain
unfinished. The module is still not mounted or deployed.

### Single-peer reconnection lifecycle

`peer-lifecycle.mjs` replaces its encrypted exchange on a new transport connection.
It invokes a supplied handshake factory each time; application wiring must supply
`openLocalRelayHandshake` so real membership and permission are reread. Socket
loss aborts the old instance. A peer's different contribution can replace the
current session only after its device signature/context and authority checks pass.
Known earlier nonces are ignored; up to 64 are retained in memory before further
churn refuses. Restarting this controller does not provide durable replay history:
fresh transcript/key confirmation remains the acceptance boundary after restart.
Both lifecycle and exchange queues are bounded. This is one selected peer, not
multi-peer discovery or persisted configuration.

The WSS browser fixture now composes the lifecycle, closes just one device's
socket at the server, and verifies both devices establish a second fresh session
and deliver another encrypted message without manual signaling. It also injects
an altered unsigned restart contribution and a previously seen old contribution,
then verifies traffic continues. A rejected authority callback during sending
aborts the session and changes status to `peer-unavailable`. These callbacks and
identities are still synthetic in the network fixture; actual enrolled permission
checks remain separately covered by `ENROLLED_RELAY=1`.

Two lifecycle unit tests cover disconnect while identity restoration is pending
(no late send/session leak) and failed restoration (no uncontrolled retry after
permission refusal). Handshake tests remain passing. This development is not yet
wired to Settings, saved-journey snapshots or a user-selected actual relay. The
previous unexplained first-run stall remains recorded, despite these new passing
reconnection and fault-injection cases.

### Saved-journey connection composition

`journey-connection.mjs` now combines relay transport/lifecycle with installed
identity, explicit peer permission, and the existing bounded snapshot/commit-receipt
exchange. Each new session reloads the authorized snapshot adapter and initiates
synchronization. Send operations are serialized and capped; overlapping refresh
requests schedule another latest snapshot rather than silently losing an edit.
A received commit notifies the enclosing app; it does not itself reconcile planner
preferences, navigate the UI or transfer local learning history.

`ENROLLED_RELAY=1` now checks this composition with the actual enrolled identities
and IndexedDB replicas using a controlled relay transport. Both replicas converge,
a local edit made while one transport is disconnected arrives after fresh key
agreement on reconnect, and permission removal refuses another synchronization.
This exposed and fixed a teardown bug: an old exchange's expected session abort
was wrongly disconnecting the newly opening lifecycle. The passing rerun covers
that failure. Actual WSS and enrolled-state checks are still separate fixtures.
The generation-aware codec/adapter path is present but not yet covered by this
relay composition test; checkpoint catch-up is not automatic here.

Peer exchange now retains at most 32 encrypted application frames arriving while
local key confirmation is pending, then processes them after confirmation. This
prevents a lost confirmation from making the first auto-sync chunk disappear.
The dropped-confirmation test verifies no plaintext is delivered before confirmation,
then the buffered and later messages arrive in order without resetting sequence.
These source changes remain unmounted and undeployed. Next integration requirements
include generation-aware receipt checks, actual enrolled WSS flow, chosen-relay
Settings/persistence and planner reconciliation after incoming changes.

### Combined enrolled-device WSS check

`ENROLLED_RELAY_NETWORK=1 node experiments/at-credentials/peer-delivery.test.mjs`
(with the pinned runtime and Chromium environment) now runs the enrolled snapshot
composition through actual loopback TLS WebSockets. A temporary local test server
independently verifies greeting signatures, forwards opaque frames, and closes the
owner socket to trigger automatic reconnect. Actual acknowledged enrollment,
separate IndexedDB device stores, sharing permissions, bounded encrypted transfer,
commit receipts and offline-edit convergence are exercised together. Removing
consent refuses the next synchronization. This uses the production transport
implementation, not the controlled transport callback from the earlier test mode.

The server must observe at least three verified greetings and forwarded frames;
fixture journey labels must not occur as plaintext in those bytes. That last check
is an observation, not a cryptographic security proof. Identities, addresses and
AT keys throughout the broader fixture are synthetic. A test-only TLS certificate
exception is scoped to this browser context, and temporary certificate files and
sockets are cleaned up. Requires OpenSSL and the installed Playwright bundle.

These are two enrolled controllers/stores on one browser host, not two physical
devices or the rendered Along Settings flow. The separate isolated-context WSS
fixture covers browser separation with synthetic identities. External R2 relay
interoperability, generation-aware relay snapshots, checkpoint catch-up, persisted
endpoint selection, public app integration and release acceptance remain open.

### Generation-aware enrolled WSS check

`RELAY_GENERATION=1 node experiments/at-credentials/peer-delivery.test.mjs` now
passes with the pinned runtime/Chromium environment. It runs the actual enrollment,
reviewed migration and two signed checkpoint recoveries, then connects both
reviewed generation-two replicas through real local WSS. The receipt is
`peer-saved-generation-snapshot`; both replicas converge. The network receipt
leaves planner preferences untouched until the existing reconciliation adapter is
called, which exposes the shared saved place and preserves independent history.

After a server-forced disconnect, a generation-two edit made during reconnect is
shared automatically. A real signed checkpoint advances the owner to generation
three; its old connection then refuses synchronization, and the recipient replica
revision remains unchanged. The fixture intentionally leaves the owner's next
review pending. Recipient generation-two saved data/history survives a fresh page.
The broader checkpoint, consent and credential tests also pass in this run.

This verifies the previously untested generation-aware relay path. It does not
implement automatic checkpoint catch-up through the relay, merge differing
generations, accept recovery choices automatically, or test rendered Settings.
Endpoint persistence/selection, app reconciliation callbacks, multi-device lifecycle
and the release/device acceptance work remain outstanding.

### Durable explicit relay choice

`configuration.mjs` adds an identity-bound IndexedDB preference under
`along-relay-configuration-v1`, keyed by established group. There is no default
endpoint and no network access from reading/saving it. An explicit WSS endpoint
and enabled flag are distinct from membership and journey-sharing consent. Save
checks the actual installed identity and all observed authority revisions in its
transaction. Removal writes a revision-preserving tombstone; a stale form cannot
silently restore an earlier enabled choice. Invalid stored data refuses rather
than selecting a fallback service. Credentials/query/fragment URLs are refused.

`STORED_IDENTITY=1` now also verifies explicit save, stale form refusal, removal,
stale re-enable refusal, credential-query refusal and an identity revision change
immediately before commit. A disabled endpoint survives a fresh page. This is
storage coverage, not a rendered Settings test; configuration is not yet mounted.

App integration uncovered a peer-discovery prerequisite: saved journey permissions
contain member IDs, but the other device's certificate is not consistently retained
by earlier manual connections. Relay discovery must authenticate that certificate
against the established group and existing permissions before starting a session.
Do not manufacture certificates, turn a relay roster into membership, or make users
repeat enrollment merely to select a relay. Settings and discovery remain pending.

### Verified peer discovery messages

`discovery.mjs` adds a fixed 304-byte signed announcement: `ALNRDS01`, the established
group public key, device public key, its 136-byte group certificate, a fresh random
32-byte announcement nonce, and a 64-byte device signature. The signature domain is
`along/relay/discovery/v1` plus NUL. This public metadata is visible to the selected
relay and must be disclosed by the opt-in UI. No journey, history, location or AT
key appears in an announcement.

Creating announcements uses the actual installed persona and observed authority
revision checks. Accepting one requires the exact established group, an existing
local journey-sharing permission, current certificate/membership evidence and a
valid device signature. Permission or membership changes during verification
invalidate the result. An accepted result is only `verified-discovery-hint`: it
supplies a certificate for the fresh session handshake, does not prove present
reachability, and never grants permission or installs membership. Replays cannot
replace the fresh key-confirmation requirement.

`ENROLLED_RELAY_NETWORK=1` now also verifies discovery using the actual enrolled
identities, including delivery through the loopback WSS relay. Missing consent,
self announcements, altered magic/group/member/certificate/nonce/signature,
cancellation and permission removal during signature verification refuse. A
read-only membership overlay containing a real issuer-signed removal rejects the
old announcement without altering the fixture's installed membership. Regranting
permission requires a fresh verification. The existing snapshot/reconnect checks
still pass in the same run.

This supplies the missing certificate-verification primitive. A bounded discovery
service still needs to schedule announcements, dispatch only allowed peers through
a shared relay socket, observe changed configuration and integrate with Settings.
No relay is automatically enabled and nothing here has been deployed.

### Shared optional relay service (not mounted)

`sharing-service.mjs` composes saved opt-in configuration, signed discovery and
protected journey connections over one socket per device. It dispatches at most
16 already permitted peers, with bounded input/output queues. Announcements run
while connected; every connection uses fresh authentication. Configuration changes
stop the service, including pending retries. Permission revision changes replace
all affected held sessions, and failed peer controllers are removed so later
verified discovery can retry. Discovery still does not enroll a new device.

`ENROLLED_RELAY_NETWORK=1` additionally runs `service-check.mjs` against the local
TLS relay using actual enrolled identities. It verifies no socket without opt-in,
certificate discovery without the harness supplying a peer to the service,
snapshot convergence, one-sided disconnect with an offline edit, reconnection,
permission revision/session replacement, and saved disable stopping further
sharing. The full enrolled browser fixture passes; the 22 relay unit tests pass.
This is one-host Chromium evidence, not S23 acceptance or external relay
interoperability. Settings integration, initial-pairing improvements and publication
remain unfinished. The published Device Preview remains 3805.

### Experimental Settings integration

The local experimental app now mounts `settings-view.mjs` under **Share saved
journeys with my devices → Automatic connection with a relay**. There is no default
address. Users can enter a secure WSS endpoint, enable it, stop automatic sharing
while retaining the address, or remove it. The screen discloses visible relay
metadata, browser custody limits, background suspension and the requirement to
pair devices and grant sharing separately. It does not solve first-time pairing.

`app-controller.mjs` restores the explicit saved choice during app startup and
owns the service independently of the dialog. Local saved changes trigger
synchronization; incoming merges reconcile into the planner without replacing the
current journey. Interrupted migration or pending recovery review pauses relay
connections. Configuration and startup changes are observed while the app runs;
this is not a mobile background-service guarantee. Manual connections remain
available. Checkpoint catch-up still uses the existing reviewed transfer flow.

Build with `python3 scripts/build_experimental_app.py --runtime
releases/along-r2-runtime-1b9229ad`, then run
`node experiments/relay/app-settings.test.mjs` with `CHROMIUM_PATH` configured.
The test serves the actual generated app and independently verifies signed
WebSocket greetings at a local TLS relay. It covers default-off, address validation,
keyboard opt-in at 360px width, reload restoration, persistent stop, removal,
Back/Escape focus, and interrupted-recovery pause. Existing
`experiments/journey-sync/startup-settings.test.mjs` covers recovery UI regression.
Peer exchange remains covered by the separate enrolled service fixture. Neither
check proves physical-device pairing, external relay compatibility, or release
readiness. The public preview is still 3805; this integration is not deployed.
