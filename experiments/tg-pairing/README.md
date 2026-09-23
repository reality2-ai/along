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
