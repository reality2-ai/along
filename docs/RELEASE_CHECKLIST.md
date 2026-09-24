# Release evidence and remaining gates

Current regular app: **version 42**. Its 22-scenario qualification and static checks pass;
all 286 deployed files match the verified package. Physical acceptance remains open.
Historical version-37 evidence below describes that earlier release. The separate [device preview 3806](https://reality2.ai/along/preview/public/)
is published for [S23/desktop checks](PREVIEW_DEVICE_CHECK.md). Both are static
GitHub Pages deployments; the retired private server is not required.

Preview 3806 adds clearer pairing feedback, optional user-selected relay
reconnection, reviewed journey checkpoints, and review/recovery of older-copy
edits. [Qualification](evidence/device-preview-3806-qualification.json) contains
21 passing requirement entries from 19 distinct checks, including two entries
covered by other runs. One initial check failed because its test server omitted
preference dependencies; the corrected fixture passed against unchanged candidate
bytes. That failure and retry are retained rather than silently replaced.

The [public check](evidence/device-preview-3806-public.json) verified all 304
released payload hashes, HTTPS setup/reload, offline installation guidance and a
new offline bus/ferry address journey, with no page errors or external requests.
The [release record](evidence/device-preview-3806-release.json) binds the archive,
source and successful Pages deployment. The installed 3805 → 3806 test preserved
saved places, identity, encrypted test keys and regular Along's shell cache.

These are local automated and public-file checks, not physical acceptance.
Initial pairing still requires transferred messages. The relay is off by default;
its discovery only connects already permitted devices. [Local interoperability with the actual R2 relay](evidence/actual-r2-relay.json)
now passes enrolled sharing/reconnection, generation-two exchange, Settings and
invalid-greeting refusal. An external selected endpoint remains unverified. Group-removal/key-update propagation and checkpoint catch-up are still
explicit flows, not unattended synchronization of all trust-group state.
Regular Along 38 now includes the live/TG controls and preserves separate preview storage. Historical
entries below retain their original versions and scopes.

## Version 42

The [v42 record](RELEASE_V42.md) adds backward Arrive-by routing, final walking
connections, latest-departure ordering and contextual shortcut removal after
opening a home entry. Twenty-two qualification scenarios pass, including the
v41 upgrade and the new offline UI flow. Original-GTFS and 79 unit checks have
separate evidence. External relay endpoint details and physical acceptance remain.

## Version 41

The [v41 record](RELEASE_V41.md) covers explicit shortcut removal, preservation of
other journeys, failed-write behavior and offline reopening. Twenty qualification
scenarios pass, including installed v40 upgrades. Physical user acceptance remains.
Arrive-by routing was newly requested at v41 and is implemented in v42.

## Version 40

The [v40 release record](RELEASE_V40.md) adds the approved public-source runtime,
a successful anonymous container runtime rebuild, 19 qualification scenarios and
upgrades from v37, v38 and v39. Public checks passed after deployment. The original
cache-name assertion failure and its stronger worker/payload verification are
retained in the evidence. No physical pairing or external relay result is inferred.

## Version 39

The [v39 release record](RELEASE_V39.md) covers automatic session renewal after
locally received membership changes, plus installed v37 and v38 upgrades. Existing
v38 identity and saved data survive failed-download recovery and the completed
upgrade. Automatic delivery of group updates remains outside this fix. Historical
v38 evidence below remains labelled with its original scope.

## Goal audit — version 42, 25 September 2026

The [full goal](PROJECT_GOAL.md), including later user decisions, remains active.
The preceding goal turn made progress: an isolated public-source rebuild matched
all 283 v42 application files. Publication does not establish full completion.

| Requirement | Authoritative evidence inspected | Assessment and remaining work |
| --- | --- | --- |
| 1. Calm, contextual interaction | Guided destination/origin/review/options/follow UI; [v42 qualification](evidence/regular-v42-qualification.json), including arrival and contextual shortcut removal; [static checks](evidence/regular-v42-static.json) | Implemented and browser-checked. Current physical touch acceptance remains open. |
| 2. Real multimodal address journeys | [Arrival routing and raw GTFS comparison](evidence/arrive-by-routing.json); [route exploration](evidence/route-exploration.json); public offline browser check | Schedule and algorithm evidence exists, including transfers and final walks. This does not verify on-street accessibility or current service operation. |
| 3. Inclusion | Keyboard, axe, reflow, media-preference and focus checks; [accessibility guide](ACCESSIBILITY.md) | Spoken TalkBack/desktop-reader acceptance remains unverified. Earlier TalkBack success was withdrawn. No disabled-commuter study is claimed. |
| 4. Installation, updates and offline refresh | v42 qualification covers installed v37–v41 upgrades; static checks cover quiet offline refresh, failed downloads and retained data | Browser evidence passes. Exact S23 browser, current installation and touch observations remain needed. |
| 5. Browser independence and performance | [Public v42 browser](evidence/regular-v42-public-browser.json); [current measurements](PERFORMANCE.md#version-42-measurements) | Static subpath and offline searches pass. Desktop measurements do not establish phone memory/performance. |
| 6. Public distribution and reproduction | [v42 package](evidence/regular-v42-package.json), [286 deployed-file checks](evidence/regular-v42-public-files.json), [283-file isolated rebuild](evidence/regular-v42-public-source-rebuild.json); import/build instructions and notices | Current application rebuild passes using public inputs. Runtime compiler reproduction is separate; fresh data imports are not byte-identical snapshot reproduction. |
| 7. GitHub documentation and privacy | README, [build](BUILDING.md), [hosting](HOSTING.md), [goal](PROJECT_GOAL.md), source notices and current release record | Published. Local searches/history stay local; sharing is explicit. Current-standard relay correction must accompany older compatibility evidence. |
| 8. AI-coding course | [Six-session guide and rubric](COURSE_GUIDE.md), [handover](course/HANDOVER.md), [thematic analysis](CONVERSATION_ANALYSIS.md), historical evidence labs | Materials exist. Human work is requirements, judgment and observation; AI performs coding/commands. Course effectiveness has not been studied. |
| 9. Release and handover | [v42 release](RELEASE_V42.md): 22 qualification scenarios, public deployment and rebuild evidence | Release published; full goal incomplete for the acceptance and integration items below. |
| 10. English / Te reo Māori | User deferred translation; English UI ignores prior Māori selection; official names preserved | Deferred, not an active completion gate. Re-enable only on renewed instruction. |
| 11. Contextual GitHub feedback | [Draft, handoff and real receipt evidence](FEEDBACK.md); offline persistence and privacy fixtures | Actual receipt is verified, but signed-in browser composer Submit remains untested. No open issues at this audit; absence is not proof of usability. |
| Optional direct/contextual AT | [Real provider browser access](evidence/at-direct-browser.json), dated 23 September; v42 synthetic owner/shared-key tests and contextual matching/freshness checks | Direct access was demonstrated with separate historical scope. Current live availability and every commuter's key are not established. Offline fallback remains required. No Along proxy. |
| Browser TG custody and device lifecycle | v42 qualification: enrollment, owner/shared credentials, removal, rotation, checkpoints, recovery and storage-failure cases; [browser subset](REALITY2_INTEGRATION.md) | Implemented Along profile with encrypted software custody; no hardware or full-current-R2 conformance claim. Physical pairing remains unresolved. |
| Cross-device synchronization and optional relay | Saved-journey model/browser checks; [current-standard review](R2_CURRENT_STANDARD_REVIEW.md) | Legacy relay tests prove only the pinned old protocol. Current hive browser contract and interoperability remain open. Security updates/checkpoints use explicit flows; seamless delivery is not finished. |
| Arrive by | Reverse search, generated-network comparison, original timetable checks, final walking deadline and overnight fixtures in v42 | Implemented and browser-verified. Physical timing-control usability remains open. |

## Next work against the full goal

1. Obtain the current server implementation's browser endpoint and transport
   contract, then adapt and verify Along against it. The server AI owns server
   configuration. Do not deploy the old relay to fit Along or treat an old
   signed greeting as the current standard. The endpoint question is pending.
2. Resolve the original S23 scan → Use failure using the [v42 device guide](DEVICE_CHECK.md).
   Verify pairing, saved places/preferences, offline reopening, arrival timing,
   shortcut removal, touch and spoken-screen-reader behaviour. A partial report
   is useful; unperformed checks remain untested.
3. Finish seamless synchronization against the agreed current transport,
   including how security updates reach permitted devices. Existing explicit
   rotation/recovery and saved-journey exchange do not prove automatic delivery
   of every group update. Preserve revocation, consent and offline independence.
4. Complete the signed-in browser GitHub submission check. CLI submission and
   anonymous receipt checks are evidence of different boundaries. The regular
   [device guide](DEVICE_CHECK.md#optional-feedback-submission-check) describes
   the remaining user action without requiring coding.
5. Reconcile the final course handover with the eventual integrated release and
   physical results. Preserve versioned evidence and corrections rather than
   converting historical passes into current acceptance.

Māori remains deferred. No remaining implementation requires human coding.

## Evidence and reproduction

- [Version 17 checks and measurements](evidence/contextual-maps-v17.json).
- [Build provenance](evidence/build-info.json), [real journeys](evidence/real-journeys.json),
  [raw-GTFS route exploration checks](evidence/route-exploration.json).
- [Performance interpretation](PERFORMANCE.md), [device checklist](ACCESSIBILITY.md).
- `python3 test/check_route_exploration.py`: independent bus/train/ferry stop-time
  and shape comparison against the preserved GTFS ZIP.
- `npm test`: routing, exploration, privacy, live adapter and launcher fixtures.
- `npm run test:browser`: real data, guided flow, maps, nested Back, axe and offline use.
- `npm run test:updates`: old-tab migration, saved storage, silent offline checks.
- `npm run build` then `npm run test:static`: subpath installability, keyboard,
  zoom/reflow/media preferences, dataset refresh and offline address planning.

Browser fixtures use 23 September 2026 and require a snapshot covering that date.
Set `CHROMIUM_PATH` for an existing browser. Street-tile requests in automated
checks use a fixture image; no public tile server is bulk-fetched by the tests.

At 09:00, 277 Broadway → 10 Victoria Road produced a 59-minute
walk/train/walk/ferry/walk journey. Queen Street → 805 Great North Road produced a
24-minute walk/bus/walk journey; 1 → 2 Queen Street produced a two-minute walk.
Three transit legs were independently checked against raw GTFS for service day,
stop order, exact times and pickup/drop-off rules. This is schedule verification,
not a comparison with AT Mobile or an observed physical journey.

The route 70 browser scenario finds a Symonds stop, opens its departures, returns
with focus/filter retained and repeats map exploration offline. Unit fixtures
check branches, service calendars, requested trips, terminal arrival times and
no-pickup services. Stop-name filtering does not prove street traversal.

## User device observations

| Observation | Evidence scope |
| --- | --- |
| Desktop installation, icon and standalone window worked | Version 11, explicitly reported |
| Android address journey, steps/save, flight-mode reopen, new offline search, quiet pull and touch all passed | User report, exact app version not supplied |
| Desktop keyboard-only navigation and 200% zoom worked | User report before the guided redesign |
| Android update page appeared to update, though app was already latest | Earlier user report; exact browser/version not recorded |
| Version 21 update loop, followed by “that worked nicely” after version 23 recovery instructions | User confirmation that the reported Android update failure was resolved; browser identity and TalkBack remain unconfirmed |
| “Yes, looking good” in response to the version 15 device/flow question | Positive acceptance of the guided flow; not an explicit TalkBack result |
| “Looking good” in response to the version 21 route 70 / Symonds / Back checklist | Positive flow feedback; device-specific, offline and TalkBack results were not individually confirmed |

The user requested TalkBack instructions but has not supplied a spoken-interaction
result. No attached ADB device or desktop screen reader was available at the last
local audit. Do not infer those checks from screenshots or accessibility trees.

## Update history relevant to the course

Android initially did not show version 11. Version 13 added recovery-script cache
busting and active-worker version checks. Version 14 retained a visible update
result before reopening, so a no-op could be distinguished from an update.
Version 15 introduced the guided flow; version 17 adds contextual route/stop maps.
Earlier measurements remain labelled as historical evidence, not latest acceptance.

## Historical handover limits (before live/TG implementation)

The timetable, route shapes and map can be old; transport access fields are often
unknown. Access connectors are estimated; routing and street coverage are bounded.
No fares, live vehicle display, delay-aware itinerary replanning or cross-device
sync is implemented. The optional live adapter is fixture-tested without an AT
key. iOS and disabled-commuter participant testing are not recorded. See the
README for behaviour and the device checklist for the remaining observations.

## Version 18: installation, offline independence and privacy

The app Settings and README now explicitly distinguish local operation from the
portal used to obtain updates. The browser/platform guide covers Chrome, Edge,
Brave and Safari on applicable desktop/mobile platforms, and labels unverified
menu variations and device checks. It explains offline readiness, local storage,
optional outbound requests and recovery after storage loss. The same guide is
rendered as install.html, cached with the app and included as INSTALL.md in the ZIP.

GitHub Pages can inherit the organisation domain at `reality2.ai/along/`; the
static deployment branch `site-preview` supplies the GitHub Pages deployment.

The version 18 static run also opened the installation guide while offline,
expanded browser instructions, and checked 320-pixel reflow and axe rules.
[Measurements](evidence/install-guide-v18-metrics.json) accompany that run.

## Version 20: public portal and visible source

GitHub Pages now serves the static `site-preview` branch over enforced HTTPS at
[reality2.ai/along](https://reality2.ai/along/). The organisation homepage and DNS
were not changed. Source updates on main are separate from the built deployment.
The README includes four screenshots captured from the running app using public
example addresses. Both the footer and Settings link to the public GitHub source.
Public-site installation/offline checks are run with `test/check_public_site.mjs`.

The [public deployment check](evidence/public-site-v20.json) passed in a fresh
persistent Chromium profile: version 20, `/along/` worker scope, installability,
visible Settings About link, new address journey after network disconnection and
offline installation help. No page JavaScript errors were recorded. Physical
installation and screen-reader observations remain separate from this result.

## Version 21: course exercise and use-at-own-risk notice

The README begins with an explicit educational/experimental notice. The same
message is visible on the app's task screens, with fuller wording in Settings,
installation guidance and the downloadable hosting README. It states that Along
was built as an AI-assisted coding course exercise, is not an official AT service,
and may contain incorrect or outdated route/access information. It does not
claim that a disclaimer establishes safety, suitability or production readiness.


The [version 21 public-site check](evidence/public-site-v21.json) confirms worker
scope, Chromium installability, the Settings source link, offline new-address
routing and cached installation help, with no page JavaScript errors. The ZIP's
checksum and assets were also checked against current source, allowing only the
builder's documented subpath transformations of HTML and the manifest; packaged
installation guidance and notices match their sources. These checks do not
replace physical installation or spoken screen-reader observations.


## Downloadable version 21 candidate

A GitHub draft prerelease `v0.21.0` contains the current `along-web.zip` and its
SHA-256 file, targeted at source commit `141b3a6`. Both uploaded asset digests and
sizes match the local files. The archive SHA-256 is
`04614173fb8eb27a108525cc1ff45376c7df04039ea3f49cafc708d9c9c86fbe`.
Draft release assets are visible to repository maintainers, not public download
links. Public users can install from the live portal or build from source; the
draft is not a claim that the remaining device checks passed.

The public README was checked in Chromium at a 1440-pixel viewport: the gallery
and article both measured 838 pixels wide; all four images loaded and rendered
at identical dimensions. The prominent webapp link resolves to the public portal.
This is presentation evidence only.


## Version 22: course context inside the app

Settings now has a collapsed “How Along was made” section explaining the
no-human-coding rule and linking directly to the project goal, thematic analysis
and course exercises. The main journey flow is unchanged. The user's latest
positive feedback is recorded above without treating it as an explicit TalkBack
or offline test result.


Version 22 is deployed to the private site and GitHub Pages. The
[public-site check](evidence/public-site-v22.json) passed with the collapsed course
section, its text and three links, installation eligibility, offline new-address
routing and offline help. A focused 390-pixel Settings check passed keyboard
expansion, Escape/focus restoration and axe rules. Core CI passed. These are
browser checks, not spoken screen-reader evidence.

The current README button was also inspected on GitHub: its 304 × 56-pixel image
is centred in the article below the warning and introduction. The earlier
version 21 draft archive remains historical; the locally rebuilt version 22 ZIP
and deployed static branch contain the new app context.


## Version 23: reject stale interface files during updates

The user reported that Android repeatedly offered “Update and reopen” while
Settings remained at version 21. The update regression originally served every
file with `Cache-Control: no-store`, unlike GitHub Pages, which serves shell assets
with `max-age=600`. With that ten-minute cache policy, the existing test reproduced
a newer worker activating while its cached HTML still displayed the old version.
This is a reproducible failure mechanism consistent with the report; the actual
phone's cache has not been inspected.

New workers now request shell files with `cache: reload` and verify the cached
HTML's app version before installation succeeds. A mismatch discards only the new
shell cache and leaves the old app, saved journeys and datasets available. The
regression covers HTTP-cached old assets, held-open windows, saved data, quiet
offline refresh and a mismatched deployment retaining the working offline app.
The user subsequently confirmed that the version 23 recovery “worked nicely.”


Version 23 is deployed to both the existing private site and GitHub Pages. Core
CI and the HTTP-cache/mismatched-deployment update regressions passed. The
[static subpath run](evidence/static-v23-metrics.json) passed installation,
keyboard/axe, zoom/reflow, data refresh, offline routing and saved-journey checks.
The [public-site check](evidence/public-site-v23.json) confirms version 23,
installation eligibility and offline new-address routing without page errors.
To recover an older installed copy, use its Settings → Check for an app update →
Check for updates → Open Along. No uninstall or site-data deletion is required.
The user confirmed the recovery worked after receiving the version 23 update
instructions. This closes the reported repeated-update incident; it does not
establish a TalkBack result or identify the installation browser.


## Downloadable version 23 candidate

The `v0.23.0` draft prerelease targets source commit `37339d9` and contains the
current ZIP and checksum. All archive files match `dist/`; both uploaded asset
hashes match the local files. ZIP SHA-256:
`7b373ed55765a97c6360d87856bb79dc3bba4a21b31577d3ea369979926b8201`.
This supersedes the version 21 draft for review. Draft assets remain visible to
maintainers only. The public app already serves version 23; spoken screen-reader
acceptance is still outstanding.


## Version 24: distinguish destination from starting place

User feedback identified ambiguity in “Starting where?” with the previously
selected destination shown underneath. The origin heading now asks “Where are you
travelling from?” and the context says “Destination already selected”. Labels
spell out “Destination (to)” and “Starting place (from)”; actions name the next
step, and the origin has its own visible, screen-reader-associated help text.
Routing direction remains destination first, then origin, then review.

The user explicitly clarified that TalkBack has **not** been tested. The earlier
positive response to the TalkBack question is superseded by that correction;
spoken screen-reader acceptance remains outstanding.


Version 24 passed all four browser scenarios (guided journeys, mobile nearby,
address/access flow, and route/map exploration), plus a focused 390-pixel check
of the origin title, selected-destination context and Back preserving the choice.
Public HTML, app code and service worker match the built version 24 files after
successful Pages deployment. This copy clarification does not establish spoken
screen-reader validation.


## Version 25: street background action inside the map

The “Show street map” button is centred over the route/stop map, with “Needs
internet · OpenStreetMap” directly beneath its label. It disappears when selected,
leaving map controls available. Downloaded AT geometry remains visible before
selection and offline; street tiles are still requested only by explicit action.
The route exploration, nested Back, fixture tile rendering and offline regression
passed. A mobile layout check confirms the button is centred; axe checks cover
the route dialog with the button visible.


## Version 26: saving at the top of the journey

“Save this journey” now sits beside the step count, above the current travel
instruction, as an outlined 48-pixel-minimum-height button. The filled primary
Next step action remains below the travel instruction. Saved state still uses
text and `aria-pressed`; the header wraps on narrow screens rather than clipping.


## Version 27: saved service preferences and scheduled departure boards

“Save these places” on the review screen saves endpoints before route selection.
“Prefer these services” after selection optionally adds the ordered service sequence.
Reopening a saved card performs a separate timetable search for that sequence,
so a slower preferred route is not lost through ordinary earliest-arrival pruning.
Mode/access/transfer constraints still apply; unavailable matches are explained
and alternatives remain available. No old trip ID, departure time or vehicle
position is treated as current. Legacy saves remain usable, and one combination
per endpoint pair can be replaced explicitly.

Stop details use a semantic, high-contrast departure table with an explicit
“Scheduled departures — not live” caption and online AT Mobile information link.
The linked official AT page describes live times and vehicle tracking; Along's
stop table itself remains scheduled. There is no flashing or automatic row motion.


The installation guide now places scheduled-only/live-tracking limitations before
installation steps and links to official AT Mobile and current-service guidance.
The same content is generated into cached install.html and packaged INSTALL.md.


Validation for version 27: 24 JavaScript and four Python tests passed, including
preferred sequences hidden by faster alternatives, unavailable/reversed routes,
mode/transfer rules and legacy storage. All four browser scenarios passed; saved
places and optional services were tested separately, including clearing only the
service preference and reopening offline. The static subpath suite passed
([measurements](evidence/static-v27-metrics.json)). The stop-board dialog also
passed 320-pixel reflow, axe, route drill-down and visible scheduled labelling.
The final guide wording is checked in the deployed offline-help smoke test.


Version 27 is deployed to the private site and GitHub Pages. Core CI and the
[public-site smoke check](evidence/public-site-v27.json) passed, including
installation eligibility, new offline address routing, cached help and its
scheduled-only notice. The public and offline installation guides now carry the
same limitations. Saved endpoints and service preferences remain device-local.


## Current handover candidate

The version 27 draft prerelease `v0.27.0` targets source commit `aff8a8d`. Its ZIP
and checksum match the local build; all ZIP entries match `dist/`. Archive SHA-256:
`c1d622e2ab51b1f3e7728d9b0ca0f59f465f2b65f062210a866caf3783bf2f6c`.
The README now shows six equally sized screenshots of the current public app,
including saved places and the scheduled departure board. Draft download assets
remain maintainer-only pending acceptance; the public app itself is live.

A live mobile-size check measured the optional street-map button at the horizontal
and vertical centre of route, stop and street-address maps. All use the same
shared map markup; the centred treatment applies to each existing map view.


## Version 28: room for the next action

After “Understood”, the course notice becomes an expandable footer item. Its
acknowledgement stays on this device and survives offline reopening. Settings
also retains the full course warning. Mobile review spacing is tighter while
preserving text sizes and touch targets. Browser checks cover acknowledgement,
focus, reopening the notice, offline persistence, blocked storage, accessibility
and the Find button fitting within a 360 × 780 viewport. Physical Samsung S23
confirmation and Android TalkBack remain separate manual checks. The version 27
draft archive above remains the previous packaged candidate.

The header now uses the same icon asset as the installed app, with decorative
image semantics inside the existing labelled home link.

Version 28 is deployed to GitHub Pages. Its [public smoke check](evidence/public-site-v28.json)
passed installation eligibility, Settings version, offline address routing and
cached installation guidance. The former private server has been stopped and
disabled; removal of its Tailscale serving entry requires local administrator
authentication. Existing installations from that origin do not automatically
move to the public origin, and their local saved data is separate.


### Historical language implementation checks (before version 29)

The following entries record incremental checks while version 28 remained public.
See the version 29 section below for the current release evidence.

Language work is tracked in [the implementation and review notes](LOCALIZATION.md).
The language selector is connected in development, but is not deployed to the
public version 28; no complete bilingual release is claimed. The foundation has five unit tests in addition to the existing routing
suite. Existing macron-insensitive search is verified by a stop-search fixture;
that is not proof of complete bilingual place-name aliases.

The static development build passed all eight browser scenarios, including two
new language scenarios: mid-flow switching, saved places, Back, explicit fallback
language metadata, offline new address routing, narrow-screen axe/reflow and
blocked preference storage. This evidence covers migrated headings and controls,
not the still-incomplete whole-interface translation or human language quality.

The draft catalogue now has 93 phrases. Place-entry help, journey actions,
transport labels, walking preferences, sorting and the active preference summary
are connected. Five localisation unit tests and three targeted browser scenarios
passed after this expansion, including the English nearby flow and a 360-pixel
Māori review screen with expanded preferences. Visual inspection caught and fixed
extra nesting that styled the travel legend as a transport button. AI provenance
and possible mistakes remain disclosed. This work is not yet publicly deployed.

Journey result cards, saved-place/service controls, their announcements and step
counts now use the draft catalogue. The English guided journey and both language
browser scenarios passed, including offline planning, unchanged saved services
and keeping the whole-journey disclosure open through a language switch. Dynamic
text is updated in place rather than regenerating route-detail links. Full text
coverage and the public bilingual release remain outstanding.


The supplied AT key passed [authenticated feed checks](evidence/at-authenticated-check.json):
fresh trip updates, service alerts and vehicle locations. Trip ID matching was
1,827 of 2,129 update instances. This is aggregate feed/adapter evidence, not an
on-street test or deployment of live information to the public app. The local
credential file is ignored by Git and readable only by its owner.

Walking instructions, address-result type labels, place-selection validation and
location failure/recovery now use the draft catalogue. Five unit tests and three
language browser scenarios passed. The browser tests check Māori walking guidance,
recoverable location denial, preservation of the current task and saved services,
and that previously cleared validation errors do not reappear on language changes.
The public app is still version 28; complete bilingual coverage is outstanding.

Route/stop exploration, scheduled departure-board labels and map controls now
use the draft catalogue. The English route exploration, bilingual journey and
Māori offline route → stop → Back scenarios passed; the five localisation unit
tests also passed. Cached detail markup reapplies the current language while
retaining filters and focus restoration. The map button's main label retains its
16-pixel emphasis after adding translation spans. No public bilingual release is
claimed. Repository feedback triage found no open issues on this development round.

Settings now includes draft Māori privacy/course explanations, offline-use text,
learning controls and history-clearing status. All five language browser scenarios
and five localisation unit tests passed. The Settings check covers 320-pixel
reflow, axe, expanded course links, clear-history feedback and preserving paused
learning when switching back to English. AI-generated wording remains explicitly
unreviewed. There were no open repository issues in this round's feedback check.

Nearby comparisons now have draft Māori headings, filters, walking estimates,
tight-connection explanations, empty states and scheduled/live labels. The English
mobile nearby scenario and Māori offline comparison scenario passed, as did the
five localisation unit tests. Offline refresh retains scheduled departures and
does not display a live-prediction label. Switching back to English preserves the
displayed comparison. No open repository feedback issues were present this round.

Preparation, offline readiness, dataset/storage summaries and service-update
loading/fallback messages now use the draft catalogue. Known untranslated errors
are explicitly marked English, and expired loading messages are not restored by
a language switch. Browser checks exercise manual refresh failure with retained
offline address search. On emulated offline reload Chromium may retain an online
connection hint: the test accepts either offline-capable readiness label while
still requiring a new journey with network access disabled.

App-update announcements, activation errors and recovery progress now support the
stored language. The complete update regression suite passed, including the
ten-minute HTTP cache, held old windows, mismatched shell rejection, preserved
localStorage/IndexedDB and quiet offline refresh. Added checks confirm Māori
recovery and successful English recovery when the document cannot load its
optional translation module. Recovery retains independent English source text so
a language-asset failure cannot disable its controls. Five localisation unit tests
also passed. No public release or fluent-speaker approval is implied.

Known worker/routing errors now map to translated catalogue phrases without
changing the cached-worker message protocol. Exact matching leaves unexpected
technical errors in their original English. Six localisation unit tests and two
browser scenarios passed: failed manual refresh retains offline data, and an
out-of-timetable date error translates in place then clears when corrected to a
successful search. Fluent-speaker review and full interface/guide coverage remain
outstanding. There were no open repository feedback issues in this round.

## Version 29: public language draft

Released for user testing before complete translation, at the user's request.
Settings → Language → Te reo Māori selects the draft. The interface and README
state that the wording is AI-generated, may contain mistakes and lacks fluent
review. Installation guidance and some interface text remain English. This is
not completion of goal 10.

Saved/learned journey cards and preferred service explanations now translate
in place. The browser regression covers offline reopening, preserving the same
card control across switches, and retaining each saved service sequence. Waiting
for offline readiness matters: visible saved cards do not mean street data has
finished loading after a reopen. Journey reuse may change the learned order.

Verified before publication: 30 JavaScript and four Python tests; update/recovery
regressions including Māori and missing-module fallback; static subpath
installability, keyboard/AX semantics, contrast, 200% zoom, 320px reflow, dataset
refresh and offline address routing. [Static measurements](evidence/language-draft-v29-static.json)
are from desktop Chromium, not a physical phone.

All 14 browser scenarios passed for this candidate, including the eight language
scenarios. The local deployment smoke check also passed the version marker,
installation eligibility, offline planning/guide and persistent Māori selection.
Physical Android, TalkBack and fluent-speaker review are not covered by these tests.

Version 29 is deployed. The [public smoke check](evidence/public-site-v29.json)
passed on `https://reality2.ai/along/`: version and scope, installation eligibility,
offline new address routing, installation guidance, language switching and
persistent Māori selection after offline reopening. Pages deployment
[35818573316](https://github.com/reality2-ai/along/actions/runs/35818573316) succeeded.

### Post-v29 source: remaining static labels

Added 23 draft phrases for course/accessibility notices, journey-region names,
service-update controls and attribution text. Six localisation unit checks and
two targeted browser scenarios passed. They verify translated region labels,
retained AT links, narrow-screen layout and axe checks, plus offline switching
and saved-service preservation. These source changes are awaiting the next
versioned deployment; public version 29 remains unchanged.

The bilingual journey regression also passes with transport names in the saved
service announcement re-resolved on each language switch (`Train S-C` →
`Tereina S-C` → the original English announcement). Saved routes, open journey
steps and offline reopening remain intact. This is source evidence for the next
release, not a change to the deployed version 29.

### Post-v29 source: bilingual offline installation guidance

The full Māori guide is an unreviewed AI translation alongside the English source.
Two browser checks passed: offline opening from the app's stored language, all
nine platform groups, retained disclosure/focus, matching external links, 320px
reflow and axe checks, return to the app with the same language, and readable
English fallback when the guide script fails. Six localisation unit checks and
the static subpath suite also passed. Both guides are bundled in the static build;
public deployment awaits the next version. Human linguistic/platform validation
remains outstanding.

## Version 30: installation guidance in both languages

Version 30 packages the bilingual installation guide, remaining static course and
accessibility labels, and the saved-service announcement fix. The guide follows
the local language, works offline, preserves the expanded platform section when
switching, and falls back to readable English if its script cannot load. The
Māori text remains an unreviewed AI-generated draft. Named-business/POI search
was discussed but is not part of this release.

Prepublication checks passed: 30 JavaScript and four Python tests, all 16 browser
scenarios, update/recovery regressions and the local release smoke check. The
static subpath suite passed on these guide changes before the version bump.
The ZIP checksum and every archived file were compared with `dist/`; both guide
sources are present and local credentials are excluded.

Version 30 is live: [public smoke evidence](evidence/public-site-v30.json) confirms
version/scope, installability, offline new-address routing, bilingual guide and
language persistence. [Pages deployment](https://github.com/reality2-ai/along/actions/runs/35819556453)
succeeded. The [experimental downloadable release](https://github.com/reality2-ai/along/releases/tag/v0.30.0)
is public and explicitly marked prerelease. Its uploaded ZIP and checksum digests
match the local verified files: [release evidence](evidence/release-v30.json).

## Feedback foundation after version 30

The local feedback model now preserves drafts and report IDs, permits only
allowlisted opt-in context, prepares reviewable GitHub handoffs, and verifies an
explicit issue URL against the frozen report body. Three unit checks pass,
including blocked storage, long Unicode text, unrelated issues/PRs, offline
verification and reopening a verified existing issue. No UI or real submission
check has been completed, and version 30 remains unchanged.

## Contextual feedback interface (source after version 30)

The bilingual dialog is connected to Settings, journey/departure notes and
route/stop details. It preserves local drafts, reviews exact text and opt-in
context, labels GitHub sign-in/public submission, defers handoff when the browser
is offline, and exposes explicit receipt verification. Closing returns focus to
the opening control; route detail and Back are preserved.

Nine feedback/localisation unit checks and two feedback browser scenarios passed.
The browser scenarios intercept GitHub and use receipt fixtures; this is not proof
of actual delivery. Axe and narrow-screen checks passed in the dialog. A final
request-sequencing guard prevents late checks from affecting a reopened dialog;
broader failure/race tests and actual submission remain outstanding. Public
version 30 is unchanged.

## Feedback delivery and late-response checks

Four feedback browser scenarios pass. New drafts clear stale issue/retry fields;
a late receipt cannot mark a new draft received. Blocked storage is disclosed
and the session draft remains usable. A [real synthetic report](evidence/feedback-delivery.json)
was accepted by the repository, verified through the app's anonymous browser
receipt check, and closed. Submission used GitHub CLI; the interactive GitHub
composer/sign-in step is explicitly not claimed as tested. These changes remain
in source pending a versioned public deployment.

## Version 31: contextual public feedback

Feedback is available in Settings, route/stop details and journey/departure notes.
The feedback dialog keeps drafts locally, shows the exact text before handoff,
and attaches only opt-in version/language/general-screen context. GitHub account
and final submission requirements are explicit. Receipt is checked from a pasted
issue URL; opening GitHub never counts as delivery. The guides and README explain
that this deliberate public submission is separate from private journey planning.

New-repository review found no commuter reports; only the closed synthetic test
issue exists. Interactive GitHub sign-in/submission and physical accessibility
checks remain outstanding even though real receipt verification passed.

### Revised version 31 scope: English only

Before publication the user withdrew the Māori translation option. Version 31
removes the selector, translation notices and bilingual guide interface. App and
recovery use English regardless of a saved language preference. The Māori guide
is excluded from the downloadable build; its source and earlier review history
are retained as deferred work. Official names are unchanged. Historical bilingual
browser scenarios are in `test/deferred/`, outside the active test suite. A new
regression covers old Māori preferences across app/guide/recovery and offline use.

The revised release passed all 11 active browser scenarios, including removal
of language controls and English app/guide/recovery with an old Māori preference.
The earlier 10 bilingual browser cases are deferred, not counted as current
release coverage. The core suite passed 33 JavaScript and four Python tests;
update/recovery and local deployment smoke checks passed. The downloadable guide
is English-only and archive contents/checksum were verified.

Version 31 is published. [Public smoke evidence](evidence/public-site-v31.json)
confirms the English-only interface despite a saved Māori preference, offline
new-address planning, installation guidance and feedback draft recovery. The
[static subpath checks](evidence/feedback-v31-static.json) passed.
[Pages deployment](https://github.com/reality2-ai/along/actions/runs/35820916394)
succeeded, and the [downloadable prerelease](https://github.com/reality2-ai/along/releases/tag/v0.31.0)
assets have [verified digests](evidence/release-v31.json).

## Live backend preparation after version 31

The local Python server can load the user-supplied ignored `APIKey` file; explicit
`AT_API_KEY` values take precedence and an empty value disables live access.
Credential errors do not echo file contents. Missing current UI module routes
were restored, and GitHub receipt requests are allowed by the local CSP. Five
focused Python tests pass for credentials, authenticated adapter behaviour,
current HTTP assets and rejecting private-file URLs. No public live backend has
been deployed and the retired private service remains untouched.

## Version 32: visible actions and consistent journey choices

Feedback is visible outside the journey/departure disclosures. Text-like actions
now have quiet outlines, expandable sections have boundaries and native markers,
and every Use this journey button has full width and 24 px separation. The filled
primary action remains stronger. The phone review layout keeps Find my way within
a 360 × 780 viewport after acknowledgement; swap shares the change-place row.

Validation: 35 JavaScript and 7 Python checks passed. The 12 browser scenarios
passed across the full run and the focused rerun after fixing the phone-height
regression. Static-subpath accessibility (including 320 px, 200% zoom and forced
colours), offline routing/data refresh and installed-app update checks passed.
These are automated checks, not physical phone or TalkBack observations.

Live-feed matching also now rejects undated, wrong-date, wrong-route and ambiguous
trip instances, retaining scheduled times for malformed numeric events. The public
live connection remains disabled.

Version 32 is published at https://reality2.ai/along/. Pages deployment
[35821861941](https://github.com/reality2-ai/along/actions/runs/35821861941) passed.
[Release asset hashes](evidence/release-v32.json) match the local ZIP/checksum.
[Public smoke evidence](evidence/public-site-v32.json) records deployed-version,
offline journey and feedback-draft verification. A separate mobile layout fixture
confirmed both primary and alternative journey buttons fill their 286 px content
width with 24 px top spacing; that fixture is not evidence of a real alternative
route result.

## Version 33: one disclosure boundary and explicit live checks

The collapsed risk notice reads “Use at your own risk”; the course explanation
is inside. Redundant outer borders around disclosure controls are removed.

The source includes opt-in nearby and stop live checks, credential-free feed
requests, strict matching, original schedule retention and expiry/cancellation.
Public configuration still has no live proxy URL, so these controls stay hidden
on Pages. Live prediction browser fixtures are synthetic and are not proof of
public authenticated service or real-device performance. Repeated-stop matching,
selected-journey alerts, vehicle positions and public live hosting remain open.

Version 33 validation passed: 49 JavaScript tests, 11 Python tests, all 15 browser
scenarios, static subpath/accessibility/offline checks, update/recovery checks and
local release smoke. The ZIP is byte-identical to the generated static files and
excludes the private key. This does not replace physical-device/TalkBack checks.

Version 33 Pages deployment [35823256837](https://github.com/reality2-ai/along/actions/runs/35823256837) succeeded.
[Release hashes](evidence/release-v33.json) match the local ZIP/checksum.
[Public smoke evidence](evidence/public-site-v33.json) records the deployed version
and offline journey, installation-guide and feedback-draft checks.

## Version 34: full-width actions and contextual map controls

Standalone actions use the available width. The home brand says “Auckland public
transport”. Every contextual map has an app-window full-screen control and a
one-shot location-centre control with an accuracy circle. Escape, close and Back
restore the detail. Denied location permission preserves manual map exploration.
Route geometry remains available offline; uncached street backgrounds need a
connection. Location-centre does not start background tracking.

Nearby predictions now use the same conservative matcher as stop boards,
including no-data, invalid numeric events and repeated-stop safeguards. Original
GTFS stop-sequence support is still needed to enable live predictions for loops.

Validation: 50 JavaScript and 11 Python tests passed, along with all 16 browser
scenarios, static subpath/accessibility/offline checks and installed-app update
checks. The final removal of the home progress label is additionally checked by
the release smoke and focused journey-navigation checks. Geolocation is emulated
in browser tests, including permission denial; actual device GPS remains untested.

Version 34 deployment [35823924808](https://github.com/reality2-ai/along/actions/runs/35823924808) is recorded with
[release hashes](evidence/release-v34.json) and [public smoke evidence](evidence/public-site-v34.json).


## Version 35 icon update

The loop-and-arrow mark was replaced with a curved route joining two stops to
address its resemblance to the male gender symbol. The SVG, in-app header,
GitHub heading, Android regular/maskable icons, Apple touch icon and favicon use
the same artwork. Screenshots were refreshed from the rendered app.

This release also packages the tested experimental contextual-live source work,
but the public live connection remains disabled. Direct AT access and Reality2
credential integration are the intended architecture; no Along proxy is deployed.
Installed launchers may refresh their cached icon independently of the app shell;
actual Android and desktop launcher appearance still needs observation.

## Version 36 release

This release retains original GTFS boarding sequences, operator IDs and trip
directions for contextual live matching. Repeated-stop identities are verified
against real AT data; wrong operators/directions remain excluded. Predictions
expire using their individual measurement time, including nearby comparisons.
The offline timetable keeps its existing services and schedule coverage.

Direct browser access to AT has been verified, but this release does not enable
public live access or implement Reality2 credential storage. The public app
continues to use scheduled information. Physical screen-reader and device checks
remain open; automated Chromium checks cannot substitute for those observations.

Candidate validation: 68 JavaScript and 18 Python tests, all 20 browser scenarios,
static subpath/offline/accessibility checks and installed-app update checks passed.
The archive matches dist byte-for-byte and contains no local AT credential.

Version 36 [Pages deployment](https://github.com/reality2-ai/along/actions/runs/35829786257)
succeeded. [Public-site checks](evidence/public-site-v36.json) confirm version 36,
installability, offline new-address routing, installation guidance and feedback
draft recovery with no page errors. [Release evidence](evidence/release-v36.json)
records verified GitHub asset hashes and public shell/build metadata comparisons.
The enriched dataset is now published; existing devices can fetch it through
Settings → Update downloaded timetable.

## Version 37 layout fixes

The Filter departures label now stays inline with its native disclosure marker.
The description-only styling applies only to the journey preference description.
Change starting place now spans the card width; the swap control sits beside the
place heading. At a 360-pixel viewport the button fills all 286 available pixels.
Mobile nearby and address-journey browser scenarios pass, including their
accessibility checks; rendered screenshots were inspected. This release changes
layout only, with the same data and live-connection status as version 36.

Version 37 [deployment](https://github.com/reality2-ai/along/actions/runs/35831301505)
succeeded. [Public smoke checks](evidence/public-site-v37.json) passed, including
offline new-address routing and feedback draft recovery. Public CSS, shell and
build metadata match the tested files; [release hashes](evidence/release-v37.json)
match the downloadable archive. The version 36 full-suite results remain the
baseline; version 37 adds focused layout/browser checks rather than claiming
a new run of that entire suite.


## Public app regression check during R2 development

A fresh local rebuild of version 37 passed all 68 JavaScript and 18 Python tests,
the static `/along/` Chromium check, and installed-app update recovery checks.
The latter cover stale open windows, mismatched deployments, retained localStorage
and IndexedDB, English recovery despite a saved Māori preference, and quiet
refresh while offline. Static checks include new-address routing offline, saved
journeys, installability, keyboard/axe, zoom, narrow screens and failed/successful
data refresh.

[Recheck evidence](evidence/release-v37-recheck.json) records the source revision,
build metadata, archive checksum and desktop timings. The ZIP was compared
byte-for-byte with `dist`; experimental files and the local credential filename
are absent. This rebuilt archive has not replaced the published release, whose
original hashes remain authoritative. No public app version changed, no provider
was contacted, and the full 20-scenario browser suite was not rerun in this pass.
Physical-device, spoken screen-reader and R2 end-to-end gates remain open.

## Device preview candidate: separate storage and coexistence

The experimental builder now has a `--preview` candidate mode using the verified
R2 runtime bundle. Candidate version 3801 has a distinct manifest name and separate
preferences, feedback, course acknowledgement, device/timetable databases and shell
cache names. It remains local generated output with a do-not-publish marker.

`PREVIEW=1 node experiments/journey-sync/app-integration.test.mjs` passed the actual
two-profile device enrollment, journey sharing, offline save/removal convergence,
permission management and focus-preservation checks with the separate names.
`node experiments/journey-sync/preview-coexistence.test.mjs` then served the regular
app and preview on one origin. Preview identity setup, update/reopen and offline
reopening preserved the regular preferences, feedback draft and pairing sentinel,
and every regular shell-cache response matched its earlier SHA-256 hash.

These checks establish coexistence, not same-origin security isolation or physical
installation acceptance. Public version 37 and the standalone pairing lab remain
the deployed builds; this candidate has not replaced either.

### Preview wording and AT/update qualification

The preview now has its own Settings privacy/live wording and offline installation
guide. The history-clearing action explicitly includes saved places and explains
that permitted devices receive those removals. Browser/platform instructions are
rendered from the existing installation guide; they are not a fresh physical
qualification of every browser. The [S23/desktop check](PREVIEW_DEVICE_CHECK.md)
requires no human coding and keeps TalkBack separate from ordinary touch use.

Using `PREVIEW=1`, the owner-key app check passed with `CHECK_BFCACHE=1`; the
two-app check passed with `MAIN_APP_SETUP=1 REPLACE_SHARED_KEY=1`. These establish
synthetic-key setup, encrypted sharing/replacement, contextual mocked AT reads,
withheld removal before another provider request, quiet offline fallback and
survival of unreadable schema/stalled runtime/browser Back. The preview guide also
passed offline opening, 320px/200% reflow and axe. No production credential was used.

The coexistence check now serves a simulated older 3800 shell, then activates 3801.
Saved places, the verified device identity/revision and exact encrypted key record
survive the upgrade and offline reopening. The regular app's storage/cache remains
unchanged. This is an upgrade fixture, not evidence of a released version 3800.
Publishing the qualified test preview and inspecting its HTTPS deployment are next;
physical observations and the wider unfinished TG/sync goal remain separate gates.

### Preview 3801 published and checked over HTTPS

[Pages deployment 35930213335](https://github.com/reality2-ai/along/actions/runs/35930213335)
published only the new `preview/` directory. The regular app and standalone lab
files were unchanged. [HTTPS evidence](evidence/device-preview-3801-public.json)
records all 242 payload hashes matching the reviewed release, fresh-profile device
setup and reload, offline installation guidance, and a new offline address-based
bus/ferry journey. There were no page errors or external requests in that check.
The public regular app's HTML, worker and manifest also matched the unchanged
deployment files byte for byte.

The [prerelease download](https://github.com/reality2-ai/along/releases/tag/device-preview-3801)
is 41,639,475 bytes (about 39.7 MiB), with SHA-256
`c71d2c83b9cd465d46287a21534d622b78f21a259d2885ef35a84fccfba739c4`.
The archive matches the prepared release tree, and both GitHub asset digests/sizes
match their local files. [Release metadata](evidence/device-preview-3801-release.json)
links the deployment, source, qualification, public check and download.

The candidate's local-only marker is removed only by the release packager after
its exact manifest matches the recorded qualification. The published test copy
includes runtime provenance, notices, installation guidance and the device-check
guide. This publication enables physical testing; it does not establish that those
observations have passed or that the full project goal is complete.

### Preview feedback receipt on the published origin

[Recorded check](evidence/feedback-delivery-preview-3801.json) starts with a typed
draft in preview 3801, recovers it offline, reviews the exact body and opens the
real GitHub sign-in handoff. GitHub CLI submits that body; the browser anonymously
verifies the resulting issue after an offline retry and retains the existing
receipt on another offline reload. [Issue 2](https://github.com/reality2-ai/along/issues/2)
is explicitly synthetic and closed as completed. No open user reports were present
when checked after this run. The signed-in composer and final browser submission
remain untested; the device guide now includes that optional human check.


## Regular-app audit with a managed browser-test server

The current regular-app source passed 68 JavaScript tests, 18 Python tests, all
20 browser scenarios, and independent raw-GTFS bus/train/ferry exploration checks.
[Audit evidence](evidence/regular-app-managed-server-audit.json) records the source
base, test-configuration hash and log hashes. The browser command now starts and
stops its own local server with AT credentials explicitly disabled. An initial
invocation before this change failed because no server was running; the complete
managed-server rerun passed. A caller-supplied `TEST_BASE_URL` remains supported.

This updates the ordinary planner's full-browser baseline. It does not qualify a
new preview, deploy an app update, establish real-provider access or substitute
for physical-device/spoken screen-reader acceptance.

Version 42 distribution follow-up: the [isolated public-source rebuild](evidence/regular-v42-public-source-rebuild.json)
reproduces all 283 application files using only public source and verified release
inputs. No host checkout, local data or credentials are mounted. This closes the
current application reproduction check, not physical-device or relay acceptance.
