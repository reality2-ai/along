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
wrapper still needs the real IndexedDB integration test before app mounting.

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
