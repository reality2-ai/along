# Full-goal audit — v46, 26 September 2026

The [full goal](PROJECT_GOAL.md) is **not complete**. Version 46 is published and
verified, but local browser results do not establish physical acceptance or
interoperability with the selected hive. This audit supersedes the current-status
claims in the [v45 audit](GOAL_AUDIT_V45.md), while retaining its historical evidence.

The audit inspected the goal, current release artifacts, qualification commands
and results, update/live-context source, installation/build guides, accessibility
limits, feedback evidence and course materials. Repository feedback was checked
again: no open issues. No test or deployment process remains running from v46.

| Requirement | Evidence and scope | Assessment / remaining proof |
| --- | --- | --- |
| 1. Calm, contextual interaction; likely next action | Current guided connection/recovery views, progressive Settings/Advanced controls; [41-case qualification](evidence/regular-v46-qualification.json) | Implemented and browser-checked. Physical S23 comfort and the original pairing complaint remain unverified. |
| 2. Address-to-address multimodal journeys, transfers and nearby stops | [Representative journeys](evidence/real-journeys.json), [arrival/GTFS comparison](evidence/arrive-by-routing.json), current static/public offline routing and arrival/shortcut regression | Scheduled routing is evidenced against a dated snapshot, including walking, bus/train/ferry and final walking connections. This is not current on-street service or access verification. |
| 3. Inclusion: keyboard, semantics, contrast, zoom, narrow screens, reduced motion | [Current static check](evidence/regular-v46-static-check.json), [accessibility guidance](ACCESSIBILITY.md), guided recovery keyboard/320px/axe checks | Automated/simulated coverage passes. Actual TalkBack acceptance remains open; earlier success was withdrawn. No universal accessibility, certification or disabled-commuter study is claimed. |
| 4. Installation, icons, updates, offline refresh and saved data | Installed v37–v45 upgrade scenarios, real failed-download injection, offline identity/preferences preservation; current public installability and offline checks; `public/updates.js` offline/error guards | Browser evidence passes. S23/desktop installed-app version, icon/standalone behaviour and touch observations remain pending. |
| 5. Browser independence and measured limits | [Public browser check](evidence/regular-v46-public-browser.json), static `/along/` host, [current measurements](PERFORMANCE.md#version-46) | Offline address routing without a Python/Along server passes in Chromium. Download/storage and desktop timings recorded; not all-browser or phone performance proof. WASM is used for the R2 runtime, not a browser webserver workaround for provider access. |
| 6. Public distribution, reproduction, data attribution/licences | [ZIP](evidence/regular-v46-package.json), [313-file anonymous public-source rebuild](evidence/regular-v46-public-source-rebuild.json), [build guide](BUILDING.md), [data guide](DATA.md), packaged licence/notices/runtime provenance | Published reproducible app with fixed inputs. Reusing the public runtime archive is distinct from compiler reproduction, which has separate historical evidence. Fresh upstream data need not reproduce historical bundles. |
| 7. Repository documentation | README, installation, hosting/build guides, release record and Reality2 status | Current entry points updated to v46; older version-specific sections explicitly remain historical. No API key is included. |
| 8. Thematic analysis and course | [Analysis](CONVERSATION_ANALYSIS.md), six-session [course guide](COURSE_GUIDE.md), exercises/rubric and [handover](course/HANDOVER.md) | Deliverables exist, updated through v46 and retain negative cases. Human directs and evaluates; AI performs implementation and commands. Course effectiveness is not established by one case study. |
| 9. Release and handover | [Release record](RELEASE_V46.md), successful Pages deployment, [316 public file matches](evidence/regular-v46-public-files.json), current public-browser check | Software release complete. Full project handover remains conditional on acceptance gaps below. |
| 10. Māori interface | Explicit user deferral, current public English-only check with a prior Māori preference | Deferred, not an active release requirement. Official Māori names/macrons remain; no unreviewed language switch is offered. |
| 11. Contextual feedback, privacy, offline drafts and actual receipt | [Feedback implementation/evidence](FEEDBACK.md), prior actual CLI-assisted issue submission and browser receipt, current public offline draft retention | Contextual UI and actual repository receipt evidenced. Signed-in browser composer **Submit new issue** remains untested. A handoff is not delivery; preserve the explicit limitation. |
| Optional contextual AT, original provider access and no Along proxy | `public/live-context.js` verified dated-trip matching; current AT owner/replacement/removal/rotation qualification; [real AT browser requests](evidence/at-direct-browser.json) | Direct provider access was observed on 23 September with a private key omitted from evidence. Current provider availability is not guaranteed; fixtures are not fresh live service proof. Unmatched/unavailable data retain schedules. |
| Browser R2 custody and lifecycle | Current real-WASM/browser-store enrollment, removal, rotation, recovery, interrupted atomic install and receipt cases; software-custody notices | Implemented limited profile. Not full R2/hardware-rooted sealing conformance or protection against same-origin script compromise. |
| One-invitation connection, permitted reconnection and security updates | Guided app tests with WebRTC disabled, real local TLS relay; signed-removal edge delivery and self-removal; automatic recovery including 256 signed removals and independent inner protection | Client behaviour passes locally. [Selected hive](evidence/regular-v46-hive-probe.json) accepts connections but forwards neither protected direction. Real S23 optical scan, pairing/sharing and different-network acceptance remain unresolved. |
| Arrive by and visible shortcut removal | Current arrival/shortcut scenario plus original GTFS/deadline evidence | Implemented, including final destination walk and explicit shortcut removal from its journey screen. Physical timing-control usability remains pending. |

## Release commands and artifacts

The qualified source is `41879985547457af3a0118041ea297533df78a06`.
`build_upgrade_candidate.py` produced the recorded candidate;
`qualify_regular_candidate.py` completed 41 distinct scenarios and two explicitly
labelled aliases, confirming source and candidate unchanged. Serial
`node test/check_static.mjs --regular` passed. `prepare_regular_release.py` accepted
that exact successful report and produced the immutable ZIP. A fresh source export
matched 314 candidate files; `check_public_release_build.py --version 46` matched
313 application files from anonymous downloads in a container. Packaging metadata
is excluded from that app comparison. All 316 served files, including metadata,
were independently fetched and hashed. `check_public_site.mjs` passed with expected
version 46, including offline routing. Counts have different scopes and must not
be combined into extra tests.

Earlier failed and interrupted runs are retained in the release record. They are
not substituted for the final successful qualification. The test correction did
not change production app bytes or lengthen the original observation deadline.

## Remaining acceptance and who can provide it

1. **S23 and desktop:** the user has a pending v46 request for browser names,
   installed version, retained places, offline reopening/routing and TalkBack
   results. Use the [device guide](DEVICE_CHECK_V46.md); mark untried checks as
   not tested. Do not clear storage or create replacement groups to retry.
2. **Public hive:** the server AI owns configuration. Obtain its non-secret
   forwarding status/revision, then repeat the bounded interoperability probe.
   Only after forwarding passes, ask for physical pairing, sharing and recovery.
   Do not replace the user-selected relay model or deploy an Along relay to make
   local tests appear to satisfy this requirement.
3. **Feedback:** signed-in browser submission needs the final GitHub Submit action
   and resulting public issue URL. The device guide covers a synthetic report
   without private details. The previous CLI-assisted result cannot be relabelled
   as this observation; review the resulting issue in a subsequent round.

No additional client defect was identified in this audit's inspected scope.
New user feedback or server evidence may reveal further implementation work.
The pending acceptance items prevent a full-goal completion claim; publishing
another version or repeating unchanged local tests would not resolve them.
