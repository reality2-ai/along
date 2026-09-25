# Current R2 client — frames, protection and live exchange (development)

This directory implements the Along side of the current R2 browser binding,
`wss://wairoa.mariko.org.nz/r2` with subprotocol `r2.extended.v1` (server
contract: owner record `6575dd40`, deployment `0b27785a`). It follows the
published standard 0.9.0, revision `006d57a43fb936039050b123da9e4663471a4b9c`,
written independently from the published clauses. No private implementation
source is copied. It is **not yet wired into the app** and does not replace the
archived-relay code in `experiments/relay/`.

| Module | Published basis |
| --- | --- |
| `names.mjs` | L4 7.1 normalisation and FNV-1a event identifiers |
| `frame.mjs` | L4 4.1–4.3, 5, 8 and 10.2 frame layout, route record and authenticated span |
| `cbor.mjs` | L4 11 and FORMATS 4b deterministic CBOR (PROVISIONAL SS95) |
| `protection.mjs` | FORMATS 3.3–3.5 wire identities, 4.1–4.3 XChaCha20-Poly1305 envelope (PROVISIONAL SS35), L4 10 HMAC-SHA256 tag and the L5 7.1/7.3.3 fail-closed recipient gate |
| `duplicates.mjs` | L3 5.3 time-bounded duplicate suppression on (origin, message id) |
| `heartbeat.mjs` | L2 5 announcement body in a non-relayed HEARTBEAT |

XChaCha20-Poly1305 is not in WebCrypto; the vendored `@noble/ciphers` subset
provides it and is checked against the draft-irtf-cfrg-xchacha A.3.1 vector,
which libsodium 1.0.22 reproduces. HMAC, SHA-256 and HKDF use WebCrypto.

## Verification

- `node --test experiments/r2-current/*.test.mjs`: every published L4 frame,
  span-mutation, malformed-frame and name vector; FORMATS FV-001, FV-005–FV-010,
  FV-021 group half, FV-022 and FV-023; protected round trip, tamper, wrong-key,
  wrong-address, untagged, relay-mutation and relay-limit cases.
- `node experiments/r2-current/live-check.mjs <url> [evidence.json]`: two
  independent connections in a synthetic group exchange protected EVENTs through
  the deployed host. Result: [live exchange](../../docs/evidence/r2-current-live-exchange.json).
  The host forwarded both directions (hop 4→3, route entry appended), suppressed
  an identical resend and forwarded, but Along refused, a frame under another key.

The published standard has no vectors for encrypted payloads or HKDF, so those
are checked by round trip and against independent cipher vectors only.

## Decisions and open points

- **Build mode:** the public build is production and emits no development
  element (L2 5.4a). A development declaration would confine Along to the
  development group (L5 9.2).
- **Keys:** Along's existing epoch-0 derivation (`HKDF-SHA256`, IKM group seed,
  salt group public key, info `r2/v0/group/payload` / `r2/v0/group/integrity`)
  matches FORMATS 4a. The salt reading is not explicit in the published text.
  Later-epoch keys remain Along-specific because the standard defines no
  rotation derivation or bundle (L5 13.9).
- **Discovery:** the host sends HEARTBEATs at hop 1 and does not forward a
  client's HEARTBEAT, so Along members must find each other with group-protected
  EVENTs, not beacons. The heartbeat origin carries the group half, as the host
  does; whether L2 5.3 a) forbids this is open with the standard owner.
- **Size:** relayed payloads are limited to 200 bytes, leaving 160 bytes of
  CBOR per frame. The standard has no fragmentation (L4 6.2); journey and
  preference exchange must be divided above L4 into independently protected
  pieces, pulled and reassembled by the receiver.
- **Attribution:** the gate proves only possession of a group key (L5 7.2).
  Consequential operations such as removal and revocation need member-signed,
  fresh evidence; its byte format is still owed by the standard (L5 13.4–13.5).

## Next work

1. A browser transport over this binding: reconnect within ten seconds while
   runnable, heartbeat every two seconds while visible, duplicate suppression,
   inbound rate discipline and own-frame suppression.
2. A chunked, idempotent exchange of saved journeys and preferences within the
   160-byte plaintext limit, with member-signed consequential operations.
3. Replace the archived-relay path in the app, preserving saved data, explicit
   opt-in, custody and revocation; then the two-profile browser qualification in
   the [handover](../../docs/R2_BROWSER_TRANSPORT_HANDOVER.md) and physical checks.
