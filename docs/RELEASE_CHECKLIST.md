# Release evidence and remaining gates

Current deployed app: **version 28**, reviewed 23 September 2026. The static ZIP
is prepared and the private server is retired. GitHub Pages is published at `reality2.ai/along/`; no AWS deployment has been made.
This register separates automated evidence, user observations and remaining checks.

## Goal audit

The [original goal and completion criteria](PROJECT_GOAL.md) define the scope of
this audit. Later public-hosting work supplements that brief.

| Requirement | Current evidence | Remaining limits or gates |
| --- | --- | --- |
| 1. Contextual interaction | Guided destination/origin/review/options/follow flow; route → direction/branch → stops/map → stop departures; Back/Escape and focus/filter restoration tested | Physical assessment of new contextual maps |
| 2. Real journeys | Address-based train/ferry, bus and walking examples; independent raw GTFS validation; nearby and transfer fixtures; route 70/Symonds browser check | Snapshot correctness does not establish on-street conditions |
| 3. Inclusion | Keyboard, axe, contrast, zoom, narrow screens, touch emulation, reduced motion and forced colours; text alternatives to maps | Spoken TalkBack/desktop-reader check; no disabled-commuter participant study |
| 4. Installation and updates | Icons/manifest/installability; offline reopening; old-tab migration; quiet offline pull; failed/successful dataset refresh with saved journeys retained; Android update repair accepted after v23 | Exact Android installation browser not recorded; latest contextual interface needs physical checks |
| 5. Browser independence | Static `/along/` host with no Python API; offline new address routes; stored route geometry; measured download/storage/time | Low-memory phone performance not characterised; no evidence requiring WASM |
| 6. Distribution | About 38 MiB ZIP/checksum, four data bundles, import scripts, MIT/data/Leaflet notices, AWS/Pages hosting instructions | Public Pages deployment is live; authenticated feeds now verified; public live proxy remains undeployed |
| 7. GitHub documentation | README, architecture, data, hosting, privacy, limits and contribution guidance; v21 course notice and current design-driver/goal summaries | Public source repository: [reality2-ai/along](https://github.com/reality2-ai/along); app hosted at [reality2.ai/along](https://reality2.ai/along/) |
| 8. Course material | Thematic analysis, six lessons, exercises, assessment rubric and negative-case/contextual-map refinements | Course effectiveness has not been studied |
| 9. Release checks and handover | 24 JavaScript and 4 Python tests; four real-data browser scenarios; static/update suites; source/archive/live asset comparison | Remaining physical and spoken screen-reader checks prevent claiming full goal completion |

| 10. English / Te reo Māori | Device-local language module, 148-phrase draft catalogue and review sheet; flow selector connected in development; five foundation and two language-browser tests pass | Remaining screen text and full catalogue/guides, subpath/update checks, broader language/accessibility tests and fluent-speaker review |

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

## Handover limits

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
