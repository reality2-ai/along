# Along version 44 — prepared locally, not published

Connecting devices now uses one invitation scan/link, matching-code confirmation
and a separate sharing choice. A fresh device goes directly to **Connect another
device**; **Create invitation** creates its local keys after the storage explanation.
Opening or cancelling setup does not create a group. Advanced manual and recovery
controls remain available; existing groups and saved places are preserved.

The chosen relay carries the complete enrollment, including protected installation
receipts. The automatic path requires no direct WebRTC connection, STUN or TURN.
Saved places and service preferences reconnect after explicit sharing consent.
AT-key access remains separate and off by default. Planning remains independent
of the relay. This is the approved browser-only R2 subset with software custody,
not hardware-backed storage or full standard conformance.

## Local evidence

- Source: `c4d5434b3d6462850b458a1e7dc880b6cb6652b3`.
- [Qualification](evidence/regular-v44-qualification.json): all 34 distinct
  scenarios pass, plus two labelled aliases. Source and candidate stayed unchanged.
  Includes installed v37–v43 upgrades, enrollment interruption, scan handling,
  offline reconciliation, recovery, rotation and permission removal.
- The reconnect test observed 1,519 frames over eight connections with **zero
  rate-limited drops**. Its pacing window is shared across replacement connections,
  reloads and tabs through atomic local storage.
- [Static candidate checks](evidence/regular-v44-candidate-static.json): offline
  address routing, keyboard, accessibility automation, narrow layout, zoom,
  update and storage failure behavior. Desktop timings are not phone benchmarks.
- [Local committed-source rebuild](evidence/regular-v44-local-source-rebuild.json):
  all 310 candidate files match byte-for-byte. Fixed data and the verified public
  runtime were reused; anonymous public-source rebuild remains pending publication.
- [Package](evidence/regular-v44-package.json): 311 payload files,
  41,789,281-byte ZIP, SHA-256
  `45486d20ba05d2ecbe052482e153e1fbaecae623912fe4a8eb860d907e86a9b3`.
  ZIP entries match the packaged files and manifest.
  [Packaged browser checks](evidence/regular-v44-package-static.json) also pass
  static subpath installation readiness, offline routing, keyboard, accessibility
  automation, zoom, reflow and failed/successful refresh behavior.

Earlier failed runs are retained in the [connection design record](DEVICE_CONNECTION_DESIGN.md).
The scan test substitutes camera/decoder results; it does not prove optical QR
recognition on a Samsung S23. Guided browser tests explicitly disable WebRTC.

## Publication and remaining acceptance

**Public Along remains version 43.** GitHub authentication currently returns
HTTP 401. The selected deployed hive accepts the current WebSocket binding and
sends announcements, but the latest protected-message probe delivered neither
direction. Server configuration remains with its owner; see the
[transport handover](R2_BROWSER_TRANSPORT_HANDOVER.md).

After those external gates, verify the actual HTTPS deployment and anonymous
source rebuild, then perform the [v44 physical-device check](DEVICE_CHECK_V44.md).
Physical installation, S23 pairing, spoken TalkBack use and signed-in interactive
GitHub feedback submission are not established by local automation.

Experimental AI-coding course app: use at your own risk; not an official AT service.
