# Current R2 transport review — 25 September 2026

The user corrected the relay reference: the standalone `r2-relay` project belongs
to an older R2 iteration. Its passing loopback tests establish compatibility with
that pinned implementation only. They do not establish compatibility with the
current standard or the user's running hive. No server-AI message supplied the
previously suggested `/r2` address; it was an inference from the older project.

## Source and findings

Read the published [standard](https://reality2.ai/standard/) directly over HTTPS.
The [edition record](https://reality2.ai/standard/history.html) identifies version
0.9.0, revision `006d57a43fb936039050b123da9e4663471a4b9c`, a working draft.
The older local `r2-specifications/specs/r2-core/R2-TRANSPORT-RELAY.md` is not the
basis for this current-standard assessment.

- [L1](https://reality2.ai/standard/L1-transport.html) 4.2 requires unchanged frame
  carriage. Section 4.4.4 permits connection screening for resource protection,
  but forbids treating acceptance as authentication of the frames.
- L1 10.4 describes reconnecting with an increasing, bounded interval while the
  bearer remains in service. Section 11 requires a binding to specify framing,
  peer identity association, limits, discovery participation and lifecycle.
- [L4](https://reality2.ai/standard/L4-wire.html) 4.4 limits a routing relay's
  changes to hop limit, replication budget and route record. This routing role
  differs from an L1 carrier, which preserves the entire inner frame.
- [L5](https://reality2.ai/standard/L5-trust-and-identity.html) 7.1 requires
  recipient-side, fail-closed delivery checks. Sections 7.2.2–7.2.3 say group-tag
  verification alone establishes neither individual identity nor freshness;
  consequential operations need additional evidence.

The published L1 document does not specify a WebSocket URL, path, subprotocol or
JSON hello/welcome exchange. Its contents currently link radio bindings, not a
complete browser WebSocket binding. A `/r2` URL or a running hive alone therefore
cannot establish interoperability. This is a bounded finding about the published
edition, not a claim that no implementation-specific binding exists elsewhere.

## Along implications and next integration work

Along currently emits signed JSON `hello` version 1 in
`experiments/relay/hello.mjs`; its transport expects version-1 welcome messages.
Its peer discovery and protected sharing formats are Along-specific. Merely
changing the URL or dropping the greeting would not make those bytes current L4
frames. Existing tests remain useful historical compatibility evidence.

Obtain the server implementation's current browser transport contract: source
revision, endpoint, framing/subprotocol, identity association and any connection
admission requirements. Then map the approved browser-only subset to that contract,
using current shared runtime capabilities where available. Verify frame vectors,
recipient authentication, replay/permission/revocation rejection, two-device
exchange and reconnection before claiming current-hive compatibility. Preserve
software-custody limits and existing local data during any migration.

The server AI retains server configuration ownership. Along does not select a
relay by default. Offline planning and direct AT access remain independent.
Do not ask the server owner to deploy the older relay merely to fit Along.
