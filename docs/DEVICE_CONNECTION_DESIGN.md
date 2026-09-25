# Simple device connection — user requirement, 26 September 2026

The user reports that the whole connection process is too complicated. Treat this
as a failure of the normal workflow, not a request for more setup instructions.
The target is one guided connection with automatic return-message exchange.

## Normal experience

1. Settings → **My devices** → **Connect another device**. Show a QR and an
   accessible copyable invitation link. Explain that the other device joins this
   person's devices; show expiry and Cancel without protocol terminology.
2. Scan on the other device, or open the invitation link in Along. Preview the
   connection and request consent before contacting its user-selected relay.
   Do not silently replace an existing device group. Explain a conflict while
   preserving saved journeys, credentials and the existing setup.
3. Both devices show the same short comparison code. Each person confirms that
   the codes match. The relay carries return messages automatically; there is no
   second QR, offer/answer text or separate journey-connection ceremony.
4. Review **Share saved places and preferred services** as one clear choice.
   AT-key access is separate, off by default, and optional after connection.
   Confirmed membership alone must not silently grant application permissions.
5. Show **Connected** only after the required durable acknowledgments. Return to
   the journey. Permitted devices reconnect when online and Along is running;
   offline edits stay local and reconcile later. No permanent mobile-background
   promise.

The QR/link identifies a short-lived enrollment session, not an AT key or durable
group secret. Sensitive invitation material must not leak into query logs,
analytics or public feedback. The exact invitation format and relay carriage
must be designed and tested against the existing enrollment proof, comparison,
installation and receipt contracts; this document does not declare a new wire API.

## Progressive disclosure and failure

Keep only the current action prominent. Show a concrete waiting state such as
“Waiting for confirmation on your other device.” Cancel and Back remain available
without losing the journey. Recovery, key rotation and transport configuration
are under Advanced; manual message transfer is an explicit fallback, not the
normal path. Retrying must detect a completed local installation and recover its
receipt rather than create another identity or tell the person to erase storage.

Relay use remains optional and user-selected under the existing authorization.
Where none is selected, disclose that one is needed for the simple online flow;
do not silently select a public server. An invitation may propose its sender's
endpoint for explicit acceptance. Offline planning never depends on connecting.

## Implementation and acceptance

The current `pairing-flow.mjs` and device Settings expose separate setup,
enrollment, manual connection-message and sharing steps. The new current-R2
transport carries already-authorized sharing; it is not yet a one-scan enrollment
transport. Reuse verified enrollment and custody components behind the new
controller rather than weakening their checks to reduce visible steps.

Build and test automatic invitation rendezvous and authenticated return-message
carriage before presenting the one-scan flow as working. Verify malicious/expired
invitations, altered endpoint/session data, mismatched codes, cancellation,
replay, interrupted installation and reconnection. Keep initial enrollment and
later permitted-peer discovery distinct internally even though users see one
coherent process. Server implementation/configuration remains with its owner.

Acceptance: two fresh browser profiles connect with one invitation scan/link,
matching-code confirmation and a sharing choice; no copy/paste or return QR on
the normal path. Existing-group devices retain their data on cancellation and
conflict. Test keyboard, spoken announcements, narrow screens, offline failure,
reload/recovery and real S23/desktop use. The human writes no code.

This is the accepted redesign target, not a claim that it has shipped.


## Implementation progress

`experiments/tg-pairing/automatic-signalling.mjs` now sequences the invitation
challenge/proof and connection offer/answer over a supplied invitation channel.
Candidate session creation follows successful proof verification. It fails closed
on unexpected or oversized messages and cancels sessions that finish creating
after cancellation. Five Node tests pass with synthetic channels and session
callbacks, including cancellation while proof verification is pending: its unused
WASM capability is released without creating a session.

`automatic-enrollment.mjs` now connects that sequencer to the existing real
invitation proof, browser-software issuer and core candidate ceremony. A Chromium
test between two independent storage profiles verifies automatic challenge,
proof, offer and answer; identical comparison codes; no installation before
explicit confirmation; durable installation and acknowledgment; and restoration
and signing after reload. The harness supplies a reviewed invitation and moves
bytes between the profiles. It does not supply protocol replies or bypass the
proof/core. This is not a public rendezvous or physical-device acceptance test.

Run the focused checks with:

```sh
node --test experiments/tg-pairing/automatic-signalling.test.mjs
CHROMIUM_PATH=/path/to/chromium \
R2_BROWSER_DIR=/path/to/verified-runtime/browser \
R2_WASM_DIR=/path/to/verified-runtime/wasm \
node experiments/tg-pairing/automatic-enrollment.test.mjs
```

Next connect an invitation-scoped channel through the current hive binding,
then build the guided view and sharing handoff. Existing group-protected sharing
requires already-enrolled members; it cannot itself bootstrap a new device.
No new public release yet.

## Bootstrap channel progress (26 September 2026)

`connection-invitation.mjs` and `invitation-channel.mjs` implement an
Along-specific, short-lived bootstrap channel over the current hive binding.
A fragment-only link contains the invitation descriptor, the chosen relay,
expiry, temporary routing public keys and a random 256-bit channel secret.
It contains no AT key or lasting group key. The secret is a bearer capability
for this channel; possession does not authorize enrollment. The existing signed
invitation proof, comparison and core installation checks remain mandatory.

HKDF binds the temporary encryption/integrity keys to the descriptor, relay,
expiry and routing names. This is an Along application envelope, not a new R2
standard enrollment API or proof of full R2 conformance. The relay sees connection
metadata and temporary routing identifiers, but receives protected signalling
frames. Browser history/clipboard copies of a link can disclose its temporary
secret; the eventual receiving view must remove the fragment immediately and
show the proposed relay for explicit consent before connecting. Nothing is
persisted or enabled merely by parsing a link. Do not share invitation links.

Messages are segmented above L4 to fit the hive's 200-byte protected-payload
limit, paced below its documented replication limit, acknowledged and retried.
Receivers deliver each sequence number once. Packet size, pending messages,
reassembly entries, receive queue and lifetime are bounded. Expiry and Cancel
close the socket and reject pending sends. Temporary key bytes and incomplete
reassembly buffers are cleared on close; this is best-effort browser memory
cleanup, not a claim that JavaScript strings can be securely erased.

The real two-profile enrollment test now also passes through the local TLS hive
stand-in with `AUTOMATIC_RELAY=1`. `CHANNEL_CHECKS=1` additionally covers malformed
and expired invitations, fragment-only links, dropped fragments and acknowledgments,
duplicate delivery, wrong secrets, altered endpoint context and cancellation.
The normal sharing reassembly bound remains 4 KiB; bootstrap explicitly permits
16 KiB. Twenty-six focused Node tests pass, including the unchanged frame,
protection, transport and sharing tests.

The deployed-host attempt did **not** pass. Both browser connections selected the
binding, but only the first challenge was sent before expiry. A separate minimal
protected-frame probe also received host announcements but neither peer's event.
See [the non-secret evidence](evidence/automatic-enrollment-hive-2026-09-26.json).
This is consistent with the previously reported server forwarding issue, but does
not by itself establish its cause. Server configuration remains with the server
owner. A local stand-in pass does not establish deployed interoperability.

Remaining: guided screens, immediate fragment/history handling, invitation review
and relay consent, sharing-permission handoff, deployed relay exchange and physical
S23/desktop acceptance. The public application has not changed.

## Guided app integration (26 September 2026, local candidate)

The local candidate now exposes **My devices → Connect another device**, with
manual exchange, recovery and key-management operations under **Advanced device
options**. A fresh receiving browser can open the invitation link without first
creating its own group. Existing issuer/enrolled groups are kept and reported as
a conflict; the guided path never silently replaces them. The invitation review
shows the selected relay and waits for a deliberate connection action.

One code comparison leads to durable enrollment, then **Choose what to share**.
The sharing screen explicitly saves saved-place/service permission for the
verified peer and the selected relay preference. It grants no AT-key permission.
Existing app relay discovery and exchange then run without a second manual
journey-connection ceremony. **Not now** keeps sharing off for a new peer.

The generated app was tested on a static `/along/` subpath with two fresh browser
profiles. Both saved an address pair through the real planner UI. The inviter
created its group through Settings; the receiver opened one invitation link,
confirmed the matching code and chose sharing. Both original address pairs then
appeared on both devices through the local TLS hive stand-in. The test provides
no fixture identity, membership, sharing permission or copied return messages.

An integration failure uncovered same-document navigation: opening a fragment
link while Along was already open did not rerun startup. The app now consumes
invitations both at startup and on `hashchange`, immediately removing the secret
fragment from browser history and showing review without opening the relay.
The full-app test exercises this already-open case. Separate component checks
cover keyboard activation, narrow layout, automated accessibility, no candidate
relay contact before consent, durable reload and comparison cancellation.

The source build remains marked **DO NOT PUBLISH**. This is local implementation
and test evidence, not acceptance on the deployed relay or a Samsung S23.
Remaining checks include interrupted-installation behavior of this new view,
existing-group conflicts, offline/reload sharing and new-flow spoken screen-reader
use. Public-host forwarding remains unresolved. The complete release qualification
and versioned publication have not been performed for this change.

Reproduce the generated-app check after building a local candidate:

```sh
python3 scripts/build_upgrade_candidate.py --runtime /path/to/verified-runtime
REGULAR_CANDIDATE=1 CHROMIUM_PATH=/path/to/chromium \
node experiments/relay/guided-app.test.mjs
```

The final local checks also pass existing relay enable/restore/stop/remove,
interrupted-recovery pause, direct mocked AT access, quiet offline fallback,
address-to-address bus/ferry planning and stalled optional-runtime isolation.
[Local evidence](evidence/guided-device-connection-local-2026-09-26.json) records
the source hashes, candidate manifest hash and test scope. Older-release tests
recognise both the historical setup label and the new My devices label.

## Interruption and offline checks (26 September 2026)

The guided view now has passing checks for installation and acknowledgment
transactions that commit immediately before their promises return and the peer
closes. It waits for those promises, reports the saved state accurately and
restores the member after reload. An existing issuer group is refused before
candidate networking; its persona and encrypted custody revisions remain intact.

The generated-app test also removes a saved address pair offline, reopens offline,
then reconnects automatically and propagates the removal without a new invitation.
Both copies retain the result after online reload. HTTP offline emulation and
explicit WebSocket blocking establish the test's offline boundary. Chromium is
configured to trust the local fixture certificate so its service worker can
actually install; merely ignoring page certificate errors did not establish that.

These checks are now required by the version-44 candidate qualification and
packaging scripts. They do not change the unresolved deployed-host or physical
acceptance status.

## First v44 qualification findings

The first fixed-build qualification (`fbfa0ce8d958`) completed with failures and
must not be used to package a release. Four checks reached the relocated removal
control without opening Advanced; two older-version checks lacked their pinned
v37 archive. The removal entry is now constructed before membership restoration,
so signed removal can still be received when ordinary identity loading fails.
The test navigation now opens Advanced. The public v37 archive was fetched and
matched the existing SHA-256 pin; tests now use a durable releases/ fixture path.

A separate scan-path review found that the new invitation input had no explicit
maximum length, while the shared scanner requires one. It now accepts bounded
invitation links and advances a successful scan straight to review, releasing the
camera. A camera/decoder-stub browser check passes the subsequent real proof,
comparison, installation and sharing-choice flow. This verifies the application
scan path, not optical QR recognition or physical phone use. The scan check is
now an additional required v44 qualification gate. A fresh complete qualification
is required after these corrections.


## Local qualification and remaining transport gap

The corrected source `49d8b8ae234234c8b223764da410d9ee99b833b6` passed all
32 distinct qualification scenarios (plus two recorded aliases), with source and
candidate hashes unchanged throughout. [Qualification evidence](evidence/guided-v44-local-qualification.json)
records the commands and log hashes. The 360 × 780 browser screenshots were also
reviewed: invitation review, code confirmation and sharing have visible full-width
primary actions. These are local Chromium checks, not S23 or TalkBack acceptance.

A further source review found an important transport limit. The pinned public
runtime's `enrollment-link.mjs` calls `createPeerLink`, whose
`RTCPeerConnection({iceServers: []})` has no STUN/TURN configuration. The new
invitation channel carries challenge/proof and connection descriptions through
the hive, but comparison and installation still use this direct data channel.
Successful same-machine browser tests therefore do not establish initial pairing
across different networks or Wi-Fi with client isolation. Later permitted sharing
uses the hive; it does not remove this initial-enrollment constraint.

Do not present the redesign as seamless across networks or publish it as a fix
for all pairing timeouts on the strength of the local qualification. Next Along
work is to carry the complete enrollment over the explicitly accepted relay,
retaining proof verification, transcript binding, code comparison, bounded
messages, explicit decisions, durable installation and receipts. This is an
Along browser-subset transport adaptation, not a claim of a new standard API.
Verify it with direct WebRTC unavailable, then repeat cancellation, replay,
interruption and offline/reconnect checks. The server owner separately needs to
resolve deployed-host forwarding. Do not add an undisclosed third-party TURN
service or recreate existing user groups.

Version 44 remains a local candidate, not a published release. GitHub authentication
was unavailable during this work; the public app remains version 43. Physical
S23/desktop and spoken-screen-reader checks remain outstanding.


## Complete relay carriage implemented locally

The direct-path limitation above has now been removed from automatic enrollment.
The [Along transport adaptation](../experiments/tg-pairing/RELAY_ENROLLMENT.md)
carries the comparison, explicit decisions, protected claim/material and durable
receipts through the invitation channel, in addition to its proof and connection
contributions. The public runtime bundle remains unchanged; adapted MIT-licensed
link/session modules accept the relay transport while preserving the original
checks. Manual fallback retains its original transport.

The full software enrollment and guided scan checks pass with
`RTCPeerConnection` disabled. The generated app also exchanges saved places,
reopens offline, preserves an offline removal and reconnects automatically with
WebRTC disabled. Interruption tests exposed missing prompt remote cancellation;
a protected best-effort close message now handles deliberate cancellation, while
abrupt loss still expires. Installation and acknowledgment interruption checks
pass after that fix. A new complete fixed-source qualification is required;
the earlier 32-scenario record does not qualify these changed files. The new
carriage's transcript, invalid-message and cancellation tests are an additional
release gate.

The live hive was rechecked at 2026-09-25T22:31:29Z: WebSocket binding and host
announcements succeeded, but neither protected EVENT direction was forwarded.
GitHub authentication still returns HTTP 401. Neither external blocker has been
resolved by the local transport work, and no release has been published.
