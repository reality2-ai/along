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
