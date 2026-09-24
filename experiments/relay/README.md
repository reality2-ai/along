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
`sign_relay_hello` API. Notekeeper's greeting and encrypted frame formats must be
traced to their implementation and matched explicitly; sharing an R2 name does
not establish interoperability. No new runtime export or alternate credential
scheme is assumed by this prototype.

Run `node --test experiments/relay/transport.test.mjs`. Six tests use controlled
socket/timer doubles: URL restrictions; greeting/frame/heartbeat bounds; reconnect;
disconnect during pending authentication or retry; pre-greeting and unauthorized
traffic; and disconnect from a status observer. These do not establish actual
server interoperability, durable sync, encryption, browser network reachability or
physical-device success. Next: verified greeting/protection integration, real local
WebSocket tests, peer authorization and replay handling, persistent user-selected
configuration, app lifecycle/reconciliation, then physical checks.
