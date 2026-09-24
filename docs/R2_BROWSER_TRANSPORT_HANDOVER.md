# Current R2 browser connection: server/client handover

The deployment record now identifies Wairoa's working relay as compact UDP,
not a browser WebSocket endpoint. Along 43 still has the older optional relay
exchange. Neither fact establishes interoperability. This handover describes the
missing integration work; it is not a new R2 standard or an implemented binding.
The [review](R2_CURRENT_STANDARD_REVIEW.md) records source and deployment scope.

## Work for the server owner

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
