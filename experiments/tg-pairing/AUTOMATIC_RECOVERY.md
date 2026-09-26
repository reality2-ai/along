# Guided recovery transport prototype

This is development work after public v45. It is not yet connected to the app's
recovery screens or published. Normal guided enrollment remains a separate flow.

The owner selects an existing member and creates one short-lived recovery
invitation for an explicitly chosen relay. The recipient must already hold that
group identity and its saved issuer. The invitation is not an enrollment grant.
After relay consent, `automatic-epoch-recovery.mjs` exchanges signed removal
snapshots, the current recipient certificate, offer and answer automatically.
The existing recovery session then mutually verifies both identities against the
transport transcript. Its explicit recipient acceptance, ordered epoch installs
and signed installation receipts remain in charge of sending and saving updates.

## Protection and bounds

- The recovery envelope has a distinct strict parser, event, HKDF domain and peer
  transcript profile. Group, owner, intended member, relay, expiry and temporary
  routing identities are bound into the outer channel's key context.
- A fresh 256-bit invitation secret protects the bootstrap channel independently
  of the group's old or new traffic keys. The link uses `#recover=`, so its secret
  is not an HTTP query. The future receiving screen must clear the fragment from
  browser history immediately and obtain relay consent before networking.
- Recovery peer traffic has an additional ephemeral P-256 ECDH / HKDF-SHA256 /
  AES-256-GCM layer. Both public contributions and nonces enter the transcript
  that the existing identity proofs authenticate. Directional keys and ordered
  counters prevent reflection and replay. Invitation possession alone does not
  provide the ephemeral private keys needed to decrypt group-key updates.
  This is an Along application transport, not a new R2 standard profile.
- Secret buffers are cleared after derivation/use and references to ephemeral
  CryptoKeys are discarded on close. Browser software custody cannot guarantee
  hardware erasure or resist a compromised browser or same-origin script.
- The outer channel retains its one-minute invitation expiry, 32 messages per
  direction, 16 KiB packet ceiling and existing origin pacing. Signed removal
  snapshots retain their 256-record limit and are verified atomically after at
  most five 8,000-character chunks. Removal snapshots contain public signed
  security metadata, not application secrets.
- A large epoch gap or slow relay may exceed the bounded exchange. No epoch is
  skipped. An interrupted exchange may have saved some updates; a new invitation
  must use the device's actual saved certificate/version and continue from there.
  The interface must not describe missing confirmation as rollback or data loss.
- No journey sharing permission, relay preference, AT key or group identity is
  created/replaced by this transport. Relay consent remains the caller's job.

## Verification

Run the focused browser check with the public runtime paths documented in
[BUILDING](../../docs/BUILDING.md):

```sh
AUTOMATIC_RECOVERY=1 CHANNEL_CHECKS=1 \
  node experiments/tg-pairing/automatic-enrollment.test.mjs
node --test experiments/tg-pairing/relay-enrollment-peer.test.mjs \
  experiments/tg-pairing/recovery-link-protection.test.mjs
```

The browser check uses two isolated Chromium contexts and real browser storage,
WASM membership checks and a local TLS WebSocket relay stand-in. WebRTC is
explicitly disabled. The harness transfers the initial invitation only; all
later connection messages, identity proofs, updates and receipts use the relay.
It checks two stale epochs, acceptance before sending, cancellation before
acceptance, deliberately lost final confirmation, preserved recipient identity
and a subsequent receipt-only retry without resending or rewriting installed keys.
The lost-confirmation test rejects the inner encryption call for that one frame;
it is an injected send failure, not evidence about real packet-loss behaviour.

Channel fault checks separately test strict invitation parsing, changed identity,
group, endpoint and secret rejection, encrypted carriage and enrollment/recovery
separation. Unit checks cover transcript binding, directional protection,
replay/reflection/tamper refusal and a simulated invitation observer without the
ECDH private key. They do not establish formal protocol security.

See [dated evidence](../../docs/evidence/automatic-recovery-transport.json).

## Remaining work

Connect this transport to the owner and recipient guided screens, hide manual
exchange under Advanced, remove invitation fragments promptly, and verify actual
user consent, Back/cancel, expired invitations and truthful partial-installation
messages there. Test large removal snapshots, wrong/removed peers and interrupted
intermediate installs through this new automatic path. Existing direct-recovery
refusal checks are useful regression evidence, not substitutes for these cases.
Then qualify a new app version and publish it. The selected public hive still
needs a forwarding check, and S23 optical scanning/pairing and spoken TalkBack
acceptance remain separate physical checks. Do not publish this prototype over v45.
