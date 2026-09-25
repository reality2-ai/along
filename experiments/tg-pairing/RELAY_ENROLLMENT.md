# Complete enrollment through the chosen relay

This is an Along application transport adaptation within the approved browser
software-storage subset. It does not declare a standard R2 enrollment API.

`relay-enrollment-link.mjs` and `relay-enrollment-session.mjs` are adapted from
the MIT-licensed public runtime built from Along commit
`82377f117f99d84b000319ac04917a2420db0e84` (`vendor/r2-browser`). See
[`R2-MIT.txt`](../../vendor/r2-browser/R2-MIT.txt) for the licence and
[`R2-SCOPE.md`](../../vendor/r2-browser/R2-SCOPE.md) for its scope. Their protocol,
comparison, confirmation, reservation and receipt logic is unchanged. Their
transport factory is supplied explicitly instead of importing the WebRTC link.
The original runtime bundle and its provenance remain unchanged.

`relay-enrollment-peer.mjs` separates signalling and enrollment messages on the
reviewed invitation channel. Its offer and answer each contribute a fresh 32-byte
nonce. A domain-separated SHA-256 hash of the canonical ordered pair becomes the
existing enrollment exchange's channel transcript. The invitation channel already
binds its endpoint, expiry, descriptor and temporary routing identities through
HKDF; it is not membership authorization. The existing X25519 commitment/reveal,
comparison code and protected membership material remain mandatory. No durable
traffic key is sent as clear channel data, and no application sharing is implied.

Automatic enrollment explicitly supplies this transport to the core candidate
session. Manual pairing retains the original session factory. The invitation
channel permits at most 32 messages per direction, two outstanding sends,
16 KiB packets and the existing 60-second deadline and frame pacing. This budget
now covers the entire enrollment, including confirmations and protected receipts.
Loss/retry handling remains in that channel. There is no STUN/TURN service or
direct-device connection on the automatic path.

The automated enrollment harness disables `RTCPeerConnection` before loading the
app modules. Passing it proves the flow does not silently depend on direct
WebRTC; a local hive still does not prove a deployed hive or physical-phone
acceptance. Endpoint consent, matching-code decisions, explicit sharing and
durable recovery remain required.

A deliberate close sends a protected close notification before releasing the
channel, with at most two seconds for best-effort delivery. Membership work and
view actions stop immediately. A dropped notification or abrupt browser loss
still terminates at the existing invitation deadline; there is no claim of
instant remote failure detection. Committed installation/acknowledgment promises
are settled before the view reports the durable state.
