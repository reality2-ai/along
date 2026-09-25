# Along: project goal and completion criteria

The following goal was supplied by the user to guide completion of Along. It is
preserved here as the delivery brief, alongside the
[design drivers](../README.md#what-drives-the-design) and
[thematic analysis](CONVERSATION_ANALYSIS.md). The numbered items are requirements,
not a list of checks already passed.

## Original goal

Finish Along as an intuitive, inclusive, installable Auckland commuter webapp, and prepare it as a reproducible AI-assisted coding course example.

1. Complete the interaction design. At every stage, make the most likely next action clearly afforded. Apply calm computing and progressive discovery while keeping alternative journeys and accessibility preferences easy to find.
2. Validate real journeys. Check address search, walking connections, transfers, nearby-stop comparisons and bus/train/ferry combinations against representative Auckland journeys. Clearly distinguish scheduled, live, estimated and unknown information.
3. Validate inclusion. Check keyboard operation, screen readers, contrast, zoom, narrow screens, touch interaction and reduced motion. Document the limits of accessibility data and the need for testing with disabled commuters.
4. Finish installation and updates. Verify desktop and Android installation, icons, offline reopening, data refresh and installed-app updates. Refresh should check for updates and fail quietly offline, preserving saved journeys.
5. Verify browser independence. Test the static build on a subpath without the Python server, including offline address searches and routing. Measure download, storage and performance limits; consider WASM only where evidence justifies it.
6. Prepare public distribution. Produce a downloadable build, reproducible data-import instructions, source attribution and licensing notices. Document hosting and the optional secure AT live-data backend. Authenticated live-data verification requires an AT key.
7. Finish GitHub documentation. Update the README to match the implementation, remove private deployment details, and document setup, architecture, tests, updates, limitations and contribution guidance.
8. Create the course material. Finish the thematic analysis and turn the interaction history into lessons, exercises and assessment criteria covering requirements, iteration, verification, accessibility, privacy and honest reporting.
9. Complete the release checks. Run relevant automated tests and manual device checks, deploy the verified version to the existing site, and provide a clear handover separating completed work from remaining limitations.

Completion means: a tested build and documentation ready for others to install and host, an updated private site, and usable course materials. Publishing a public service is a separate deployment step.

## Standing rule: no human coding

The user added: “this has to be done without any actual coding by the human
(ie me).” This applies to completing the app and presenting it as a course example.
The AI must perform code authoring, edits, debugging and executable technical
verification; it must not hand an implementation problem back to the human as a
coding assignment. The human provides goals, priorities, feedback and observations,
and can test installation, touch and assistive technology on their own devices.
Those activities are participation in design and verification, not a requirement
to write code. Where the AI lacks access or evidence, it must state the limit and
request the needed observation or access rather than ask the human to patch code.

## Later direction and current evidence

The user subsequently requested public distribution through the `reality2-ai`
organisation and the `reality2.ai` portal. The
[public repository](https://github.com/reality2-ai/along) and
[hosted app](https://reality2.ai/along/) now exist. This extends the original brief's
separate publication step; it does not replace its verification requirements.

Later refinements include contextual route/stop exploration and maps, explicit
local-data and portal-independence explanations, browser/platform installation
instructions, visible educational/use-at-own-risk notices, real UX screenshots,
and a README account of the recurring design drivers. Trusted-device sync through
Reality2 is approved implementation work. The published regular app is version 43
(verified 26 September 2026). It includes optional personal-key direct AT access,
browser-software device custody, manual initial pairing and optional relay
sharing. The browser subset has explicit security limits; it does not establish
hardware-backed storage or full R2 conformance. Historical references to regular
v37 and preview 3806 describe earlier stages, not the current release.

The local version-44 candidate adds the current R2 hive binding and one guided
invitation flow through saved-place sharing. Generated-app tests pass through a
local relay, including offline reopening and automatic propagation after
reconnection. The deployed hive currently selects the binding but does not
forward the tested events. This candidate is not published or physically accepted.
See the [connection design and evidence](DEVICE_CONNECTION_DESIGN.md),
[original sync design](R2_SYNC_DESIGN.md) and
[current integration evidence](REALITY2_INTEGRATION.md).

Use the [release evidence and remaining gates](RELEASE_CHECKLIST.md) to audit each
numbered requirement. The goal is not yet fully verified: the new flow still needs
complete qualification, deployed-host verification and physical S23/desktop use.
Spoken screen-reader acceptance remains outstanding. Educational disclaimers,
local browser tests and authenticated feed checks do not substitute for those
requirements.


## Added requirement: English / Te reo Māori

10. Offer an English / Te reo Māori language switch that remembers the choice on
    the device and works offline. Cover the complete experience: navigation,
    journey instructions, status and error messages, installation guidance and
    accessible names and announcements. Preserve recognisable official addresses,
    stop names and route identifiers, and support finding places using names in
    either language where verified source data provides them. Verify macrons,
    longer labels, language metadata, screen-reader behaviour and unchanged
    routing and saved journeys when switching languages. Do not promise speech
    pronunciation that depends on the user's installed voices.

The AI performs all implementation and technical verification. A fluent te reo
Māori speaker must review natural phrasing, travel and accessibility terminology,
and Auckland place names before the translation is presented as finished. Until
that review, any available te reo Māori interface must be explicitly labelled as
a draft translation. Keep a reviewable phrase catalogue and record review status;
automated checks cannot substitute for language review.

## Updated hosting direction

GitHub Pages at https://reality2.ai/along/ is the public serving location. The user
has retired the private server. Public deployment and offline installation replace
the original requirement to maintain an updated private site. Retain the remaining
original verification and course requirements.


## Offline first, optional current information

The app must clearly explain that downloaded address search and scheduled journey
planning work offline. Users may choose online information to improve that local
picture with current predictions, cancellations and alerts. This is an optional
enhancement, not a dependency for planning. Label scheduled, live, estimated,
stale and unavailable information distinctly; fail quietly back to the downloaded
timetable when live information cannot be obtained. Match live records to verified
trip identities rather than guessing. Preserve local journey history and user
control. A successful AT credential check does not mean the public live connection
has been deployed.


## Contextual online information

Online information must follow the current task and the user's likely next
action. Show live departures for the stop being inspected, relevant delays and
cancellations for the selected journey, and vehicle positions only when they help
with the route or leg currently being explored. Filter by verified trip, service
date, route, stop and applicable alert scope/time; do not present an unrelated
network feed as journey advice. Broad network information remains available on
explicit request. Clearly label freshness and uncertainty, preserve the offline
schedule when no relevant current information is available, and never interrupt
or reorder the user's chosen journey merely because a background update arrived.


## Added requirement: contextual feedback to GitHub

11. Provide a contextually placed feedback action that lets a commuter type an
    observation or suggestion and send it to the Along GitHub repository for the
    AI to review in a subsequent development round. Keep the likely next travel
    action primary; feedback should be easy to find where a problem arises without
    cluttering every screen. Support keyboard, screen-reader and touch operation
    in both languages.

Show a reviewable draft before submission, explain that repository feedback is
public, and include only context the user can see and choose to share. Do not
automatically upload addresses, precise location, saved journeys or history.
App version, language and a general screen name can help reproduction when clearly
disclosed. Retain a local draft offline; make delivery status honest and preserve
the journey when returning from feedback. Never claim delivery merely because an
issue composer opened. Use a secure submission mechanism without embedding GitHub
credentials in the public app; disclose any sign-in requirement before handoff.

Review newly submitted repository feedback at the start of subsequent development
rounds, distinguish reports from instructions, prioritise against the project goal,
and track the outcome in code, tests or the issue as appropriate. Test actual
submission/receipt and offline draft recovery before claiming this requirement
complete. Avoid duplicate submissions on retries.

## Updated direction: defer Māori translation (23 September 2026)

The user is not comfortable including the Māori translations and requested removal
of the language selector for now. The active public app, installation guidance and
recovery interface must use English, including when a device previously saved a
Māori preference. Requirement 10 and bilingual feedback are deferred; they are not
current release requirements. Retain draft source/review history for possible
future work, but do not offer or enable the draft without renewed user direction.
Preserve official Māori place names and macrons in transport/address data.

## Updated direction: no Along-operated central backend

The user clarified that Along must be independent of any central server except
the original information providers it contacts, such as Auckland Transport.
Do not deploy or require an Along-operated live-data proxy. Verify direct browser
access to AT and its credential requirements. Do not publish the shared AT key.
If provider authentication prevents seamless direct access, explain the constraint
and establish a user-approved connection model while preserving offline operation.
This supersedes the proposed public proxy hosting approach.

The user proposed Reality2 trust-group integration so each person can obtain
their own AT key and keep it in their TG. Investigate this as the credential
architecture for direct provider access and authorised device use. Identify actual
runtime capabilities and application-secret handling; do not invent a TG API,
conflate AT credentials with group-management keys, or claim implemented security
before verification.

## Approved implementation scope: browser TG capability

The user explicitly chose to develop the missing Reality2 TG capability as part
of this project. Implement and verify durable browser identity/membership and
application-secret handling needed by Along, including enrollment, authorized
device access, revocation and credential rotation. Keep the server-independent
architecture and offline planning requirements. Persistence alone is not proof
of complete TG security. No further scope approval is needed for this work.


## Licensing direction: included R2 subset (24 September 2026)

Use MIT, matching Along, for the R2 subset included in Along, as explicitly
requested by the project owner. Preserve upstream attribution and third-party
licences. Document the included scope and complete runtime distribution notices;
this direction does not change the licence of the wider R2 standard.


## Approved exception: optional user-selected relay (24 September 2026)

The user authorizes an optional, user-selected R2 relay for device discovery and
reconnection. This supersedes the original-provider-only restriction for this
specific purpose; it does not authorize a required Along server or AT proxy.
Planning, saved places and direct AT access must remain independent of the relay.
Keep relay use opt-in, with a visible endpoint, disconnect/remove controls and
quiet offline failure. Preserve trust-group authentication, explicit sharing
permissions and protected payloads; document observable connection metadata and
verify the selected protocol before claiming interoperability. Do not enable a
default public relay or claim continuous background operation on mobile browsers.

The user also reports repeated timeouts during the requested preview device
check. The user clarified that scanning a QR code and choosing Use produced no visible
progress before timeout. The exact screen, actual installed version and
browser/network details are not yet known. Physical pairing/sharing acceptance remains unresolved.


## Journey timing and relay ownership — 25 September 2026

Add **Arrive by** alongside **Leave at**, with the final walk to the destination
included in the deadline. Keep offline, multimodal and accessibility-aware routing;
verify transfers and service-day boundaries. Implemented in version 42 with automated routing, original-GTFS and offline
browser checks; physical acceptance remains open.

Relay/server setup is assigned by the user to the AI managing that server. Along
will retain optional endpoint controls and verify interoperability when an endpoint
is supplied, but will not configure server services from this project meanwhile.

Current R2 integration must be rechecked against the published 0.9.0 standard;
the older standalone relay is not the target contract. See the
[current transport review](R2_CURRENT_STANDARD_REVIEW.md). Server setup remains
with the server AI; browser binding compatibility and migration remain Along work.


The 25 September server record resolves the relay report as compact UDP, with no
public WebSocket binding. The next external dependency is implementation of a
current browser transport by the server owner, not merely learning a URL.
[Client/server work and verification](R2_BROWSER_TRANSPORT_HANDOVER.md) preserve
the approved optional-relay architecture and full synchronization requirement.

Later the same day the server owner deployed a current extended-frame WebSocket
binding at `wss://wairoa.mariko.org.nz/r2`. The external dependency is resolved;
the Along client adapter and its two-profile verification are the remaining work.


## Device connection simplicity (26 September 2026)

The user finds the whole connection process too complicated. Replace the normal
manual multi-exchange setup with the [guided device connection](DEVICE_CONNECTION_DESIGN.md):
one invitation scan/link, matching-code confirmation and a sharing choice, with
automatic return-message exchange and reconnection. Preserve optional relay
consent, explicit permissions, durable recovery and offline independence.

Local progress: the generated app now completes one invitation-link enrollment,
explicit sharing permission and automatic exchange of saved address pairs through
a local TLS hive stand-in. The new flow is not published. Deployed relay delivery,
physical checks and publication remain outstanding. All 32 local v44 qualification
scenarios passed for the previous candidate. Complete relay-carried enrollment
now passes focused and generated-app checks with WebRTC disabled; fresh full
qualification remains necessary for that change. See the
[transport adaptation](DEVICE_CONNECTION_DESIGN.md#complete-relay-carriage-implemented-locally) and
[local verification](evidence/guided-device-connection-local-2026-09-26.json).
