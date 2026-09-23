# Pairing comparison component (not released)

This isolated component prepares the person-confirmation step for ordinary-member
browser enrollment. It is not imported by Along or copied into its static build.
It does not authenticate an invitation, compare another device's code, install
membership, or authorize an AT key. The runtime must supply the correct
connection-bound comparison and bind the person's answer to that ceremony.

`showComparison(container, {code, onDecision, signal, focus})` accepts the four
comparison bytes and an explicit decision callback. It displays every character,
provides full-width match/cancel actions, admits one decision only, and stops
accepting input after abort. The callback receives `(matched, signal)`, where the
second argument is scoped to this view. External abort, disposal or replacement
of this container aborts that signal. Mounting a replacement automatically
disposes the previous view. A pending callback cannot overwrite an expired
comparison message. The controller must itself observe the supplied cancellation signal before any
protected operation: disabling UI does not revoke a permission already issued.
A resolved callback never displays “paired” or “connected”. The component can be
replaced only when actual enrollment completion has been established.

Focus moves to the heading only when the opening action explicitly requests it.
Escape declines while focus is within the component. The visual code is paired
with digit/letter-separated screen-reader text. This text is not evidence of
correct spoken pronunciation on a particular device.

The AI can run the isolated browser check after `npm ci`:

```sh
node experiments/tg-pairing/comparison.test.mjs
```

Set `CHROMIUM_PATH` if the environment uses a separately installed Chromium.
The fixture exercises a narrow viewport, keyboard match/cancel, duplicate actions,
abort, disposal and replacement during pending confirmation, failure, enlarged-text
reflow and axe checks.
It uses only a synthetic comparison code. It does not test real enrollment,
physical co-presence, Android TalkBack, hardware protection or AT access.

## Connection to the experimental runtime

`session-view.mjs` supplies the actual code from Reality2's experimental
`createEnrollmentSession`, and sends the person's decision back to that same
session. Both peers must confirm. Replacing or disposing the view cancels the
old session; the runtime's abort signal disables the displayed controls when
the peer disconnects or declines. Cancellation also prevents durable invitation
reuse. This adapter remains outside Along's public build and does not enable
membership installation or AT credentials.

Run the integrated browser check with `R2_BROWSER_DIR` pointing to the runtime's
`implementations/rust/hives/hive-wasm/browser` directory and `R2_WASM_DIR` to its
compiled web WASM package:

```sh
node experiments/tg-pairing/session-view.test.mjs
```

The check uses synthetic invitations, real isolated browser contexts, IndexedDB
and the actual data channel; the asset host stops before comparison. It exercises
rendered controls, both confirmations, keyboard decline, remote disconnection and
replacement while confirmation is pending. It does not establish initial trust,
protected bundle delivery, full enrollment or physical-person co-presence.

## Enrollment payload validation

`enrollment-profile.mjs` defines an **Along experimental application format**,
not a normative Reality2 wire format or a claim of Notekeeper compatibility.
The test harness serves the runtime's `invitation.mjs` and `certificate.mjs`
alongside this module. Use the runtime at draft PR #1, commit `c4f5b794` or a
compatible successor, with its matching compiled WASM package.

| Message | Exact contents |
| --- | --- |
| Claim, 129 bytes | `ALNGCLM1`, canonical 89-byte invitation, candidate public key (32 bytes) |
| Bundle, 345 bytes | `ALNGBND1`, original claim, epoch (8-byte unsigned big-endian), core certificate (136 bytes), payload key (32 bytes), integrity key (32 bytes) |

The certificate must verify through the actual core WASM for the requested
candidate and group, with its issuance epoch equal to the expected epoch.
Lengths, version markers and the original invitation must match exactly.
Authenticating the traffic-key bytes depends on the protected transport and
authorized issuer custody; the codec cannot prove their derivation.

`enrollment-payloads.mjs` connects this profile to the confirmed runtime session.
It snapshots the invitation, validates received payloads, rejects duplicate
operations and cancels enrollment on failure. It clears received traffic-key
arrays when the session aborts, and clears intermediate bundle copies. The caller
must clear any further copies it makes; JavaScript cannot promise physical memory
erasure. A decoded bundle is not permission to persist keys or install membership.

With the same `R2_BROWSER_DIR`, `R2_WASM_DIR` and optional `CHROMIUM_PATH` as above:

```sh
node experiments/tg-pairing/enrollment-profile.test.mjs
node experiments/tg-pairing/enrollment-profile-carriage.test.mjs
```

The first check uses actual certificate verification and controlled transport
delays for cancellation races. The second uses real peer sessions and durable
invitation journals after stopping the asset host. Its initial trust bootstrap
is explicitly synthetic. A malformed encrypted claim or bundle must close both
peers and void their reservations. Neither test establishes issuer authority,
fresh epoch policy, core ceremony completion, durable installation or AT access.
