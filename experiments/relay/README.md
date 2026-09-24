# Optional relay transport — development only

The user approved an optional user-selected R2 relay on 24 September 2026.
Nothing here is mounted in Along or deployed. No endpoint is selected, contacted
or enabled automatically. Planning and direct AT access remain independent.

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
