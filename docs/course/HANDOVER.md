# Along course handover — published v44

Along is a working, experimental Auckland commuter app and a case study of one
human–AI collaboration. It is used at your own risk, is not an official AT app,
and is not evidence that AI coding reliably produces finished software.

The central course rule is **no actual coding by the human**. Learners describe
needs, challenge interpretations, try the experience and assess evidence. The AI
performs setup, implementation, commands, testing and technical repairs. Assess
the learner's judgment, not how much code the assistant generates.

## Start here

| Your purpose | Next action |
| --- | --- |
| Try the experience | Open [Along](https://reality2.ai/along/), prepare it online, then use its installation guide. No AT key or device group is needed for scheduled planning. |
| Teach the full course | Use the six sessions and rubric in the [course guide](../COURSE_GUIDE.md). Have the AI prepare a separate teaching copy before class. |
| Run one discussion session | Use the 45–60 minute [release-evidence lab](RELEASE_EVIDENCE_LAB.md), retaining its historical preview version, or the v40 exercise below. |
| Inspect the requirements | Read the [design drivers](../../README.md#what-drives-the-design), [goal](../PROJECT_GOAL.md) and [thematic analysis](../CONVERSATION_ANALYSIS.md). |
| Rebuild or host it | Give the AI [Building Along](../BUILDING.md). `npm run build` prepares the connected candidate once its runtime and data are ready; the legacy planner has an explicit `build:legacy` command. |

## New v44 case study

Use the [connection-simplicity lab](CONNECTION_SIMPLICITY_LAB.md) for the latest
interaction and verification lessons. Version 44 is published, with 34
qualification scenarios passing; external hive forwarding and physical pairing
remain unverified. The lab distinguishes UI
complexity, hidden network assumptions, reconnect pacing and release evidence.

## Prepare a teaching copy

Ask the assistant to obtain the [v44 ZIP and checksum](https://github.com/reality2-ai/along/releases/tag/v0.44.0),
verify the archive, and serve its entire contents on a separate teaching origin.
Keep the manifest, qualification record, runtime provenance and source notices.
Use the supplied example addresses and synthetic credentials. A personal AT key,
relay endpoint and public GitHub submission are unnecessary for the core lessons.

The approved runtime source is now public in this repository. The
[build guide](../BUILDING.md) records the original anonymous-fetch failure,
its correction through a licensed source subset, and successful isolated runtime
builds followed by browser qualification. The release includes a verified developer
runtime bundle so a teaching copy does not need a Rust build first.

For implementation sessions, ask the assistant to prepare the pinned runtime,
dependencies and data described in the build guide beforehand. Fresh upstream
imports may take considerable time and produce different data. The published
snapshot supports historical test scenarios; do not present those results as
current travel advice. Students should not replace their everyday installation
or clear its storage to complete an exercise.

## A release-evidence exercise: what should happen next?

Allow 45–60 minutes. Start with the user's report that scanning a QR and choosing
Use appeared to do nothing, and the recurring instruction to make the likely next
action clear. Ask learners to propose two explanations and the evidence needed
to distinguish them before showing the implementation response.

Give the AI the [v40 release record](../RELEASE_V40.md) and
[relay regression](../evidence/relay-membership-reconnect.json). Ask it to explain
why a locally received membership change invalidated an existing relay session,
and how the regression distinguishes renewal from automatic update delivery.
Learners should reject a claim that this test diagnoses the original phone report:
it exercises a separate reconnection case after enrollment.

Then have learners write a short handover with three parts: what the release
does, what evidence supports that claim, and the next useful check. They may ask
the AI to run the documented regression if the instructor has prepared its
runtime and local relay. If they only inspect recorded results, label that clearly.
No learner needs to configure a public relay or write code.

Assessment uses the existing rubric. Strong work distinguishes initial pairing,
reconnection of permitted devices, and delivery of security updates; retains
offline independence; and names the unverified physical step. More tests or a
longer status report do not earn credit without better evidence for the claim.

## Evidence students may use

The v40 record links 19 passing qualification scenarios, static offline and
automated accessibility checks, exact deployed-file verification, and a fresh
public-browser check. The v37/v38/v39 upgrade checks cover the specified saved-data
and identity cases. Earlier v38 source exports reproduced 301 application files
using an existing verified runtime and the published dataset on the same host.
Version 40 also reproduces all 283 application files in an isolated container
using only public source and verified release downloads. Its public-source runtime
compilation has a separate two-build container rehearsal. Neither check proves
physical usability or identical compiler output across platforms.

Do not describe these as physical S23 pairing, Android TalkBack acceptance,
external-relay reachability, current live-AT availability or a study with disabled
commuters. The [release checklist](../RELEASE_CHECKLIST.md) records remaining
gates. The full project goal remains open; publication is a milestone.

## Handover back to development

Keep each observation small and reproducible: version, browser, screen, action,
expected result, actual result and whether the check was performed. The
[regular device guide](../DEVICE_CHECK.md) starts with the unresolved pairing step.
Use contextual feedback for a reviewable public report, omitting private
addresses, connection messages and keys. Opening GitHub's composer is not proof
of submission; its signed-in final step remains an acceptance check.

Read new repository feedback in subsequent rounds. Preserve corrections, including
the withdrawn TalkBack-success report. Revisit the thematic interpretation when
observations contradict it, and distinguish a changed requirement from a failed
implementation of an existing one.


The [v41 release record](../RELEASE_V41.md) adds a further discussion case: removing
a service preference worked technically, but the user expected the visible shortcut
to disappear. Ask learners to distinguish the original test claim from that user
expectation, then evaluate explicit shortcut removal. Arrive-by routing is recorded
as a new requirement, not a completed capability of this release.


Version 42 extends that case: the user still found shortcut removal difficult and
suggested placing it after opening the shortcut. The resulting action sits on the
journey-options screen. The same release adds Arrive by. Compare the evidence for
algorithm correctness, original timetable matching and browser usability in the
[v42 record](../RELEASE_V42.md); none establishes physical acceptance by itself.


For that historical release, the [v42 public-source rebuild](../evidence/regular-v42-public-source-rebuild.json)
reproduces all 283 application files; [v42 measurements](../PERFORMANCE.md#version-42-measurements)
separate download, origin storage and desktop process memory. Use these for a
v42 handover while retaining the version boundaries between exercises.

The user's correction about the old relay is another evidence exercise: compare
[the current-standard review](../R2_CURRENT_STANDARD_REVIEW.md) with a passing test
against the older server. Ask the AI to identify exactly what each source proves.
A strong answer neither discards a valid historical test nor promotes it into
current compatibility, and does not ask the human to implement the missing adapter.


Version 43 adds an allocation investigation: a large desktop process measurement
led to a bounded diagnostic, not an immediate claim of a memory leak. The change
removes unused path records while retaining full walking directions. Compare the
[before/after evidence](../evidence/routing-path-allocations.json) and
[v43 release](../RELEASE_V43.md); explain why fewer temporary allocations and faster
search in one run do not establish smaller retained data or phone performance.
