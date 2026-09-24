# Along course handover — version 39

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
| Run one discussion session | Use the 45–60 minute [release-evidence lab](RELEASE_EVIDENCE_LAB.md), retaining its historical preview version, or the v39 exercise below. |
| Inspect the requirements | Read the [design drivers](../../README.md#what-drives-the-design), [goal](../PROJECT_GOAL.md) and [thematic analysis](../CONVERSATION_ANALYSIS.md). |
| Rebuild or host it | Give the AI [Building Along](../BUILDING.md). The legacy `npm run build` command alone does not produce the connected v39 app. |

## Prepare a teaching copy

Ask the assistant to obtain the [v39 ZIP and checksum](https://github.com/reality2-ai/along/releases/tag/v0.39.0),
verify the archive, and serve its entire contents on a separate teaching origin.
Keep the manifest, qualification record, runtime provenance and source notices.
Use the supplied example addresses and synthetic credentials. A personal AT key,
relay endpoint and public GitHub submission are unnecessary for the core lessons.

For implementation sessions, ask the assistant to prepare the pinned runtime,
dependencies and data described in the build guide beforehand. Fresh upstream
imports may take considerable time and produce different data. The published
snapshot supports historical test scenarios; do not present those results as
current travel advice. Students should not replace their everyday installation
or clear its storage to complete an exercise.

## A current-release exercise: what should happen next?

Allow 45–60 minutes. Start with the user's report that scanning a QR and choosing
Use appeared to do nothing, and the recurring instruction to make the likely next
action clear. Ask learners to propose two explanations and the evidence needed
to distinguish them before showing the implementation response.

Give the AI the [v39 release record](../RELEASE_V39.md) and
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

The v39 record links 18 passing qualification scenarios, static offline and
automated accessibility checks, exact deployed-file verification, and a fresh
public-browser check. The v37/v38 upgrade checks cover the specified saved-data
and identity cases. Earlier v38 source exports reproduced 301 application files
using an existing verified runtime and the published dataset on the same host.
That is narrower than reconstructing every dependency on another machine.

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
