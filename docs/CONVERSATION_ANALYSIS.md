# From a commuter idea to an independent travel companion

## Purpose and method

This is a thematic analysis of the user–AI conversation that produced Along. It
examines both **what the user wanted** and **how the collaboration shaped the
result**. It is intended for an AI-assisted coding course, not as a transcript of
usability research or a claim that the design is universally usable.

The corpus is the available design conversation, reviewed on 23 September 2026,
with development observations updated on 24 September 2026,
including the requests for public hosting, installation guidance, privacy, course
status, consistent screenshots with a real map, and this README summary of the
original drivers, followed by the contextual live-data, independent hosting and
explicitly approved browser trust-group development decisions. This is a synthesis of the available conversation, not a
complete verbatim transcript.
Requirement-bearing user messages are the primary
evidence. Assistant proposals, implementation decisions and test results provide
secondary evidence about the response. Brief requests to resume work are treated
as interaction context rather than product requirements. Repeated requests about
calm design and thematic analysis are retained as evidence of emphasis, not counted
as independent participants or used to imply statistical importance.

The approach is a pragmatic, reflexive thematic analysis:

1. Read the conversation as a whole, retaining earlier requests as later ones arrive.
2. Code concrete requests and interaction patterns close to the original wording.
3. Group codes into candidate themes, allowing a message to belong to several themes.
4. Review whether each theme explains a pattern across the conversation, and check
   for tensions or contrary evidence rather than forcing everything into agreement.
5. Name themes, connect them to product decisions, and identify unresolved questions.
6. Write an account that separates observation, interpretation and implementation.

Some codes are inductive: the request to compare nearby stops exposes a need for
situational decision support. Others are explicitly theory-led: the user names
calm computing, experiential cognition, progressive discovery and disability
inclusion. The analyst is also the AI that helped implement the app. That creates
a risk of explaining away its own mistakes; failures and unsupported assumptions
are therefore part of this account. There was no independent coder, participant
validation, saturation assessment or inter-rater reliability measurement.

Quoted fragments below come from user messages. Spelling is lightly normalised
where needed for readability; the surrounding summaries are paraphrases.

**Status boundary:** this document analyses requirements and their implications;
it is not a release or test-completion report. Design responses describe the
direction of the work, including changes still being verified. The verification
table identifies relevant checks, not a claim that every check has passed.
Public documentation, publication and course packaging are distinct deliverables.
The repository is now public and the app is hosted at
[reality2.ai/along](https://reality2.ai/along/). Current release evidence and
remaining checks are recorded in [the release checklist](RELEASE_CHECKLIST.md);
publication does not establish readiness for every person or journey.

## Working codebook

| Code | Conversation evidence | Analytic interpretation |
| --- | --- | --- |
| C01: intuitive commute | “an intuitive tool for commuters” using the AT API | The task begins with a human activity, not a preferred framework. |
| C02: trusted transport source | “the same as the Auckland Transport app” / “AT webapp” | Familiarity and trustworthy data matter; identical proprietary routing was not established. |
| C03: situated choice | “which bus stop that [has] different lines has the next bus” | Route choice is a decision about location, direction and time, not merely a list of lines. |
| C04: routine with agency | “learn my normal routes” and “possible to do something different” | Personalisation should reduce effort without trapping the user in a prediction. |
| C05: local independence | “exist inside a browser once it has been loaded the first time” | Offline persistence is a product requirement, not a later optimisation. |
| C06: technology as means | “perhaps using wasm where required”; later, a server inside WASM | The user suggests a possible mechanism while prioritising self-contained behaviour. |
| C07: familiar entry points | phone testing over Tailscale; “a nice icon” for installation | The experience includes reaching, recognising and reopening the tool. |
| C08: operational continuity | restart the webapp when the computer restarts | Reliability extends beyond an open terminal and the coding session. |
| C09: complete journeys | “street address to street address” and multiple transport types | People think in destinations; transit stops are intermediate system details. |
| C10: calm discovery | repeated request for calm computing, experiential cognition and progressive discovery | Reduce attention demands and organise information around action. |
| C11: inclusion | “all types of people with various disabilities” | Perception, interaction and real-world route access must all be considered. |
| C12: reusable learning | anyone can install it; use it in an AI coding course; GitHub README | The development process and its reasoning become deliverables alongside software. |
| C13: interpretive account | explicit and repeated request for thematic analysis | The requested learning artefact is explanatory, not merely a chronological changelog. |
| C14: next-action clarity | “what is the user most likely to want to do next” | Hierarchy should follow the user's task stage, with alternatives preserved. |
| C15: installed continuity | “from the saved webapp, it still looks the same”; refresh should check, but offline “fail quietly” | An update is only useful if the installed experience can receive it without breaking offline calm. |
| C16: portable working context | copy the AI launcher into a folder and keep its sessions local | The development tools should preserve project context as reliably as the app preserves journey context. |
| C17: task-contingent visibility | “still visually very busy”; “like a wizard almost” | The current activity should determine what is visible; collapsible panels alone did not satisfy calm design. |
| C18: connected exploration | select a route or stop, go deeper, and back out; the Symonds Street example | Understanding a service is a legitimate task before choosing a journey. |
| C19: contextual spatial detail | a map “where it would be relevant”; “always” keep current context | Maps should answer a situated question, not become a permanent competing dashboard. |
| C20: trusted-device continuity | use Reality2 to synchronise devices “in the same trust group” when online | Continuity is desired within an explicit trust boundary, while offline independence remains essential. |
| C21: public distribution | AWS or GitHub Pages; public repository; “reality2.ai as the github.io portal” | Make the app reachable and reusable without making routing depend on that portal. |
| C22: understandable installation | browser/platform instructions; the app “does not require the web portal to operate” | Explain preparation and reopening in terms people can verify, beyond offering an install icon. |
| C23: explicit privacy | “your data stays on your device” | Local data ownership must be understandable in public wording, not only present in code. |
| C24: visible educational status | emphasise a course exercise and “use it at your own risk” in repo and app | Public presentation should communicate the basis and limits of trust at the point of use. |
| C25: representative presentation | UX images; equal heights and full-width pairs; “map one showing an actual map” | Readers need a coherent, concrete preview, with real behaviour and its conditions represented honestly. |
| C26: preserve the design rationale | add “core drivers” repeatedly given and link/update this analysis | Documentation should retain the user's priorities as implementation and distribution expand. |
| C27: human direction without human coding | “without any actual coding by the human (ie me)” | Implementation belongs to the AI; human participation centres on intention, judgment and observation. |
| C28: operational autonomy | “independent of any central server aside from that we are getting info from” | Independence extends from offline planning to ownership of the live-data connection. |
| C29: contextual enhancement | “the online information must be completely contextual” | Connectivity should improve the current decision without taking over the task. |
| C30: explicit scope expansion | “Develop the missing TG capability” | A proposed integration becomes authorized runtime development; approval does not establish that the capability exists. |
| C31: reference-based redirection | “in terms of using R2, look at how notekeeper does it” | Examine an existing application before extending bespoke integration; reuse depends on the actual implementation and the earlier constraints. |

## Central organising idea: independence with control

Across the conversation, a commuter tool becomes a companion that should support
independent action without demanding constant attention or connectivity. The user
asks it to remember, but leaves room for deviation; to guide, but reveal detail
progressively; to be local and portable, but use trustworthy public data; and to
include people whose needs cannot be reduced to an average walking speed.

This is an interpretation of the interaction, not a psychological claim about
the user or evidence about all Auckland commuters.

## Theme 1 — Solve the situation, not only the query

**Evidence:** C03 and C09 connect the next useful bus stop with the later demand
for street-to-street, mixed-mode journeys.

**Interpretation:** “Best route” is underspecified until it is grounded in a
situation. A commuter may need to decide whether to walk to another stop, whether
a service goes in the right direction, and what to do after leaving the vehicle.
The initial stop-to-stop implementation addressed only part of that activity.

**Design response:** address suggestions include suburbs; the planner joins access
walks, buses, trains, ferries and the final walk; the nearby board compares stops;
the first result gives a concrete next action. Walking through the actual street
graph is preferable to treating straight-line proximity as connectivity.

**Tension:** precision of presentation can exceed precision of data. Building and
platform access links are estimated; the first route is best among the bounded
options searched, not a proven global optimum. A late correction expanded walking
transfers after a real Newmarket-to-Devonport test exposed a missed ferry connection;
the corrected train-and-ferry journey subsequently passed the browser integration check.

**Course lesson:** turn an abstract adjective such as “intuitive” into scenarios
before treating a polished interface as a complete product.

## Theme 2 — Remember the routine without taking away choice

**Evidence:** C04 combines adaptation and deviation in the same request.

**Interpretation:** learning is useful when it removes repetition; it becomes
restrictive if a prediction silently dictates the journey. The phrase “something
different” is essential, not an exception to discard when implementing favourites.

**Design response:** recurring successful searches and time-of-day patterns create
local suggestions. Explicit saved journeys coexist with learning. “New journey,”
pause-learning and clear-history controls preserve agency. New destinations are
always available through the same primary inputs.

**Tension:** repeated searches are not proof of trips taken. The implementation
learns search behaviour, does not continuously track travel, and should describe
itself accordingly. A small transparent heuristic is more accountable here than
an unexplained claim of AI-powered personalisation.

**Course lesson:** define what “learn” means operationally, identify the data it
needs, and give the user a way to inspect, bypass and erase the result.

## Theme 3 — Independence is architectural and operational

**Evidence:** C05–C08 link offline browser use, optional WASM, phone access,
installation identity and restart behaviour.

**Interpretation:** independence is more than an offline landing page. The useful
work must survive loss of connectivity, closure of the development terminal and
reopening on another occasion. The proposed technology is subordinate to that
outcome.

**Design response:** a service worker caches the interface; IndexedDB stores public
transport, address and walking data; a Web Worker runs routing locally. A static
build supports public HTTPS hosting. A separate systemd example supports a private
host, and Tailscale provides HTTPS access during development.

**Tension:** local datasets increase first-download, storage and memory demands.
Browsers may evict data. Timetables expire. Live predictions cannot be made offline.
WASM may help later, but it does not by itself provide service-worker persistence,
HTTPS hosting, a public network listener or fresh external data.

**Course lesson:** verify the user-visible property—disconnect, reload and plan—
instead of equating an architectural label with success.

## Theme 4 — Calm interaction makes the next action legible

**Later clarification:** the user explicitly asks that the most likely next action
be the most clearly afforded option. This sharpens the theme from reducing visual
load to making task progression apparent. The standing rule and state-by-state
review are recorded in [Interaction principles](INTERACTION_PRINCIPLES.md).

**Evidence:** C10 was repeated. It also complements the request to recognise
normal journeys rather than reconstruct them every day.

**Interpretation:** the user is asking for an attention budget. Experiential
cognition is interpreted here as support for recognition and situated action:
familiar addresses, route names, stop names and a clear next step. This is a design
hypothesis, not a cognitive effect established by testing.

**Design response:** the initial disclosures were refined into a destination-first
sequence: origin, preferences, options and one journey step at a time follow as
needed. Route and stop details open deeper layers with a way back. Nearby departures
have their own task flow. Manual refresh avoids repeatedly moving a list while
someone is reading it. The later wizard request is corrective evidence, not proof
that the initial design already achieved calm interaction.

**Tension:** hiding too much can hide essential controls. Access needs must remain
findable and remembered; important uncertainty must be visible before relying on a
route. Calm visual styling must not rely on pale, low-contrast text. An automated
check caught precisely that problem in the “tight departure” text and prompted a
contrast correction.

**Course lesson:** progressive disclosure is a hierarchy of decisions, not a
reason to make important facts difficult to find.

## Theme 5 — Inclusion requires honest evidence, not a label

**Evidence:** C11 broadens the design beyond a single “typical commuter.”

**Interpretation:** disability inclusion has two distinct dimensions: being able
to operate the interface and being able to undertake the physical journey. A
screen-reader-compatible form does not make a station step-free; a step-free
vehicle does not verify the path to it.

**Design response:** semantic controls, keyboard-operable suggestions, text labels
alongside colour, larger touch targets, stronger contrast, scalable layouts,
reduced motion, explicit updates and plain-language instructions. Travel
preferences include slower pace, avoiding mapped steps/barriers and requiring
confirmed vehicle/stop accessibility.

**Contrary evidence:** the imported AT feed reports wheelchair accessibility as
unknown for every imported stop and trip. The strict accessibility filter must
therefore be able to return no verified journey. Missing data cannot become a
positive accessibility claim. OSM also cannot verify every kerb, surface, lift
outage or building entrance.

**Course lesson:** test what the data can establish. Automated accessibility checks
and keyboard tests are necessary evidence, but do not replace testing with disabled
people and assistive technologies in real travel contexts.

## Theme 6 — The collaboration moves from making to explaining

**Evidence:** C12–C13 ask for a publicly reusable app and thematic learning material.

**Interpretation:** the process is itself part of the product. A useful course
example must expose reasoning, limitations and correction, not just a successful
screenshot or a cleaned-up story of one perfect prompt.

**Required handover:** a public README, reproducible data imports, source/licence
notices, architecture notes, test instructions and this analysis. Development-only
hostnames, user identities and credentials should be excluded from public instructions.

**Tension:** easy installation and production readiness are different. The public
bundle is intended to support hosting and installation, but publication, authenticated live-data
verification, representative device testing and broader accessibility validation
are separate steps. Documentation must say which has happened.

**Course lesson:** an AI coding exercise should end with reproducible evidence and
an honest handover, not merely “it works on my machine.”

## Follow-up evidence: the installed experience challenged the completion claim

After the assistant reported that the site was updated, the user said the saved
webapp still looked unchanged. Server files, an active service worker, a waiting
worker and an already open installed window are different states. The earlier
handover did not make that distinction actionable enough. The response added an
explicit update notice, a recovery page and a test that holds an old tab open.

The next two requests refined the desired experience: refreshing should check for
updates, but an offline failure should be quiet. Together they reject a false
choice between freshness and offline resilience. The person should remain able
to travel while the system takes responsibility for checking in the background.
That is direct support for themes 3 and 4, rather than a separate “refresh feature.”

The launcher incident supplies a parallel lesson for the course: copied tooling
contained another project's hard-coded path and session names. The fix derived
session identity from the containing folder and tested isolation using two
identically named folders. This is evidence of context leaking through reused
implementation assumptions; it is not evidence about commuter behaviour.

## What the interaction reveals about AI-assisted work

The interaction follows an expanding sequence: a concrete travel problem becomes
a contextual assistant, then a dependable installed tool, then an inclusive
whole-journey service, and finally a public teaching example. These are changes in
the criteria for success, not merely additions to a feature list. The phrase
“looking good, but…” is particularly revealing: positive feedback on what exists
coexists with a substantial correction to what counts as a complete journey.

There is also a useful distinction between outcomes and suggested mechanisms.
“Street address to street address” specifies an outcome; “perhaps using WASM”
suggests one possible mechanism. Treating both as equally fixed requirements would
misread the conversation. Likewise, repetition makes a priority visible, but does
not establish why it was repeated: emphasis, perceived omission and simple
duplication are all possible explanations.

| Observed pattern | What it contributed | What needs care |
| --- | --- | --- |
| The user supplied short, concrete scenarios progressively. | Revealed requirements that a generic route-planner brief misses. | Later messages must enrich the original task instead of silently replacing it. |
| The assistant started implementing quickly. | Produced something concrete to inspect and steer. | An early polished stop-to-stop app could be mistaken for completion of the broader commuter task. |
| The user repeated calm-design and analysis requests. | Kept non-functional goals visible while implementation expanded. | Repetition should trigger a requirements check, not another acknowledgement without changes. |
| The assistant researched API and data availability. | Found a key-free timetable path and distinguished schedule from live data. | AT's public feed is not proof of access to its proprietary journey-planning engine. |
| Tool failures and tests interrupted the plan. | Exposed sandbox restrictions, port conflicts, contrast issues and routing gaps. | Report the actual failure, avoid speculative diagnoses, and distinguish a failed test from a product defect. |
| The user proposed WASM conditionally. | Opened an architectural possibility. | Do not turn an optional mechanism into unnecessary complexity before measurement. |
| Public use and teaching became explicit deliverables. | Made provenance, repeatability and maintainability relevant. | Keep private deployment details out of the repository and don't equate a prepared bundle with a published service. |

## Traceability from theme to evidence

| Theme | Main implementation | Relevant verification |
| --- | --- | --- |
| Situated journeys | `public/planner.js`, `public/streets.js` | Synthetic bus–ferry–train chain, real address searches, direction and connectivity tests |
| Routine with agency | `public/preferences.js`, `public/app.js` | Repeated-search learning, pausing, erasure and new-journey browser tests |
| Independence | `public/sw.js`, `public/worker.js`, `scripts/build_static.py` | Offline reload and new searches; public static/subpath smoke test |
| Calm discovery | `public/index.html`, `public/style.css` | Keyboard flow, limited initial results, progressive detail, responsive screenshots |
| Inclusion | Routing profile, GTFS fields, UI semantics | Unknown-accessibility rejection, barrier/pace tests, axe checks and narrow viewport tests |
| Explainable handover | README, this analysis, course guide, notices | Clean setup instructions, explicit limitations, data/source review |

## Questions for further investigation

- Does a commuter with low vision find the next action more easily in this design?
- Is “Journey preferences” discoverable enough for someone who depends on access filters?
- How should a person distinguish “not accessible” from “accessibility unknown”?
- How much initial download/storage is acceptable on older or low-cost phones?
- Which missed connections result from conservative transfer assumptions, and which
  result from missing paths, inaccurate schedules or incomplete map coverage?
- Does learning from searches provide useful suggestions without learning unwanted
  routines or making someone feel observed?

These require participation and observation beyond the conversation. They cannot
be answered by thematic interpretation or generated code alone.

## Refinement: context as a sequence, not a dashboard

The user's observation that the page was “still visually very busy” is a negative
case for the earlier interpretation of calm discovery: collapsible details alone
did not resolve competition between tasks. Their “wizard almost” suggestion
supports a refined code, **task-contingent visibility**. Version 15 operationalises
this as separate destination, origin, review, route choice and journey-step screens.
This is an implementation hypothesis, not evidence of improved usability. Compare
time to identify the next action, backtracking and preference discovery in task
observation; include people using assistive technology and irregular journeys.

## Refinement: information should be explorable in context

“Certain things should be click-onable to take you deeper” refines progressive
disclosure from hidden panels into connected information. The route-number and
Symonds Street examples give an observable task: inspect where a service goes
without first committing to a journey. The subsequent map request supplies a
spatial representation, while “showing the current context” constrains its scope.
Version 17 links route → direction/branch → stops and map → stop departures,
preserving Back, focus and journey state. Test whether this supports route
understanding; do not equate a plotted shape with confirmed service or access.

## Refinement: make independence and privacy understandable

The user's request to stress independence from the portal, followed by “your data
stays on your device,” makes the architecture a user-facing requirement. Installing
an icon is not evidence of downloaded data, so the guide adds an online preparation
check inside the installed app and an offline reopening test. Browser/platform
instructions explain concrete actions while separating documented paths from
physical validation. Privacy wording names which data stays local and which
optional actions still contact services; it does not promise that online use makes
no network requests. The portal is a distribution channel, not a routing engine.

## Refinement: continuity must respect the trust boundary

The Reality2 question (C20) complicates a simple equation of independence with
one-device isolation. The user wants their own devices to share useful state
when online, while later insisting that personal data stays on the device (C23).
Read together, these suggest control over who receives data, not permission to
upload all journey history to a general service. This is an interpretation to
validate before implementation, not an agreed synchronisation policy.

The [Reality2 proposal](R2_SYNC_DESIGN.md) separates local routing from optional
trusted-device synchronisation. Pairing, revocation, conflicts, deletion and
reconnection would need explicit handling. No synchronisation is implemented;
current local-storage claims must not imply either an existing sync feature or
that a future synced copy could literally remain on only one device. The course
lesson is to keep a promising architectural proposal distinct from delivered and
verified behaviour.

## Refinement: distribution is part of the experience

C21–C23 extend independence beyond the routing engine. A public source repository,
an HTTPS portal, an installed icon and an offline-ready app are different states.
The user's report that the public URL did not work is concrete contrary evidence
to treating repository setup as completed distribution. Likewise, earlier Android
version uncertainty shows why a successful desktop check cannot stand in for the
installed phone experience.

The design response is a working public portal, browser/platform installation
instructions, preparation and offline checks, and clear explanations of local
storage. Instructions cover Chrome, Edge, Brave and Safari on relevant desktop
and mobile platforms; coverage in documentation is not evidence of physical tests
on all of them. The user reported successful journey/offline/touch checks and
desktop keyboard/zoom checks, and later positive feedback on the guided flow.
TalkBack was explicitly not yet tested when the user asked how to use it; later
general approval does not establish a TalkBack result.

An About link in the app's general-information area connects use to source,
instructions and learning material. It makes provenance available in context,
while avoiding another large panel in the journey flow. The course lesson is to
verify the entire path from discovery to installed use and to retain the scope
of each observation when reporting evidence.

## Refinement: public trust needs honest framing and concrete examples

The course-exercise and own-risk request (C24) changes what must be visible before
someone relies on the app. It is not enough to place limitations deep in developer
documentation. The README opening, app notice and Settings now identify the
educational, experimental status and distinguish Along from an official AT
service. This framing informs expectations; it does not substitute for accessible
design, correct implementation or verification.

The screenshot requests (C25) address another part of public understanding. Equal
capture dimensions and paired images filling the reading area make different
states easier to compare. A route drawn over an actual street map demonstrates
spatial context more clearly than markers on a plain background. The captures use
real app states and public example addresses. The map caption explains that the
street background is an optional online layer; downloaded route geometry and
stops are separate, and no live vehicle tracking is shown. A presentation image
must not silently imply a capability the installed offline app does not have.

There is a continuing tension between visible qualification and calm design:
necessary notices can themselves crowd a small screen. The response uses a short
visible notice and deeper explanation in Settings and documentation. Whether this
balance works for different readers remains an observation question. Screenshots
show appearance, not accessibility or successful travel.

## Refinement: keep the original drivers available for future decisions

The request to put the recurring drivers in the initial README (C26) makes
traceability itself a deliverable. The README now states the principles near the
start and links here for evidence and tensions. This account organises the latest
requests within the existing themes rather than treating every message as an
independent feature or inventing a new theme for each implementation change.

For course discussion, compare an implemented change with its original driver:
does a map help answer the current question, does a notice make limitations clear
without dominating the task, and does installation preserve independence? A useful
analysis makes these decisions open to challenge. It should not retrospectively
present every assistant choice as inevitable, or treat the user's positive
feedback as validation of untested claims.

The subsequent request to include the goal details adds a complementary artefact:
the [original nine-part goal](PROJECT_GOAL.md) preserves the delivery contract,
while this analysis explains how requirements acquired meaning through the
conversation. Neither replaces the release evidence. Keeping all three linked
helps a learner distinguish intended outcomes, interpretive rationale and what
has actually been demonstrated.


## Refinement: human agency does not require human code authoring

The explicit no-human-coding rule (C27) sharpens the meaning of an AI coding course.
The human's contribution is directing, evaluating and correcting the intended
experience; the assistant must carry the implementation and technical debugging.
This does not remove human judgment or turn the exercise into unattended generation.
The repeated contextual-design corrections are evidence of active human authorship
of the requirements, even when code is authored by the assistant.

The earlier course guide assumed basic code reading and described implementation
exercises as student work. That was an assistant assumption, not a user requirement.
The revised guide removes that prerequisite and assigns code changes and command
execution to the assistant. Learners describe changes and assess observable results.
Device testing remains a valid human contribution, because physical and spoken
interaction cannot be established by generated code alone.

This rule governs further work. It is not a retrospective audit proving that no
human has ever edited a file: the available conversation is not a complete record
of all filesystem activity. For teaching, retain requests, assistant changes and
verification evidence so the division of work can be examined honestly.


## Negative case: a successful update check did not prove a fresh interface

The later Android report—“it keeps asking, and version remains at 21”—challenges
the earlier update-completion evidence. The test server had disabled HTTP caching;
GitHub Pages allows assets to remain fresh for ten minutes. Repeating the update
test with those cache headers reproduced a new worker storing an old screen in
its offline cache. Checking the worker version alone could therefore report
success while the user still saw an old interface.

The correction requests fresh shell responses and rejects installation when the
cached screen and worker versions disagree. The regression also checks that a
failed installation preserves the previous offline app. This does not establish
what was in the user's phone cache; it supplies a demonstrated failure and a fix
to verify on the device. For the course, the important question is which production
condition a passing test omitted, rather than whether the user pressed the update
button correctly.


The user subsequently replied “that worked nicely” to the version 23 recovery
instructions. This adds real-device acceptance to the reproduced failure and
passing regression. It supports closing that reported update incident, while
leaving the exact browser and unrelated screen-reader checks unconfirmed. The
case now spans reported failure → test-environment correction → implementation
fix → automated verification → user confirmation, with no code changes required
from the human.


## Refinement: distinguish the question from the retained context

The user found “Starting where?” confusing because the step seemed to concern the
destination. Inspection showed that the origin step displayed the selected
destination beneath this short heading. Retaining context alone did not ensure
that its role was clear. The revised wording explicitly asks where the person is
travelling **from**, labels the destination as already selected, and names the
next step on the button. This refines next-action clarity at the level of wording
and information roles, without changing which endpoint the planner uses.

A separate correction matters to evidence quality: after an initial positive
answer to the TalkBack prompt, the user clarified that they had not used TalkBack.
The later explicit correction takes precedence. Conversational acceptance must
not be retained as a passed test when the participant retracts its basis.


The user then clarified that the destination-first ordering had been misunderstood.
The final change keeps that ordering and improves the titles and retained-context
labels; an origin-first redesign was not carried forward. This illustrates why
feedback should be read across the clarification sequence rather than treating
an intermediate interpretation as a settled requirement.


“If I can be confused, so can someone else” confirms that the misunderstanding
remains useful design evidence after the ordering is understood. The response is
to improve the interface's explanation, not dismiss the observation. One person's
experience identifies a plausible issue; broader prevalence still needs testing.


## Refinement: place the explanation where the absence is noticed

The user could not tell why the street background was absent and found its button
underneath easy to miss. Moving the action into the centre of the map connects
the missing visual layer to an explicit next action. The short internet note
explains the condition without adding another panel. The privacy/offline choice
remains intact: the app still waits for a request before contacting OpenStreetMap.
This extends contextual affordance from choosing a task to explaining an optional
part of the current view.


## Refinement: useful secondary actions still need to be discoverable

The request to move “Save this journey” higher and make it more prominent shows
that progressive disclosure must not make a useful action feel absent. Saving
now appears beside the step count at the top of the selected journey, with a
clear button boundary and saved-state text. The current travel instruction and
Next step remain the main task. This balances remembering a future routine with
following the present journey, rather than making every action equally dominant.


## Refinement: saving should preserve the choice the person made

The question about whether saving kept only endpoints revealed a mismatch between
the implemented record and the meaning of “this journey”. The user asked to retain
chosen bus/train numbers. Saving now records an ordered service preference and
replans its departures when reopened, with explicit fallback and an unrestricted
comparison action. This extends routine learning with deliberate choice; it does
not equate a remembered preference with a promise that a particular trip operates.

## Refinement: familiar visual language must not overstate freshness

A departure-board appearance was requested for stop times, followed immediately
by the requirement to distinguish scheduled times from live ones and link to AT.
The combined design uses aligned time/route/destination columns, readable contrast
and a prominent scheduled-only caption. A live-tracking information link is a
separate online action. Familiar appearance helps recognition, but must not imply
live operational data that the displayed table does not contain.


The next clarification identified a second ambiguity: a save control after route
selection could imply preserving the exact dated itinerary. The final design
separates **Save these places** before route selection from **Prefer these
services** afterwards. Service preferences are optional, and neither action saves
an old departure time. This distinction reconciles saving general endpoints with
the earlier request to remember chosen service numbers, rather than replacing one
requirement with the other.


### Acknowledgement should release space for the next action

The user's Samsung S23 feedback identified a repeated small scroll to reach the
next action. They proposed moving the course warning away after pressing
“Understood”. Version 28 retains the first-use notice, remembers acknowledgement
on the device and moves it into an expandable footer item. Settings retains the
full explanation. This extends progressive disclosure to introductory material:
keep it available without repeatedly competing with the current task. Mobile
review spacing is also reduced without shrinking touch targets or text.

The user's general positive report for version 27 is not evidence that every
individual release check, particularly Android TalkBack, was completed.

The user also identified a mismatch between the installed icon and the header
mark. Reusing the installed icon makes recognition consistent across entry points.


### Language inclusion needs both technical and linguistic evidence

The user asked whether an English / Māori switch could be offered confidently,
then explicitly added it to the goal. The agreed distinction is between confidence
in implementing a local, offline language switch and confidence in idiomatic,
accurate public-facing te reo Māori. Fluent-speaker review is a completion gate;
AI-written translations remain draft until reviewed. This extends inclusion beyond
visual and motor access, and reinforces the course's division of responsibility:
the AI implements and tests; people contribute domain knowledge and judgment.


The user subsequently requested an explicit AI-translation disclaimer. Both the
language settings and the Māori-mode notice state that the translation was
generated by AI, may contain mistakes and has not received fluent-speaker review.
This makes provenance and uncertainty visible alongside the language choice.


### Online information enriches an independent offline app

After obtaining AT credentials, the user stressed that online information should
optionally improve an already useful offline tool. This extends the independence
and agency themes: connection adds freshness, not permission to function. Copy
and behaviour must distinguish downloaded schedules from live observations, keep
choice with the commuter and preserve planning when connections fail. Credential
availability is separate from deployment and from matching every live trip.


The user further required online information to be completely contextual. The
recurring next-action principle therefore applies to live data as well as layout:
a successful feed request is not enough. Relevance to the current stop, journey or
leg must be established before showing a prediction or alert. Wider network
information is a deliberate exploration path, not a competing default feed.


### Feedback closes the loop between use and AI development

The user requested a contextual feedback button whose typed observations reach
the GitHub repository for the next AI development round. This extends the
iterative design process beyond the original chat. Feedback should be available
at the point of difficulty while keeping travel primary. Public submission must
remain an informed user action, distinct from the app's private local history.

## Language preview and feedback loop (23 September 2026)

The request for contextual feedback extends progressive disclosure into product
development: a person should be able to report a problem from its context, while
reviewing what becomes public. The next development round must inspect repository
feedback, rather than treating a submission button as the complete feedback loop.

“When can I test the maori language version?” followed by permission to publish
while the audience is small shifts the immediate release priority to an honest,
usable draft. This supports iterative evaluation without implying linguistic
validation. The implementation must preserve explicit AI-translation warnings,
English fallbacks and the outstanding fluent-speaker review requirement. Human
participation remains testing and ordinary-language feedback, not coding.

## Feedback delivery as an observable outcome

The contextual feedback requirement distinguishes composing a message, opening
an external service, submitting it and verifying receipt. The implementation
keeps these states separate. A synthetic issue established real repository
acceptance and anonymous browser receipt verification; authenticated CLI
submission was recorded explicitly, rather than claimed as evidence for GitHub's
interactive sign-in flow. This is a course example of matching a completion claim
to the exact boundary exercised by a test.

Privacy here means an informed exception: journey calculations stay local, while
a person may deliberately share a reviewed public report. Optional context is
limited to version, language and screen category. Neither useful context nor a
feedback button justifies automatic address/history collection.

## Withdrawing an unreviewed translation

After trying the language direction, the user said they were not comfortable
including Māori translations and requested removal of the selector. This changes
the active requirement: technical availability and disclaimer text do not imply
acceptance. Version 31 returns to English throughout and ignores saved Māori
choices. The goal records translation as deferred, while preserving official
place names and the historical draft for possible future review.

### Visible actions and discoverable feedback (23 September 2026)

The user observed that feedback was hidden inside journey notes and that actions
such as “Compare nearby departures instead” resembled ordinary text. This refines
the recurring theme of clear affordances: progressive disclosure must not hide
feedback or make available actions ambiguous. Version 32 moves feedback outside
the disclosure and gives secondary actions consistent outlines, while preserving
the filled primary travel action. Touch users need these cues before any hover.

### One clear disclosure boundary

After the outlined-action revision, the user identified that a control inside
another single-purpose card looked awkward. They also asked for the notice label
to read “Use at your own risk”, with the course explanation revealed on opening.
Version 33 removes redundant disclosure containers and shortens this label. The
refinement balances recognisable actions with calm presentation: extra borders
can add visual complexity without conveying another meaningful interaction.

### Full-width actions, map control and immediate purpose

The user preferred full-width buttons, requested a full-screen map and centring
on current location, and asked for Auckland public transport to be named on the
main page. Version 34 applies full width to standalone actions while retaining
compact navigation and inline route controls. Maps expand within the app window,
with close, Escape and history Back restoring the detail. Location is requested
only on the centring action, with an accuracy circle and a recoverable permission
failure. The home brand now states “Auckland public transport” without replacing
the destination question. These changes connect clear purpose with control over
how much space the current task receives.

The follow-up observation that “Plan a journey” was redundant removed that home
screen progress label and its empty navigation space. Back and step context
remain available once the traveller begins choosing a journey.

### Icon meaning can differ from design intent

The user noticed that Along's loop-and-arrow icon resembles the male gender
symbol. Visual inspection supported that reading. A path connecting two stops
was suggested as a clearer travel metaphor. The user subsequently asked for that
redesign; version 35 replaces the arrow with a curved connection between two stop
rings, retaining the established green palette.
This is another example of user interpretation revealing ambiguity that technical
checks and the designer's intended meaning do not resolve.

### Independence includes the live-data connection

When the AI proposed a separate proxy to protect a shared API key, the user asked
whether that backend could run in browser WASM, then clarified that Along should
need no central server except the original information provider. The earlier
implementation protected the key but introduced an operational dependency that
conflicted with the intended autonomy. A direct AT preflight and authenticated
request succeeded, changing the next design question from hosting to personal
credential handling. Subsequent authenticated browser checks verified access to
the feeds, and the user explicitly approved developing the missing browser TG
capability. The complete credential experience remains unfinished. This illustrates why satisfying a security
constraint is not sufficient evidence of alignment with the product's core drivers.

### Provider evidence changes implementation assumptions

Direct browser access succeeded, but exercising the actual adapter against AT's
feed revealed a JSON-shape difference missed by synthetic tests: a single stop
update was an object rather than a list. The adapter was corrected at the provider
boundary, with strict identity matching retained. The subsequent snapshot matched
1,203 departure predictions and 992 vehicle positions, while retaining explicit
unmatched outcomes. For the course, this distinguishes three separate claims:
network access works, provider data reaches matching correctly, and the finished
credential/UI experience works. Evidence for one is not evidence for all three.

### Trust is a lifecycle, not a storage setting

**Observation:** the user proposed that each person obtain their own AT key and
keep it in their trust group, then chose to develop the missing TG capability.
This extends C20, C23 and C28: the same device independence sought for journeys
also applies to authority over online access. C30 records the explicit scope
change; repeated requests to continue do not constitute separate requirements.

**Interpretation:** “safe in my TG” includes what happens when a browser restarts,
an invitation is declined, two tabs act at once, a device leaves the group, or a
provider key is replaced. Storing a nonextractable signing key addresses one
part of that lifecycle. It does not establish secure credential sharing, complete
enrollment, or hardware-rooted protection. A competing interpretation would treat
TG as merely a convenient login label; the user's emphasis on local ownership
and no central backend makes that interpretation insufficient for this project.

**Implementation response and its limits:** the development branch has browser
checks for durable identity, atomic records, signed membership evidence,
revocation, invitation use and connection-bound comparison. Tests use synthetic
material; direct-channel tests stop their asset server before exchanging messages.
These observations support specific mechanisms, not a finished trusted-device
experience. Signaling in those tests comes from the harness. Physical reachability,
accessible person confirmation, initial trust, credential custody and rotation
still need implementation or verification. The public app remains offline-first
and does not expose these unfinished mechanisms as live AT support.

**Reflexive check:** the AI both built the mechanisms and described their evidence.
That dual role can turn a sequence of successful component tests into an inflated
completion claim. In this iteration, a full runtime gate passed after source had
changed during its run. A fresh run against a recorded, unchanged snapshot was
therefore required. Likewise, a linked-worktree hook-path assumption was diagnosed
and a supported full clone used; the checker was not bypassed. These are evidence
about the development process, not additional user quotations or independent
usability observations.

**Course lesson:** preserve the original outcome while exposing the steps still
between a demonstration and it. Ask what an attacker, a second tab, a restart or
a mistaken user action could change. Also ask what the test never exercised.
Neither the number of passing tests nor architectural complexity answers whether
a commuter can safely connect, remove and recover their actual devices. The
human still directs those acceptance criteria without being asked to write code.

### An existing app is evidence, not automatic compatibility

**Observation:** the user redirected the R2 work toward Notekeeper (C31).
The source inspection found browser WASM, invitation links/QR codes, local
persistence and a configurable relay. Its own repository guidance describes an
intentionally simplified application of R2. The inspection is recorded in
[the integration notes](REALITY2_INTEGRATION.md#notekeeper-reference-inspection).

**Interpretation:** this is a request to learn from working precedent, consistent
with the user's repeated preference for practical, understandable interaction.
It does not explicitly withdraw C28's server-independence requirement or establish
that Notekeeper's trust groups interoperate with the newer runtime. An alternative
reading—copy Notekeeper wholesale—would silently inherit a relay dependency and
storage choices the user did not explicitly approve for credentials.

**Response and limits:** retain the invitation and optional device-connection
patterns while checking actual transport, storage and authentication boundaries.
The subsequent experimental comparison screen now receives its code from a real
peer exchange; automated button and keyboard actions exercise confirmation and
cancellation. That demonstrates UI/runtime wiring, not observed human co-presence
or successful persona installation. A delayed-timeout test failed before a
use-time expiry check was added, illustrating how another question can change
the evidence even after normal-path tests pass. The AI authored these tests;
they are not additional user feedback or independent security review.


### Completion has several observable stages

**Development observation, not a new user statement:** subsequent implementation
checks distinguish a committed local identity, the provisioning device's saved
receipt, the candidate's saved acknowledgment, and a later authenticated connection.
Fault injection shows that these can diverge: one device may commit while its
peer cannot save or deliver acknowledgment. A fresh document restores the saved
result; a signed local revocation blocks subsequent use. These are AI-authored
experiments, not physical-device acceptance or independent review.

**Interpretation:** C20/C23's local ownership and C28's server independence require
honest partial outcomes. The interface must neither imply that cancellation undid
a completed save nor describe a remembered acknowledgment as present connectivity.
This extends the earlier lifecycle theme without treating each successful test
as another user requirement. An alternative interpretation would collapse all
stages into “paired”; that label hides the recovery action the person needs next.

**Reflexive limit:** extensive infrastructure work can displace the commuter's
actual task. Component completion must therefore be checked against the original
outcome: optional contextual AT information, accessible device connection and
continued offline planning without human coding. The current public app has not
received TG credential access. Interrupted-receipt recovery now has browser
evidence, including a fresh document and refusal to overwrite a newer record.
First-use identity and its local setup screen now have local browser evidence;
the matching runtime increment passed its full local gate. Usable
discovery, issuer custody across restarts and application-secret access remain
gaps; these component advances do not establish the end-user outcome.


### Local ownership includes refusing silent replacement

**Development observation, not an additional participant quotation:** first-use
work distinguishes creating an identity now, restoring its member key, and having
issuer custody available. Tests exercise unreadable storage, missing claims,
concurrent tabs and cancellation on either side of a storage commit. The setup
screen requires an explicit local action; it does not offer identity replacement
when prior data exists or cannot be read. Its browser checks cover keyboard
activation, focus after saving, Back/Escape, narrow enlarged text and automated
accessibility findings. They do not substitute for TalkBack or disabled-commuter
observations.

**Interpretation:** the privacy and ownership theme concerns continuity as well
as where bytes are stored. Silently creating a new identity after a read failure
would keep the data local yet sever the person's relationship with other devices.
The calm-design theme therefore supports a short explanation and a recoverable
next action rather than a reassuring but inaccurate success label. A missing
store can mean first use or deleted browser data; without external evidence the
app cannot distinguish those histories.

**Alternative reading and limit:** automatically repairing missing state could
reduce setup friction. That reading is attractive for a travel app, but cannot
justify replacing an established identity or claiming that a member key proves
issuer authority. The current implementation preserves member custody and
reports issuer custody unavailable after reopening; a seamless, durable TG
experience still requires that outstanding lifecycle work. The AI must complete
it before treating the primitive as delivery of the user's goal. No human code
contribution is required by this exercise or by the implementation process.

### A reference framework can change the product's prerequisites

**Development observation:** after implementing encrypted AT storage, policy
updates, receipt recovery and owner controls, a focused source inspection found
that durable issuer custody was still absent. The peer test created its issuer as
a fixture. The inspected standard requires hardware-rooted sealing for persistent
group keys, while the browser adapter establishes only software custody. These
are implementation findings, not participant acceptance or an independent audit.

**Interpretation:** the user's request to use Reality2 “or at least some part of
it” leaves room for an explicitly scoped subset, while the request for a portable
browser app constrains dependency choices. Treating complete framework conformance
as an unstated requirement can displace the actual commuter outcome. Treating
software encryption as hardware protection would instead overstate the evidence.
The relevant design choice has been put to the user: browser-only storage with
stated limits, or a qualifying native/hardware component. No answer is inferred.

**Reflexive lesson:** test foundations before polishing dependent screens. The
recent tests do establish local access decisions, cancellation and recovery; they
do not replace a real issuer, device enrollment or practical connectivity. For a
course exercise, ask learners to trace one end-to-end user task, mark each fixture,
and identify which assumptions prevent deployment. Assessment should reward
finding and resolving that dependency, rather than counting passing component
tests or commits. The AI remains responsible for all coding.


### Resolving the browser custody choice

The participant selected “Browser-only R2 subset, with explicit security limits.”
This resolves the previously recorded architecture question without changing the
requirements for local data, offline journeys or no human coding. The subsequent
implementation stores an encrypted software issuer and verifies restoration with
actual signing; it does not establish hardware protection. The peer test now
uses that issuer and actual acknowledged recipient enrollment. The harness still
supplies initial trust review, comparison decisions and connection signaling. This illustrates
requirements negotiation: an explicit user choice narrows framework conformance,
not the intended usable cross-device experience. It is not evidence of independent
security review or physical-device acceptance.

### Development evidence: completion messages must follow durable outcomes

The interrupted-pairing test exposed a gap between atomic storage and the visible
message: a connection could end after membership committed but before the UI's
local flag changed. The old failure message then suggested a fresh invitation.
The correction waits for the pending write result and distinguishes local
installation from received confirmation. This is development evidence supporting
the existing themes of contextual next actions and honest state reporting; it is
not a new participant statement or physical-device acceptance.

For the course, ask learners which event establishes each claimed outcome and
whether an error can arrive after success became durable. A passing storage test
alone does not prove that recovery advice is correct. The AI wrote both the repair
and the delayed-completion regression; the human did not need to edit code.


### Licensing the selected framework subset

The participant directed that the R2 part used by Along should use the same
licence as Along (MIT). This resolves the requested product choice while retaining
the scope boundary: the wider standard and third-party dependencies are not being
relicensed. It extends the themes of reusable course outputs and selective
framework adoption. Implementation evidence must still include the exact source
scope, retained attribution and bundled notices; a licence choice alone is not a
completed distribution audit. No human coding is required.


### Development evidence: test the assembled commuter workflow

The shared-key integration check now runs two isolated browser profiles through
the generated app, after actual enrollment and encrypted credential delivery.
It connects through Settings, closes the dialogs, plans an address-to-address
bus/ferry journey and requests contextual information. It also checks that a
withheld removal prevents further provider requests and that offline planning
survives disconnection and reload. This supports the themes of offline autonomy,
contextual information and preserving the commuter's current task.

The limits belong beside the result: first-use grant/consent and removal still
use harness calls, AT responses are mocked, and both profiles run on one host.
For the course, distinguish this evidence from component tests, a fully composed
setup experience, physical-device usability and provider acceptance. Passing one
does not establish the others. This is new development evidence, not a new user
acceptance report; the human still performs no coding.

The next increment replaced the two-profile test's initial grant and consent
harness calls with visible controls in the experimental device lab. This changes
the evidence: owner grant, recipient device review and consent, encrypted receipt,
and owner acknowledgment are now exercised as a composed interaction. The
remaining manual descriptor transfer, one-host execution and mocked provider
limits still apply. Interrupted sharing recovery is a separate unfinished path;
the successful path does not establish it. This illustrates how a course can
track increasing integration coverage without relabeling every passing test as
release acceptance.


A later interruption check drops the real key-delivery confirmation after the
recipient has saved its key. Recovery now distinguishes the recipient sending
its saved receipt from the owner verifying and saving confirmation. The two-profile
test checks unchanged ciphertext and permission revisions, rather than inferring
preservation from a success message. This extends the theme that visible outcomes
must follow durable evidence. It still establishes a browser test with synthetic
credentials, not physical-device or live-provider acceptance.

The setup flow subsequently moved into the experimental journey app's Settings.
The same visible identity, enrollment, key consent and receipt-recovery controls
now run over the commuter's current task. The single-profile check preserves a
partially entered address through setup; two-profile checks cover sharing and
lost-confirmation recovery before returning to journey use. The design keeps
advanced enrollment/recovery choices behind a disclosure and retains a way back
while optional storage/runtime work is pending. This advances progressive
disclosure and task continuity without establishing physical-device acceptance
or changing the still-scheduled public release.

Browser-history testing exposed another task-continuity requirement: disposing
optional device resources when leaving a page must allow them to be restored
when Back revives the same document. The experimental app now preserves the
selected journey and remounts Settings in that case. A real Chromium cache return
is checked separately from simulated lifecycle events. The shared-device reload
test also exposed a click arriving before the journey handlers were installed;
optional credential restoration now runs in the background instead of delaying
those handlers. A stalled-WASM check verifies readiness at DOMContentLoaded.

For the course, this illustrates why a test must distinguish a cached document
from a fresh reload, and why optional services should not delay basic navigation.
It is implementation evidence extending the offline-autonomy and contextual-task
themes, not a new participant observation or physical-device acceptance report.
