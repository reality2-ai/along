# Current R2 browser connection: server/client handover

The deployment record now identifies Wairoa's working relay as compact UDP,
not a browser WebSocket endpoint. Along 43 still has the older optional relay
exchange. Neither fact establishes interoperability. This handover describes the
missing integration work; it is not a new R2 standard or an implemented binding.
The [review](R2_CURRENT_STANDARD_REVIEW.md) records source and deployment scope.

## Status — server work delivered 25 September

The server owner has deployed `wss://wairoa.mariko.org.nz/r2` (subprotocol
`r2.extended.v1`, one extended L4 frame per binary message) and published its
binding contract. See the [review](R2_CURRENT_STANDARD_REVIEW.md#server-update--extended-websocket-binding-delivered).
The request below is kept as the record of what was asked. The Along section is
now the active work.

## Server issue found 25 September — per-origin relay window

Along's integrated sharing works through a local stand-in that enforces the
host's stated per-origin replication limit (64 relayed frames per 10 s, L3
5.7.2). Against the deployed host, handshakes succeed but the snapshot exchange
stalls. Direct measurement with synthetic origins
([rate-check.mjs](../experiments/r2-current/rate-check.mjs)): the host relayed
exactly 64 frames from one origin and then refused that origin's frames, still
refusing after 30 s and after 120 s pauses. A later run relayed nothing, not even
from a fresh origin ([evidence](evidence/r2-hive-origin-rate.json)).

Read-only source inspection suggests a unit mismatch: the host's clock ticks at
1,000 per second, while the mesh expresses its rate window and duplicate lifetime
as microsecond counts. That makes the window about 2.8 hours and duplicate
records about 8.3 hours. With only 32 per-origin rate buckets, a few dozen
origins, including this investigation's synthetic ones, can fill the table and
block every new origin until entries expire or the service restarts. This is a
server fix, owned by the server owner. Along should not work around it by
changing its origin identity. Along already paces below the stated limit
(56 frames per sliding 10 s).

Requested of the server owner: take the mesh window and duplicate lifetime from
the ruler's `ticks_per_second` (or a matching tick unit), redeploy, and confirm.
Along will then rerun the two-profile check through the deployed host with
`R2_HIVE_UPSTREAM=wss://wairoa.mariko.org.nz/r2`.

## Follow-up observation — 26 September

The new automatic-enrollment client connects through the deployed binding but
receives no reply to its first challenge before invitation expiry. Both browser
connections reported connected. A separate minimal two-connection protected EVENT
probe also selected `r2.extended.v1` and received host announcements, but no event
arrived in either direction. The local TLS stand-in passes the complete enrollment
with the same client. [Non-secret evidence](evidence/automatic-enrollment-hive-2026-09-26.json)
records the narrower observations; these checks do not independently prove the
cause of the host's missing forwarding. No server configuration was changed.

## Work for the server owner (delivered)

Provide a browser-accessible binding for current R2, preferably a secure
WebSocket stream if that fits the current hive architecture. Publish its binding
contract and exact endpoint before Along adopts it. The endpoint is a deployment
choice; `/r2` is not assigned by the current standard. Do not install the archived
signed JSON hello/welcome relay to accommodate Along.

The contract needs to state the L1 Clause 11 properties: transport ordinal and
complete profile, framing, frame limits, discovery participation, peer identity
association, connection lifecycle, silence handling and resource admission.
L1 8.2.4 allows profile-compatible bindings to share an ordinal; it does not make
an arbitrary WebSocket exchange conformant. Connection acceptance cannot replace
recipient-side L5 trust checks.

Resolve the **wire tier** explicitly. TCP/stream carriage normally uses extended
frames, while the reported Wairoa receiver uses compact UDP. L4 9.2.3 forbids
crossing an integrity-tagged frame between tiers. Do not strip a tag, expand a
compact protected frame into extended bytes, or decrypt/re-sign Along traffic
at an untrusted relay. A browser-to-browser extended path through the hive may
coexist with compact sensor traffic without requiring those protected frames to
cross tiers. Whether that path exists is an implementation question for the owner.

Return: endpoint, deployment/source revision, binding contract and a minimal
non-secret interoperability fixture. Resource credentials, if needed, must have
an explicit browser-compatible handling model; do not put shared secrets in the
public Along build. Existing field traffic and server configuration remain the
server owner's responsibility.

## Work for Along after the contract is established

**App integration, 25 September:** the sharing service and relay journey
connection now use [hive-relay-transport.mjs](../experiments/r2-current/hive-relay-transport.mjs)
by default. Along's existing signed discovery, per-peer handshake, pairwise
protection and chunked exchange run unchanged inside group-protected current
EVENT frames, divided above L4 to fit the 160-byte limit. The enrolled relay and
generation-two browser checks and the generated-app relay Settings check pass
through a local `r2.extended.v1` stand-in. Against the deployed host they are
blocked by the server issue above.

**Progress, 25 September:** Along's [current-frame client](../experiments/r2-current/README.md)
passes the published L4/FORMATS vectors and exchanged protected EVENTs between two
synthetic-group connections through the deployed host
([evidence](evidence/r2-current-live-exchange.json)). It is not yet in the app;
transport lifecycle, chunked journey exchange and the checks below remain.

Map its browser-only R2 subset onto the current binding and frame/runtime APIs.
The current Along hello, discovery and protected peer payloads are not current
L4 merely because they travel as binary WebSocket messages. Preserve saved data,
explicit sharing consent, credential custody and migration/recovery controls.
Do not erase or recreate user groups to make a test pass.

Verify two independent browser profiles across the real server: initial connection,
permitted discovery, saved-place/preference exchange, offline edit convergence,
reconnect, rejection after permission removal and group revocation, replay/tamper
refusal and bounded resource failure. Extend this to automatic security-update
propagation without treating successful journey exchange as proof of that feature.
Use current frame vectors and the real recipient gate. Perform physical S23 and
desktop checks after browser tests; loopback is not physical acceptance.

The relay remains optional and user-selected. Its absence or failure must not
interrupt offline planning or direct personal-key AT access. Nothing here
promises continuous background execution on Android or makes the relay a member
of the user's group.

## References

- [L1 transport](https://reality2.ai/standard/L1-transport.html): 4.2, 4.4.4, 8.2.4, 10 and 11.
- [L4 wire](https://reality2.ai/standard/L4-wire.html): 4.4 and 9.2.3.
- [L5 trust](https://reality2.ai/standard/L5-trust-and-identity.html): 7.1–7.3.

Published reading edition: 0.9.0, revision
`006d57a43fb936039050b123da9e4663471a4b9c`; check later revisions before implementation.
