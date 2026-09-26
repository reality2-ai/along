# Signed group-removal delivery — development, not published

The selected relay service can carry issuer-signed removal records alongside
its existing discovery and journey packets. Offline planning and direct AT
requests do not depend on it. No default relay or new permission is introduced.

The application packet is `ALNRMV01`, the established 32-byte group identifier,
and one existing 113-byte removal-set record. It fits in 153 bytes before the
existing protected-EVENT fragmentation. This is an Along application profile,
not a new R2 wire-format claim. Encoding/decoding does not establish authority.
The receiver calls the existing `receiveRemovalSet`, which verifies the issuer
signature against its established membership and commits atomically.

Each announcement cycle sends at most four records, no more often than once
per ten seconds. A round-robin cursor repeats known records for returning devices;
the existing origin pacing and queue bounds also apply. Export remains capped
at 256 records. A sent packet is not an acknowledgment of remote storage.
Repeated valid records do not advance membership revisions. Invalid evidence is
ignored; storage failure does not authorize applying the notice in memory only.

The receiver's existing membership guards stop stale sessions and reopen valid
ones. A removed device must stop authorized sharing once it learns the removal.
This cannot recall copied data or an AT key. AT-side key replacement remains
necessary for an exposed credential.

This step requires devices to share usable traffic keys. It does not deliver new
epoch secrets to a stale device, replace explicit key-update review, prove that
all offline devices received a notice, or guarantee mobile background execution.
Key-recovery carriage remains separate work. Public Along remains version 45.

## Verification

`node --test experiments/relay/removal-notices.test.mjs` checks bounded framing,
wrong-group/truncated/noncanonical refusal and the explicit distinction between
codec decoding and signature verification. These tests do not verify cryptography.

The enrolled browser service check now applies a new signed removal only to the
sender. The receiver must learn it through the TLS hive stand-in before membership
renewal and resumed journey exchange. The first run passed, with 1,539 frames, eight connections and zero rate-limited
drops. It uses independent device stores on one browser host, not physical
devices or a deployed hive.
The additional `REMOVAL_EDGES=1` run passes tampered-signature refusal,
wrong-group codec refusal, durable-write failure and cancellation at the
transaction boundary using the real browser verifier/store. Those fault cases
call the same receive adapter directly; they are not network-fault injection.
Actual local TLS relay checks prove offline catch-up and self-removal: the receiver
learns the signed notice, stops sharing, cannot reopen authorized sharing, and
retains its saved places. Repeated valid delivery leaves its membership revision
unchanged. See [the recorded scope](../../docs/evidence/removal-notice-edge-browser.json).

Stale-epoch key-recovery carriage, generated-app release qualification, deployed
hive interoperability and physical-device acceptance remain outstanding.
