# Teaching AI-assisted coding with Along

Along was created as a course exercise. It is an experimental educational app,
provided for use at the user’s own risk; it is not an official AT service or a
claim of production readiness. The verification work is part of the lesson.

## Aim and audience

Use a working commuter app to practise turning evolving human intentions into
software whose behaviour can be inspected, tested and explained. Suitable for
learners without programming experience. **No actual coding by the human is
required:** an AI coding assistant writes and edits code, runs commands and tests,
and investigates failures. Learners direct the work in ordinary language, assess
its evidence and try the resulting experience. No AT key is needed for the core
exercises; access to an AI coding assistant depends on the teaching environment.
An analysis-only class can critique recorded decisions without using an assistant,
but cannot claim to have completed the implementation exercises.

This is a case study of one user–assistant collaboration, not evidence that AI
coding improves outcomes in general. The thematic analysis makes interpretations
explicit and preserves corrections rather than presenting a perfect-prompt story.

## Learning outcomes

By the end, students should be able to:

1. Distinguish desired outcomes, suggested mechanisms and unresolved assumptions.
2. Translate a human scenario into observable behaviour and meaningful tests.
3. Design a clear next action while preserving agency and accessibility.
4. Diagnose a failure using runtime evidence, including caches and deployment state.
5. Explain data provenance, privacy boundaries and what a test does not prove.
6. Hand over a reproducible build with truthful limitations.

## Preparation

Read the README, [project goal](PROJECT_GOAL.md) and
[conversation analysis](CONVERSATION_ANALYSIS.md). Ask the assistant to inspect the
environment, set up Node/Python as needed, and run `npm ci` and `npm test`.
Instructors should arrange tool access and prepare a dated
public-data snapshot or hosted static bundle in advance; importing everything in
a short class can consume the session. Preserve `build-info.json` alongside it.
With that snapshot present, ask the assistant to run `npm run test:browser`.
The command starts and stops its own local server with AT credentials disabled;
it does not require learners to manage another terminal. A configured
`TEST_BASE_URL` instead uses the specified, already-running test server.

For each lab, record: the initial request, your interpretation, a proposed change,
the evidence you checked, the actual result, and the remaining uncertainty. Do not
record API keys, student home addresses or private conversation history. Use the
public example addresses already in the tests.

## Division of work

In every exercise below, instructions to implement, change a fixture, add a test,
run a command, inspect technical state or build a release are tasks to give the AI
assistant. Learners do not write or paste code to repair its work. They describe
the intended behaviour, ask for explanations and evidence, and report observed
problems. Code may be shown as evidence, but reading or editing it is not an entry
requirement. The assistant should explain findings in accessible language.

Human work remains substantial: interpreting needs, making design judgments,
trying the app, checking whether evidence supports a claim and deciding what to
ask next. Physical-device and screen-reader observations must come from actual
use; the assistant cannot replace them with a generated test report.

## Six sessions, approximately 75–90 minutes each

### 1. Find the requirement behind the words

Use the short user excerpts in the analysis codebook. Independently code them,
then compare interpretations with a partner. Group codes into candidate themes;
a message may support more than one theme. Do not count repeated messages as
independent participants or force agreement into an inter-rater score.

Contrast “street address to street address” with “perhaps using WASM.” The first
states an outcome; the second proposes a possible mechanism. Write a requirements
map linking quotes → interpretation → acceptance evidence. Include one plausible
alternative reading and one assumption that needs a user answer.

Deliverable: a one-page thematic map with evidence and a reflexive note about your
own role. Compare with the provided analysis only after making your own account.

### 2. Build around the next decision

Scenario: a commuter has selected an origin and destination, receives three
routes, and needs to decide what to do next. Review the hierarchy of route steps,
saving, sorting and service alerts. Sketch or describe a small improvement and ask the assistant to implement it.

Preserve keyboard order, avoid surprise focus movement, keep access needs
findable, and retain alternatives to a suggested routine. Ask a partner to try
the task without explaining the intended next action. Record what they actually
do, rather than whether they say the page looks nice.

Deliverable: before/after view, task observation and a short explanation of the
tradeoff. A visual preference is not sufficient evidence of improved usability.

### 3. Test the journey, not only the function

Ask the assistant to explain the synthetic bus–ferry–train fixture. Direct it to
change a departure so a transfer is missed; predict the result before it runs the test. Exercise a forbidden transfer,
an overnight service and unknown wheelchair access. Ask it to add one test whose failure
would matter to a commuter, rather than a test that mirrors code line by line.

Then compare a real address journey to the original schedule records. Inspect
boarding/drop-off stops, service date, transfer time and final walk. Discuss why
internal agreement with GTFS does not prove that a lift works or a bus is on time.

Deliverable: one justified regression test and one documented real-data check.

### 4. Debug offline and installed-app behaviour

Reproduce the “it still looks the same” problem using `npm run test:updates`.
Explain the distinction between files on disk, the running server, the active
service worker, a waiting update and a currently open page.

Check that a new release can activate while an old tab remains open, stored data
survives, and an offline refresh stays quiet. Introduce a failed map download and
verify that existing planning remains possible. Discuss when an automatic reload
would interrupt the user's task.

Use the version 23 cache incident as a second case. The original test host sent
`no-store`; the public host allowed ten minutes of HTTP caching. Ask the assistant
to explain how a new worker could cache old HTML, and what evidence distinguishes
a successful worker update from a successful interface update. Inspect the
regression that retains the old offline app when published versions disagree.
Compare the automated results with the user's later confirmation that recovery
worked; explain what neither observation establishes about assistive technology.

Deliverable: a causal explanation supported by observable states, not a generic
recommendation to clear all browser storage.

### 5. Inclusion, data and claims

Use keyboard-only interaction, 320 CSS-pixel reflow, increased zoom and a screen
reader where available. Inspect the accessibility tree and run axe. Keep separate
records for automated findings, your observations and tests with disabled users.

Compare “avoid mapped barriers,” “confirmed accessible stop,” and “the whole trip
is accessible.” Identify exactly what the source data can establish. Examine the
OSM, LINZ and AT notices and identify which data transformations each covers.

Deliverable: an accessibility finding with reproduction steps, a corrected claim,
and a source/licence table. A clean automated report is not a conformance certificate.

### 6. Release and explain the work

Build the static ZIP and serve it under a subpath. Disconnect and plan a new
address journey. Inspect its contents for secrets and private hostnames. Record
browser, data snapshot, test commands, measurements and unresolved gates.

Write a README section and a concise change description for someone who has not
seen the conversation. Explain why WASM was or was not needed using measurements.
End with what the evidence supports and what remains untested.

Deliverable: a reproducible release folder and a reviewable handover.

## Optional evidence-audit lab

The [evidence-audit worksheet](course/EVIDENCE_AUDIT_LAB.md) adds a 60–90 minute
exercise using Along's actual feedback, offline and R2 integration artifacts.
Learners predict what would prove a claim, identify fixtures, direct one useful
failure check, and write a scoped handover. It includes instructor discussion
notes and requires no human coding or public test submissions.

## Example assistant prompts

- “Interpret this commuter scenario. Separate requirements from assumptions and
  propose the smallest observable acceptance check for each requirement.”
- “Inspect the implementation before changing it. Explain why this transfer is
  missed using the actual schedule and walking path.”
- “Make journey steps the clearest next action. Preserve alternatives, keyboard
  access and the user's saved state. Verify the changed behaviour.”
- “The installed app looks old. Inspect server and service-worker state before
  suggesting a remedy. Do not erase user data to hide the problem.”
- “Audit this handover against the evidence. Identify any claim broader than the
  tests, especially around accessibility, offline use and live data.”

Evaluate an assistant's work by its changes and evidence, not confident wording.
Short follow-ups can steer well, but the assistant must retain earlier constraints.
The portable launcher is optional and is not a prerequisite for this course.

## Assessment rubric

| Criterion | Weight | Strong evidence |
| --- | --- | --- |
| Interpretation and traceability | 20% | Quotes connected to outcomes; mechanisms and assumptions distinguished |
| Task and interaction design | 20% | Next action clear; alternatives and access needs remain usable |
| Correctness and verification | 25% | Meaningful failures reproduced; fixes checked at the right scope |
| Inclusion, privacy and provenance | 20% | Unknowns preserved; no private data leaked; licences attributed |
| Reproducibility and communication | 15% | Another person can run the work; limits and pending checks are explicit |

For each criterion: excellent work provides direct evidence and explains its
limits; adequate work demonstrates the basic outcome with some missing context;
weak work relies on assertions, screenshots alone or tests unrelated to the claim.
No learner-authored code is required or rewarded. Assess the learner’s direction,
judgment and verification, and retain the assistant interaction as evidence of the
division of work. Do not award extra credit merely for more code, more prompts,
more agents or WASM.

## Reflection questions

Where did the assistant's initial interpretation narrow the user's goal? Which
follow-up changed the meaning of success? What did the user have to repeat? Which
test exposed a mistaken assumption? What remained unknowable from code? What
would you ask or observe earlier in a second iteration?

## Additional exercise: respond to a negative case

Compare the early dashboard design with version 15's guided screens. Code the
user's “still visually very busy” feedback in the thematic analysis. Explain why
existing progressive disclosure was insufficient, then trace each screen's primary
action and escape route. Test Back, an unfamiliar destination, access preferences
and a saved journey. Distinguish automated accessibility evidence from observed
usability; propose an observation that could disprove the redesign hypothesis.

For a second iteration, use the route-number/Symonds Street request. Distinguish
searching stop names from proving which streets a vehicle traverses. Inspect a
route branch, map, scheduled stop times and the nested Back behaviour. Test that
exploration does not mutate the user's active journey or imply live tracking.
Compare offline AT geometry with optional online street tiles, including privacy,
licensing, deployment and accessibility implications.


## Additional exercise: independence, credentials and real provider evidence

Allow 30–45 minutes, using the recorded evidence without an AT key. The human
writes no code: ask the assistant to inspect the evidence, make any requested
fixture changes and run the checks. Never paste a key into a prompt or worksheet.

Read the user's clarification, “the goal is to make it independent of any central
server aside from that we are getting info from,” and the subsequent proposal to
keep a personal AT key in a Reality2 TG. Compare the earlier proxy proposal with
[the current architecture](ARCHITECTURE.md) and [runtime investigation](REALITY2_INTEGRATION.md).
Identify which constraint each design meets and which capability it merely assumes.
A secure shared-key proxy can still be the wrong answer to this product requirement.

Ask the assistant to explain the difference between these recorded claims:

1. An HTTP preflight permits a subscription-key header.
2. A real browser can read all three AT feeds from the app's origin.
3. The direct adapter can match actual records to the downloaded timetable.
4. A user's TG can securely make their credential available after a browser restart.
5. Two installed devices can share that credential and handle revocation correctly.

Use [CORS evidence](evidence/at-direct-cors-check.json),
[browser evidence](evidence/at-direct-browser.json),
[matching evidence](evidence/at-direct-matching.json), and the inspected runtime
source links. For each claim, mark it supported, contradicted, or not established,
and name the next observation needed. Do not turn successful feed matching into
a claim that the TG integration exists.

Then ask the assistant to demonstrate the single-stop-update regression using
`test/at-client.test.js`. Have it compare the legacy object-shaped update with the
list-shaped fixture, and explain why the provider adapter converts the shape
while the matcher still rejects a wrong service date or an ambiguous repeated
stop. The fixture contains a dummy key only; these tests make no real AT requests.

Deliverable: a one-page architecture decision and evidence table, plus the
assistant's regression-test result. Explain why encrypting a credential, holding
a non-extractable signing key, and running WASM are distinct from a verified
TG application-secret facility. Include the limitation that removing TG membership
cannot recall an AT key already copied to a device; AT-side rotation is needed
for a suspected exposure.

Assessment uses the existing rubric. Strong work preserves the independence
requirement, identifies missing runtime capabilities without inventing an API,
and distinguishes the observed snapshot from a coverage or security guarantee.
No credit is added for deploying a proxy that violates the stated constraint.

## Additional exercise: test evidence without inflating the claim

Allow 30–45 minutes. Use the recorded [runtime evidence](REALITY2_INTEGRATION.md)
and the analysis section “Trust is a lifecycle, not a storage setting”. This is
an evidence-review exercise; it requires neither a real AT key nor access to an
unpublished runtime branch. If code or a test artifact is unavailable, record
that limit instead of asking the assistant to invent a successful run.

Ask the assistant to help construct a table with four columns: user outcome,
observation, what that observation establishes, and what remains untested.
Include these cases:

- A stored identity survives browser restart, but the browser has not demonstrated
  hardware-rooted key protection.
- A failure during the second database write rolls back the first, but no physical
  power-loss test has been performed.
- Two isolated browser contexts exchange messages after their asset server stops,
  but the harness copies their connection descriptions and both run on one computer.
- A correct signed invitation is refused because its signer differs from its named
  issuer; signature validity alone was insufficient.
- An encrypted enrollment bundle arrives intact but names the wrong requested
  device or epoch. Compare the transport check with the application profile's
  certificate and invitation checks in `experiments/tg-pairing/`; neither alone
  establishes permission to install membership or retain credentials.
- A person cancels while the browser is still generating a candidate key. The
  generation finishes later. Check whether the late key is closed and whether
  any claim was sent; merely removing the pairing screen proves neither. The
  candidate-session test uses actual browser cryptography with controlled delay.
- Cancellation arrives while a database transaction is pending, or just after it
  commits. Ask the assistant to test both orders. The first must leave no partial
  installation; the second must report the committed local result even if peer
  acknowledgement is still missing. “Cancelled” is not proof that nothing changed.
- A full verification command succeeds while the source changes during the run;
  the result cannot establish that one final source snapshot passed every check.
- A confirmation appears expired by design, but a backgrounded browser delays
  its timeout callback. Compare a timer-only implementation with one that checks
  elapsed time when confirmation is used; the recorded regression initially
  failed and then passed after that correction.

Then choose one counterexample in ordinary language and ask the assistant to
explain the minimum meaningful experiment. Examples include a double tap on
Accept, closing a device during enrollment, receiving a revocation during a
pending operation, or returning online with an old AT key. If the instructor has
provided the runtime sources, the assistant may implement and run a synthetic
check in an isolated workspace. Learners do not write test code, copy credentials,
or configure real trust groups for this exercise.

Deliverable: the evidence table, one proposed or observed counterexample, and a
short public status paragraph. State whether the result was recorded evidence,
a proposed experiment or a test actually run in class. The status paragraph must
preserve both parts of the requirement: optional contextual live information and
independence from an Along-operated central backend. It must also say whether
end-user enrollment, removal and credential rotation are available.

Assessment: strong work identifies the exact boundary exercised, preserves human
consent and the no-human-coding rule, and names missing evidence without treating
it as either success or proof of impossibility. A correct “not established” earns
more credit than an unsupported security guarantee. Relate the interpretation to
at least two conversation codes and explain one plausible alternative reading.


### Exercise: describe a partial pairing outcome

Use the installation/receipt tests as recorded evidence. Ask the AI to propose
plain-language status and the next action for each case: installation committed
but no acknowledgment received; acknowledgment saved before the page closed;
provisioner receipt storage failed; a previously connected device is now revoked.
The learner evaluates wording and requests revisions without writing code.

Do not use “connected” merely because a receipt exists, promise that cancellation
removed committed state, or suggest repeating a claim on an already owned device.
Explain which actions are implemented and which recovery paths still need work.
Assess whether the proposed screen keeps the commuter's journey primary while
making the relevant device action clear. Distinguish tested technical evidence
from assumptions requiring real-device and accessibility observation.


### Exercise: first use is different from recovery

Ask the AI to run the experimental [first-use storage checks](../experiments/tg-pairing/initial-persona.test.mjs)
and [local setup screen checks](../experiments/tg-pairing/setup-view.test.mjs),
using the runtime dependency and commands documented in the
[experiment notes](../experiments/tg-pairing/README.md). These tests require the initial-persona runtime increment named in the experiment
notes; an earlier runtime is not evidence that the new constructor exists. Use synthetic identities only.
The learner supplies scenarios and evaluates the result; the AI performs all
code changes and test execution.

Compare these outcomes:

| Situation | Evidence to inspect | What the screen may claim |
| --- | --- | --- |
| No local record | Successful read returning absence | No identity found; first use and cleared data are indistinguishable |
| Existing data cannot be read | Storage refusal, with no replacement write | Setup cannot read device data; it has not replaced it |
| Two tabs initialize together | One atomic winner; loser preserves it | Only the winning save created the current identity |
| Cancel before commit | Rolled-back persona, membership and initialization marker | This attempt did not save an identity |
| Cancel after commit | Completed transaction and closed volatile handle | Identity saved; cancellation ended the current operation |
| Reopen after saving | Verified restored member signature; no retained issuer handle | Member identity restored; issuer availability is not established |

Ask the AI to make the next action explicit without overwhelming the journey
screen. Review keyboard focus when the create button disappears, and how Back
preserves saved data while ending volatile custody. Request a real-device check
only for a usable screen; do not claim one from an automated browser result.

Assessment: identify a misleading automatic-repair proposal, explain why a
private-key export refusal is not proof of hardware sealing, and name the
remaining work needed for optional contextual AT access. A passing component
test earns no credit as evidence of a completed public TG feature.
