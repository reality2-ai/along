# Lab: what did this release actually prove?

Use Along Device Preview 3806 as a bounded case study. The learner directs an AI
assistant in ordinary language; the AI performs all coding, setup and commands.
Allow 45–60 minutes. Use synthetic journeys and credentials. Do not publish a
release, create public feedback, or use a personal AT key for this exercise.

## Evidence pack

Read the [qualification record](../evidence/device-preview-3806-qualification.json),
[public check](../evidence/device-preview-3806-public.json),
[release record](../evidence/device-preview-3806-release.json), and
[current goal audit](../RELEASE_CHECKLIST.md). Ask the AI to retrieve the source
commit named in the qualification into an isolated checkout. Preserve its snapshot
and runtime provenance. Do not overwrite a working installation to reproduce a
historical test.

## 1. Separate the claims

Ask the AI to propose a claim/evidence table. Check these distinctions yourself:

| Observation | Supported claim | Claim that still lacks evidence |
| --- | --- | --- |
| 304 payload hashes match the release manifest | The checked URLs served the expected release bytes | The phone installed and runs that version |
| Fresh-browser offline address journey succeeds | That snapshot supports that tested offline scenario | Every Auckland journey or accessibility need is covered |
| Installed 3805 → 3806 test preserves key bytes | The tested browser upgrade retained encrypted test-key data | Keys are hardware-sealed or safe from same-origin scripts |
| Enrolled peers exchange protected snapshots through a local relay fixture | That composition authenticates/authorizes and exchanges the tested data | A deployed R2 relay is compatible or mobile background sync works |
| The user reports scan → Use produced no progress | A physical usability failure was reported | The internal timeout gap was its proven cause |

Find the source and runtime used by each check. Explain why 21 passing check
entries are not 21 independent browser runs: two entries share another run's
coverage. Count the failed attempt and corrected retry separately.

## 2. Investigate the failed check

The first compaction check could not import `app-preferences.mjs`. Ask the AI to
inspect the test server's served-file list and the module's imports before
proposing an app change. Compare the original attempt with the recorded retry's
test source commit. Explain why adding two existing dependencies to that fixture
was justified, and why the original failure should remain in the evidence.

Ask the AI to verify that the candidate manifest and payload hashes did not change
between attempts. If that cannot be demonstrated, do not reuse the old passing
results. A green rerun by itself is insufficient evidence of an unchanged app.

## 3. Review an interrupted save

Ask the AI to explain and, where the runtime is available, reproduce the
[older-copy storage checks](../../experiments/journey-sync/older-edit-decision-check.test.mjs)
through their [browser harness](../../experiments/journey-sync/generation-migration.test.mjs).
Then inspect the [published-writer UI check](../../experiments/journey-sync/published-migration.test.mjs).
Identify what each deliberately interrupts and what survives:

- A decision retained before application starts.
- The shared-state commit succeeding before the planner write fails.
- A newer local edit before retry.
- A planner write succeeding before acknowledgment fails.

Evaluate the offered actions: finish retained choices, start a fresh unapplied
review, or compare newer edits with earlier committed choices. Give the AI a
plain-language counterexample if its proposal overwrites newer history, silently
chooses a route, or treats a partially committed operation as cancelled.

The UI check blocks service workers. Explain why it cannot replace the separate
installed-update check, even though it uses the exact published older app.

## 4. Write an honest handover

Write five sentences describing the deployed version, the tested changes, one
preserved failure, the most important remaining limitation, and the user's next
non-coding action. Ask the AI to check every factual claim against the evidence.
Do not claim physical TalkBack success: the user corrected that earlier statement.

## Assessment

Award up to 5 points each for correct evidence scope, diagnosis of the failed
fixture, preservation of user choices through interruption, and an actionable
handover. A submission claiming that hashes prove usability, that a mock relay
proves external interoperability, or that all green tests complete the whole goal
must be revised. Completing this lab does not itself validate a new release.
