# Lab: does the evidence prove the user's outcome?

A 60–90 minute extension to [sessions 3 and 6](../COURSE_GUIDE.md).
No human coding, personal API key, hardware purchase or public issue submission
is required. Learners direct an AI assistant in plain language and judge its work.

## Scenario

A commuter wants Along to keep working offline, optionally show current AT
information, and share access between their own devices. The project also offers
feedback to its GitHub repository. Several component tests pass. Your task is to
decide which user-facing claims those results support and identify the next
meaningful check or implementation change.

Use a local checkout with the instructor's prepared public data snapshot. Ask the
assistant to record the source commit and inspect the files below. If the runtime
or browser dependencies are unavailable, use the recorded evidence and mark the
exercise as analysis-only. Do not manufacture a successful test run.

## Part 1: predict before inspecting (10 minutes)

For each statement, write what you would need to observe to believe it:

1. “My feedback has reached the repository.”
2. “This phone has saved the AT key.”
3. “My other device can reconnect after closing the app.”
4. “Removing access means that device cannot use the key anymore.”
5. “The app can plan a new journey without the portal.”

Do not start with implementation terms. Describe an action, an observable result,
and a failure that would refute the statement. Keep the statements' different
scopes: saving, delivery, present authorization and offline operation are not
interchangeable.

## Part 2: trace the actual evidence (20 minutes)

Ask the assistant to inspect these sources and explain them without requiring you
to read code:

| Case | Sources |
| --- | --- |
| Feedback handoff and receipt | [Feedback notes](../FEEDBACK.md), [real check](../../test/check_feedback_delivery.mjs), [recorded result](../evidence/feedback-delivery.json) |
| Saved key and interrupted confirmation | [Credential experiment](../../experiments/at-credentials/README.md), [peer scenario](../../experiments/at-credentials/peer-delivery.test.mjs) |
| Issuer custody and device enrollment | [Current integration findings](../REALITY2_INTEGRATION.md), [initial persona adapter](../../experiments/tg-pairing/initial-persona.mjs) |
| Portal-independent planning | [Static check](../../test/check_static.mjs), [version 37 recheck](../evidence/release-v37-recheck.json) |

Complete this table. A fixture is an intentionally supplied test input or substitute;
it is useful evidence within its stated scope, not automatically a defect.

| Claim | Actual observation | Fixture or untested dependency | Supported scope | Next evidence needed |
| --- | --- | --- | --- | --- |
| Feedback received | | | | |
| Key saved | | | | |
| Devices reconnect | | | | |
| Access removed | | | | |
| Offline journey works | | | | |

Prompt to try:

> Trace this claim from the user's action to the final result. Mark every simulated
> service, supplied identity, manual connection step and missing device observation.
> Separate what the test executes from what comments or documentation say it does.
> Do not create issues, read APIKey, change framework rules or publish anything.

## Part 3: try to disprove one claim (20 minutes)

Choose one case. Ask the assistant to prepare an isolated test that could fail for
a reason important to the commuter. Predict the result before it runs. Examples:

- Open the GitHub composer but never submit. Does Along keep the report unverified?
- Lose the acknowledgment after the recipient commits. Does the owner remain
  uncertain, then recover confirmation without sending the key again?
- Change a device grant while its review screen is open. Can an outdated review
  overwrite the newer decision?
- Stop the static host after initial preparation, then search different addresses.
  Does the app really use downloaded data rather than a previously shown result?

Reuse existing checks where they exercise the intended failure. Add or change a
check only when it tests a meaningful uncovered behavior. Any edits belong in an
isolated local branch/copy; no public deployment is part of this lab. If a check
fails, preserve the failure evidence before asking for a repair.

## Part 4: write the handover (15 minutes)

Produce a short handover containing:

- The original user outcome, without shrinking it to the test that passed.
- One supported claim and the command/artifact/source revision supporting it.
- One unsupported claim, its missing dependency and a concrete next action.
- A revised user-facing message that expresses an uncertain outcome clearly.
- One architecture choice that needs the user's judgment rather than more code.

If a framework requires a stronger storage property than the platform establishes,
explain the mismatch. Do not silently redefine the framework, claim encryption is
hardware protection, or decide that adding an unrequested native component is free.
The user's desired outcome and any choice they actually make remain authoritative.

## Assessment notes for instructors

Award credit for matching evidence to claim, including evidence that overturns an
initial assumption. No points are awarded for extra code, repeated passing tests,
or invented acceptance observations. Use the main course rubric.

Expected distinctions, to discuss after learners submit their first table:

- The recorded feedback check submits via authenticated CLI and verifies receipt
  through the browser. It proves repository acceptance and receipt handling, not
  the interactive GitHub sign-in/composer flow. Opening a URL proves neither.
- The peer scenario uses real browser member keys, IndexedDB and WebRTC. Its issuer
  and initial group arrangements are fixtures, and connection descriptions are
  exchanged by the harness. One host is not a phone-to-desktop network test.
- A signed saved receipt is a historical installation report. It does not establish
  continuing permission, provider acceptance or present reachability.
- A locally saved removal affects a recipient after it learns the change. It does
  not revoke a copied subscription key at AT. The experimental live client can
  check with a reachable owner before a request, with a corresponding availability
  cost. These limits belong in the handover.
- The static test makes a new address search offline and preserves saved journeys.
  It supports portal-independent operation after preparation in the tested browser;
  it does not establish every phone's memory, installation or screen-reader behavior.
- The R2 custody choice is a product/security decision still awaiting user input
  when this lab was written. Learners should check current repository state rather
  than treating this answer key as a permanent implementation report.

Suggested closing discussion: which missing foundation would you investigate
before polishing another screen, and what evidence would let you resume that work?
