# Full-goal audit — version 45, 26 September 2026

The [goal](PROJECT_GOAL.md) remains incomplete. Published v45 is verified; this
is not a completion claim for the whole project. The prior turn published and
verified v45, so it was progress. There are no outstanding test processes from
that release and no open GitHub issues at this audit.

| Requirement | Evidence inspected | Assessment |
| --- | --- | --- |
| 1. Contextual, calm interaction | Current guide and app modules; [35-scenario qualification](evidence/regular-v45-qualification.json); [static checks](evidence/regular-v45-fixed-guide-static.json) | Implemented and browser-checked. Current physical touch observations remain open. Recovery still has manual transfer steps. |
| 2. Real address-to-address multimodal journeys | [Representative journeys](evidence/real-journeys.json), [arrival/GTFS comparison](evidence/arrive-by-routing.json), current arrival and public offline checks | Scheduled routing has evidence for walks, transfers and bus/train/ferry combinations. These are dated timetable checks, not evidence of current on-street service or accessible infrastructure. |
| 3. Inclusion | Current keyboard, axe, contrast, zoom and 320px checks; [accessibility guidance](ACCESSIBILITY.md) including media preferences and research limits | Spoken screen-reader and physical touch acceptance remain unverified. Earlier TalkBack success was withdrawn. No disabled-commuter study is claimed. |
| 4. Installation, updates, offline refresh | Installed v37–v44 upgrades in v45 qualification; failed update preserves prior app; static/public offline checks | Automated evidence passes. Current S23/desktop installation, browser names and actual TalkBack observations are pending. |
| 5. Browser independence and performance | [Public v45 browser check](evidence/regular-v45-public-browser.json), static subpath host, [measurements and limits](PERFORMANCE.md) | Offline routing without the portal is demonstrated in Chromium. Desktop measurements are not phone performance or all-browser acceptance. |
| 6. Distribution, reproduction, licensing | [Package](evidence/regular-v45-package.json), [312 served-file matches](evidence/regular-v45-public-files.json), [309-file anonymous app rebuild](evidence/regular-v45-public-source-rebuild.json), build/import guides and source notices | Published with reproducible fixed inputs. Prebuilt runtime reuse is distinct from compiler reproduction. The superseded proxy requirement is replaced by direct personal-key access. |
| 7. Repository documentation | README, installation/build/hosting guides, release record, notices, contribution instructions | Updated and published. Historical evidence retains its version and limits. |
| 8. Course and thematic analysis | [Course guide](COURSE_GUIDE.md), [handover](course/HANDOVER.md), [analysis](CONVERSATION_ANALYSIS.md), evidence labs | Deliverables exist, including negative cases and no-human-coding rule. Course effectiveness is not established by this case study. |
| 9. Release and final handover | [v45 record](RELEASE_V45.md), successful Pages deployment and public checks | Release complete; full-goal handover still needs client synchronization work and external/device acceptance below. |
| 10. Māori interface | User deferral; current English-only public browser check | Deferred by user. Official Māori names/macrons remain. No translation-selector work is pending. |
| 11. Contextual feedback | [Feedback evidence](FEEDBACK.md), [actual receipt](evidence/feedback-delivery.json), current offline draft recovery | Public submission and browser receipt were tested with CLI-assisted submission. Actual signed-in browser composer Submit remains untested. No open reports to triage at this audit. |
| Offline-first contextual AT | [Real provider browser evidence](evidence/at-direct-browser.json), matching/freshness fixtures, current owner/shared-key qualification | Direct provider access was observed on 23 September. Current per-user provider availability is not established. No Along proxy; unmatched/unavailable results retain schedules. |
| Browser R2 custody | Current enrollment, rotation, removal, storage-failure and recovery qualification; software-custody notices | Implemented limited browser profile, with explicit security limits. No hardware-rooted or full-standard conformance claim. |
| One-invitation connection and normal sharing | Guided tests disable WebRTC; saved-place/preference exchange and offline reconciliation pass locally | Normal flow is implemented. [Public hive probe](evidence/regular-v45-hive-probe.json) accepts connections but forwards neither protected direction. S23 optical scan and pairing remain unresolved. |
| Security-update delivery | Source inspection of sharing service, local handshake, service regression and epoch-recovery flow | Remaining client work: signed group-removal delivery and simpler key-update/recovery carriage. Local invalidation/reconnection must not be described as remote security-update propagation. |
| Arrive by | Current offline UI regression plus dated original-GTFS/deadline evidence | Implemented including final walking connection. Physical timing-control usability remains open. |

## Client work that can continue without the server

The membership reconnection test in `experiments/relay/service-check.mjs` applies
the same valid removal separately to both device stores, then checks renewal and
journey exchange. That proves sessions recover after a *locally learned* update.
It does not prove automatic remote delivery. `sharing-service.mjs` watches local
membership revisions; `local-handshake.mjs` verifies current authority but does
not exchange removal records. `epoch-recovery-flow.mjs` still transfers start,
request and reply messages manually.

Next, add bounded delivery of issuer-signed removal evidence through an explicitly
selected relay and verify that only the originating store is changed by the test
harness. The receiving store must learn and verify the update through the actual
transport. Test invalid/wrong-group evidence, repeat delivery, offline catch-up,
self-removal, permission changes and cancellation without weakening the current
membership checks. This is not equivalent to sending replacement secret keys.

Then simplify key-update/recovery carriage while retaining authenticated device
identity, current membership checks, explicit review where needed and truthful
partial-commit reporting. Verify offline/stale devices and rotated traffic keys;
do not assume a current encrypted channel can reach a device holding an old key.
These are outstanding client tasks, not reasons to wait for server access or to
claim the goal blocked. The public v45 package remains unchanged during development.

## External observations still needed

The server AI owns the hive's forwarding repair. Along must rerun protected-frame
and two-browser integration checks after that fix, followed by physical pairing.
The pending [v45 device request](DEVICE_CHECK_V45.md) can already cover installation,
offline use and screen-reader checks. Interactive signed-in GitHub submission is
another user observation; opening its composer does not prove submission.

No human coding is required. The AI performs the remaining client implementation,
tests and release work. Do not mark the goal complete or blocked merely because
v45 shipped or these external checks are outstanding.
