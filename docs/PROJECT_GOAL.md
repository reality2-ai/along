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
Reality2 remains a [proposal](R2_SYNC_DESIGN.md), not an implemented feature.

Use the [release evidence and remaining gates](RELEASE_CHECKLIST.md) to audit each
numbered requirement against implementation, automated checks and user device
observations. The goal is not yet fully verified: spoken screen-reader checks and
physical checks of the latest contextual details remain outstanding. An AT key
is needed to verify the optional authenticated live-data integration. Documented
limits and an educational disclaimer do not count as passing these checks.


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
