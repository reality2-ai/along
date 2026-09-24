<h1><img src="public/icons/icon-192.png" width="48" height="48" alt="" align="absmiddle"> Along — your Auckland commute</h1>

> **Course exercise — use at your own risk.** Along was created as an exercise
> for an AI-assisted coding course. It is an experimental educational webapp,
> not an official Auckland Transport service. Routes, times, walking directions
> and accessibility information may be incomplete, outdated or incorrect.
> Check your journey and access requirements with AT before travelling.

An independent, installable webapp for finding a useful next ride and planning
street-address-to-street-address journeys across walking, buses, trains and ferries.
After the first download, address search and scheduled routing run in your browser,
including offline. **Once prepared, Along does not need the web portal to operate.**
**Your searches and learning history stay on your device.** Saved places and
service preferences can be shared with devices you explicitly permit. No account
or uploaded journey history is needed.

Along uses Auckland Transport's public data and its own bounded routing engine.
It is **not an official AT app** and does not reproduce AT Mobile's journey planner.
**Offline planning is the foundation; live information is an optional addition.**
When connected, current AT predictions and alerts can help refine the scheduled
picture. Version **42** includes optional direct AT access using your own API key,
plus device pairing and saved-journey sharing. A user-selected relay can reconnect
permitted devices while Along is open; none is enabled by default. Losing
connectivity will not remove offline planning. Choose **Leave at** or **Arrive by**,
including the walk to your destination. Open a saved shortcut to remove it directly
from the journey-options screen.

<p align="center">
  <a href="https://reality2.ai/along/"><img src="docs/images/open-webapp.svg" width="304" height="56" alt="Open and install Along webapp"></a>
</p>
<p align="center">Open in your browser and install on your device. Prepare it online, then plan scheduled journeys offline.</p>

**Device testing:** use the regular **version 42** app above and follow the
[short S23/desktop guide](docs/DEVICE_CHECK.md). Physical pairing, TalkBack and
external-relay acceptance remain unverified. [Download version 42 to host yourself](https://github.com/reality2-ai/along/releases/tag/v0.42.0)
or read the [release evidence](docs/RELEASE_V42.md).

The separate [Device Preview 3806](https://reality2.ai/along/preview/public/) remains
available with its [preview guide](docs/PREVIEW_DEVICE_CHECK.md). Its saved places
and device setup remain separate; use dummy AT keys for preview tests.

The interface is English-only. The unreviewed Māori translation and language
selector have been withdrawn for now; official place names retain their spelling
and macrons. Earlier saved language choices do not re-enable the draft.

**Feedback:** use **Give feedback on this screen** in Settings, route/stop details
or directly on journey and nearby-departure screens. Drafts stay local, including offline. You review the
text before opening GitHub, where an account and **Submit new issue** are required.
Submitted feedback is public. No journey details are attached automatically;
app version, language and a general screen category are optional. Paste the issue
link back into Along to verify receipt. [How feedback works](docs/FEEDBACK.md).

## What drives the design

These principles come from the original brief and the user's repeated feedback
throughout development. They are the criteria for judging changes, not a claim
that every need has already been met.

- **Help with the situation at hand.** Make Auckland journeys intuitive using AT
  data: compare useful departures across nearby stops and lines, and plan from
  street address to street address across walking, bus, train and ferry.
- **Make the likely next action clearest.** Let the current task determine what is
  shown, almost like a wizard. Anticipate a useful next step without taking control
  or hiding alternatives.
- **Keep interaction calm and grounded in experience.** Apply calm computing,
  experiential cognition and progressive discovery: favour recognisable places,
  routes and actions over a busy dashboard. Reveal detail when it becomes useful.
- **Let people explore and return.** Make routes, vehicle/service numbers and stops
  entry points to paths, times and relevant maps—such as checking whether a service
  goes down Symonds Street. Back should preserve the journey and its context.
- **Learn routines while allowing something different.** Reduce repeated input,
  keep new journeys easy, and let people pause or erase learning.
- **Design for people with varied disabilities.** Support different ways of seeing,
  understanding and operating the interface, alongside walking and access needs.
  Keep unknown accessibility explicit and validate with people and assistive tools.
- **Work independently after preparation.** Support installed desktop and home-screen
  use, offline address search and routing, a recognisable icon and reliable reopening.
  Check for updates on refresh; when offline, fail quietly. The portal distributes
  the app, but is not required for downloaded routing to work.
- **Keep personal data under the person's control.** Searches, saved journeys and
  preferences stay on the device unless shared with explicitly permitted devices.
  Optional device sharing preserves local offline operation.
- **Require no coding by the human.** The human supplies intentions, constraints,
  feedback and real-device observations. The AI writes and changes the code, runs
  technical checks and resolves implementation problems. The course follows this
  same rule; programming knowledge is not a prerequisite.
- **Make the result reusable and the process teachable.** Provide public source,
  clear installation instructions across browsers and platforms, honest screenshots,
  and an account of decisions and corrections. This is a course exercise used at
  the user's own risk, with limitations visible in both the app and repository.

Read the [thematic analysis of this design conversation](docs/CONVERSATION_ANALYSIS.md)
for the evidence, interpretations, tensions and later refinements behind these
principles, and the [interaction principles](docs/INTERACTION_PRINCIPLES.md) for
how to apply them to each screen. WASM and hosting choices are possible means;
useful, accessible and independent operation is the goal.

## Project goal

**Finish Along as an intuitive, inclusive, installable Auckland commuter webapp,
and prepare it as a reproducible AI-assisted coding course example.**

The [full goal and completion criteria](docs/PROJECT_GOAL.md) preserve the user's
nine-part brief: interaction design, real journeys, inclusion, installation and
updates, browser independence, distribution, GitHub documentation, course material,
and release checks. The [release checklist](docs/RELEASE_CHECKLIST.md) separates
completed evidence from outstanding checks; public availability is not a claim
that all validation is complete.

## See Along in use

Actual app screens using public example addresses and the preserved Auckland
transport timetable. The route map shows downloaded AT geometry over an optional
online OpenStreetMap background, not live vehicle tracking. These views show the
interface after acknowledging the first-use course notice; the notice remains
available in the footer and Settings. Tap a screenshot to view it at full size.

<table width="100%">
<tr><th width="50%">Start with your destination</th><th width="50%">Choose a mixed-mode journey</th></tr>
<tr>
<td width="50%"><a href="docs/screenshots/01-start.png"><img src="docs/screenshots/01-start.png" width="100%" alt="Along asks for a destination, with the acknowledged course notice available in the footer."></a></td>
<td width="50%"><a href="docs/screenshots/02-journey.png"><img src="docs/screenshots/02-journey.png" width="100%" alt="A scheduled Broadway to Devonport journey shows walking, train and ferry connections with one clear Use this journey action."></a></td>
</tr>
<tr><th>Follow one step at a time</th><th>Explore a route's path and stops</th></tr>
<tr>
<td width="50%"><a href="docs/screenshots/03-follow.png"><img src="docs/screenshots/03-follow.png" width="100%" alt="The journey view shows the current walking step and Next step action."></a></td>
<td width="50%"><a href="docs/screenshots/04-route-map.png"><img src="docs/screenshots/04-route-map.png" width="100%" alt="Route 70's published path and stop markers over a street-map background, with scheduled-service choices below."></a></td>
</tr>
<tr><th>Save places before choosing a route</th><th>Read scheduled stop departures</th></tr>
<tr>
<td width="50%"><a href="docs/screenshots/05-save-places.png"><img src="docs/screenshots/05-save-places.png" width="100%" alt="The review screen offers Save these places before finding a route, without saving a departure time."></a></td>
<td width="50%"><a href="docs/screenshots/06-departures.png"><img src="docs/screenshots/06-departures.png" width="100%" alt="A departure board labels times as scheduled, not live, with linked route numbers and destinations."></a></td>
</tr>
</table>

Screenshots are reproducible with `node scripts/capture_ux.mjs` against a running
copy; set `CHROMIUM_PATH` if needed. All captures use the same viewport and pixel
dimensions. `CAPTURE_STREET_MAP=1` requests a street background for that one
presentation capture; automated tests do not fetch public street tiles. The **About Along** links in the footer and Settings open
this repository for source, installation help and the course material.

## What you can do

- Compare different lines at nearby stops, including estimated walking time at your pace.
- Search addresses or stops, compare journey options, then reveal steps and walking detail.
- Tap route badges to explore directions, branches, mapped paths and scheduled stop times.
- Open a stop for its location and upcoming scheduled departures; Back returns to your task.
- Save endpoints and your chosen bus/train/ferry service sequence; reopen with fresh scheduled departures.
- Let repeated searches suggest a routine; pause learning or clear it.
- Choose more walking time, avoid mapped steps/barriers, or require confirmed stop/vehicle access.
- Install on desktop or Android, and reopen with downloaded data when offline.
- Check for app updates by refreshing or returning to the app; offline checks stay quiet.

The design rule is: **make the user's likely next action the clearest option,
while keeping alternatives accessible**. See [interaction principles](docs/INTERACTION_PRINCIPLES.md).

## Install and try

Follow the [browser-by-browser installation and offline guide](https://reality2.ai/along/install.html)
for Chrome, Edge, Brave and Safari, covering Android,
iPhone/iPad, Windows, macOS, Linux and Chromebook. Install the icon, reopen it
online to finish preparation, then test it without a connection.

Open a hosted copy over HTTPS, wait for **Along · offline ready**, then use the
browser's **Install app** or **Add to Home Screen** action. On desktop Chromium,
installation is also offered in the address bar when eligible. On iOS, use Safari's
Share menu → Add to Home Screen; iOS device validation is not yet recorded.

Start with your destination: search a street number, street name and suburb, then
choose a suggestion and continue. Choose your starting place (or current location),
review **Journey preferences**, and select **Find my way**. **Use this journey**
opens one step at a time; advance explicitly when ready, or expand **Whole journey**.
Back preserves your entries. Other routes, nearby departures and saved journeys
remain available without crowding the current task. Settings shows offline readiness.

Open [Along at reality2.ai/along](https://reality2.ai/along/), or host the static
build below yourself. The four data bundles total approximately **39.4 MiB**;
uncompressed storage and memory are considerably larger. Browser storage can be
evicted. Do not rely on an expired timetable or mistake scheduled times for live
predictions. See [release evidence and limits](docs/RELEASE_CHECKLIST.md).

## Save places and optional service preferences

On the review screen, before choosing a route, **Save these places** remembers
just your start and destination. It does not save a departure time or itinerary.
Reopen the saved places from **Your usual journeys** to plan again.

After choosing a journey, **Prefer these services** can separately remember the
ordered bus, train or ferry numbers (and saves the places if needed). Reopening
then searches the current timetable for that combination, with freshly calculated
walking connections, boarding stops and departures. It does not track a particular
vehicle or retain the original departure time.

If no match is found within the four-hour search window and your travel
preferences, Along says so and offers other options. **Compare without saved
route preference** lets you explore freely. One preferred combination is stored
per endpoint pair; selecting another replaces it. Turning off **Preferred
services** keeps the saved places. Removing **Saved places** removes both.
Older saved places stay usable and acquire no service preference automatically.

## Explore a route or stop

Tap a route badge in a journey or nearby departures, or choose **Explore a bus,
train or ferry route** on the opening screen. Choose a direction/branch to see the
published AT path, full stop sequence and a scheduled service's stop times.
Filter stop names with a term such as **Symonds**. A street without a matching
stop name may still be on the path; this is not a street-intersection search.

Tap a stop name or map marker for its location and a departure-board view, clearly
labelled **Scheduled departures — not live**. The AT Mobile link opens AT’s website
for live times and vehicle tracking; it does not send Along’s saved journeys to AT. Back or
Escape returns through the detail layers without changing your planned journey.
Downloaded paths and stop locations work offline. **Show street map** in the centre of the map
adds an OpenStreetMap background on request; those tiles are not in the offline
bundle. Maps supplement the keyboard-accessible stop list.

Source repository: [reality2-ai/along](https://github.com/reality2-ai/along).
The source and course material are public. The app is hosted at
[reality2.ai/along](https://reality2.ai/along/); the hosting instructions below
also let you run your own copy.

## Run from source

**For the current version 42 app, follow [Building Along](docs/BUILDING.md).**
It includes the browser device-group runtime, optional direct AT access and
saved-journey sharing. The commands below run the **legacy planner development
server**; `npm start` does not reproduce version 42.
They remain useful for isolated routing and interface work.

Requirements: Python 3.10+, a current browser supporting service workers,
IndexedDB, module workers and `DecompressionStream`. Node 22+ is used for tests;
only the street-data import needs an extra Python dependency.

```sh
mkdir -p data
curl -fL https://gtfs.at.govt.nz/gtfs.zip -o data/gtfs.zip
python3 scripts/import_gtfs.py data/gtfs.zip
python3 scripts/import_addresses.py
python3 -m venv .venv
.venv/bin/pip install -r requirements-import.txt
curl -fL https://download.bbbike.org/osm/bbbike/Auckland/Auckland.osm.pbf -o data/auckland.osm.pbf
.venv/bin/python scripts/import_streets.py data/auckland.osm.pbf
python3 server.py
```

Open <http://localhost:3080>. `npm start` is a shortcut for the server. Imports
require an internet connection, disk space and more memory than running the UI.
Downloaded data is excluded from Git. See [data imports](docs/DATA.md) for refresh,
coverage, provenance and reproducibility.

## Static hosting and downloadable build

The [version 42 release](https://github.com/reality2-ai/along/releases/tag/v0.42.0)
contains `along-web-v42.zip` and its SHA-256 checksum. To host the current app,
extract the ZIP and serve its **entire contents**, including `experiments/`,
`data/`, runtime notices and `.nojekyll`, over HTTPS. Opening `index.html` as a
local file does not install the app. No Along backend is required.

For a local check, run `python3 -m http.server 3082 --directory /path/to/extracted-build`.
Localhost is a development secure context; a phone needs HTTPS. Both `/` and a
repository subpath are supported. Serve `.gz` files as raw gzip bytes **without
a Content-Encoding header**; the browser decompresses them itself. Serve `.js`
and `.mjs` as JavaScript and `.wasm` as `application/wasm`, without an HTML fallback.

See [current source builds and qualification](docs/BUILDING.md),
[hosting](docs/HOSTING.md), and the [version 42 device check](docs/DEVICE_CHECK.md).
`npm run build` now prepares the current candidate using the pinned runtime.
`npm run serve:built` serves that candidate locally. The explicit legacy
`python3 scripts/build_static.py` / `npm run build:legacy` path produces the
legacy planner in `dist/`; it does not include version 42's connected features.

## Updates

The app offers **Update and reopen** after downloading a new interface. Settings
show the app version and **Check for an app update**. Opening, returning to,
reloading or pulling down from the top checks for an update, as does refreshing
nearby departures. Network failures during these checks are silent.

For an older cached installation, open `update.html` on the same site in the
browser used to install Along, choose **Check for updates**, read the version confirmation, then choose
**Open Along** and reopen the
installed app. Saved journeys and downloaded data are preserved.

App updates and data updates are separate. Refresh the host's data imports and
redeploy, then choose **Update downloaded timetable** in settings to download the
host's timetable, streets and addresses. This button does not fetch a new GTFS ZIP
from AT or run an importer. All open tabs should be reloaded after an app update.

## Optional live AT data

The public app currently uses scheduled data. The intended live connection goes
directly to Auckland Transport, without an Along-operated central backend.
Each person would use their own AT subscription key, with Reality2 trust-group
integration under development for managing access across their devices. No shared
key will be included in the public app.

Authenticated browser reads of the AT feeds and matching against the downloaded
timetable have been tested. The complete trust-group credential connection and
its final public interface are unfinished, so live data remains disabled in the regular
app. See the [runtime integration evidence](docs/REALITY2_INTEGRATION.md).

For Samsung S23/desktop testing, the separate
[device-pairing lab](https://reality2.ai/along/pairing-lab/) is available as build
`5dd96dcabf9a`. Follow the [device-check guide](docs/PAIRING_DEVICE_CHECK.md), using
dummy key text only. No coding is needed. This experiment does not enable live
information or journey synchronization in the installed app.

The [full device preview](https://reality2.ai/along/preview/public/) includes
[saved-journey sharing through Settings](experiments/journey-sync/README.md#actual-app-saved-places-local-experimental-build)
and optional AT-key setup/sharing. Two-browser tests cover saved places, service
preferences, offline changes and permission removal. Initial pairing still requires transferring messages. Version 3806 adds optional
reconnection through a user-selected relay for already paired, permitted devices.
The relay is off by default; external compatibility and physical-device acceptance
remain unverified. [Download the static preview and checksum](https://github.com/reality2-ai/along/releases/tag/device-preview-3806)
to inspect or host it yourself. Runtime provenance and licence notices are included.

The preview also provides a device-certificate list and reviewed, signed group
removal messages. Each receiving device verifies and saves the removal; copying
alone is not delivery. Completed older enrollments are recovered from verified installation receipts;
interrupted enrollments without receipts can still be absent. Reconnection exchanges
signed removals before shared access; both devices must update.
Removal cannot erase previously shared copies or replace an AT key at its provider.
Version 3804 adds reviewed group-key updates, delivery to existing devices and
verified installation confirmations. Sharing is tested after rotation even when
the AT-key owner is a different member. Version 3805 compacts repeated queued edits and explains the distinct-place
sharing limit. Version 3806 adds reviewed recovery checkpoints and older-copy edit
recovery, plus clearer QR pairing feedback. The tested 3805 → 3806 update preserves
preview saved places, identity and encrypted keys. Update both devices before
pairing or reconnecting; the invitation and AT reconnect formats have changed.

The repository also contains tested experimental live matching and proxy code; that proxy is not the
planned public architecture. See [hosting and live-data status](docs/HOSTING.md).

## Limits and accessibility

- Urban street/address coverage is bounded by longitude 174.45–175.05 and latitude
  −37.15–−36.66. The transit feed covers a larger area; not every regional address
  or ferry destination has a downloaded walking network.
- Routing searches four hours ahead with up to three changes and bounded access
  walks. It returns a limited set of options, not every route or a guaranteed optimum.
- Mapped walking paths include short estimated links to buildings and platforms.
  Nearby lookup examines up to 18 stops within 800 m and two hours of departures;
  mapped walks are limited to 20 minutes. Catchability is an estimate.
- Avoiding mapped barriers does not verify kerbs, lifts, surfaces or current access.
  The current AT feed marks wheelchair access as unknown; requiring confirmed
  access can therefore return no verified journey. Unknown does not mean accessible.
- No fares, booking, live turn-by-turn tracking or journey-specific disruption rerouting.
- Automated accessibility checks do not certify universal usability. Read the
  [accessibility checks and device checklist](docs/ACCESSIBILITY.md).

## Privacy

Searches, saved journeys and preferences stay in browser storage. Learning reflects
successful searches, not proof of trips taken. Location is requested explicitly
and used locally. There is no analytics service or background journey tracking.
The host still receives ordinary asset/API requests; external AT links contact AT.
Choosing the online street background sends visible map-tile requests to
OpenStreetMap, revealing the viewed area and ordinary connection metadata.
Regular Along does not synchronise between devices. The separate Device Preview
supports opt-in saved-place/service-preference sharing and AT-key sharing through
a documented browser-only R2 subset. Connection messages are transferred manually;
automatic discovery and reconnection remain unfinished. See the
[current integration status](docs/REALITY2_INTEGRATION.md).
Clearing browser site data removes the stored routes and offline datasets.

## Development and verification

```sh
npm ci
npx playwright install chromium
npm test
# With datasets imported; the browser command manages its own local server:
npm run test:browser
npm run test:updates
npm run build
npm run test:static
python3 test/check_route_exploration.py
```

Set `CHROMIUM_PATH` to use an existing Chromium. `TEST_BASE_URL` selects a different
caller-managed server for the browser suite. Without that override, Playwright
starts and stops `python3 server.py` on port 3080 with `AT_API_KEY` explicitly empty,
so the ignored local key file is not loaded. Stop an existing development server
first; tests will not silently reuse it. Real-data tests use 23 September 2026; update
fixtures when the feed no longer covers that date. Synthetic unit tests do not
need downloaded data. See [architecture](docs/ARCHITECTURE.md), [performance evidence](docs/PERFORMANCE.md),
[contributing](CONTRIBUTING.md), and [release evidence](docs/RELEASE_CHECKLIST.md).

## AI-assisted coding course

Start with the [current course handover](docs/course/HANDOVER.md), then the
[course guide](docs/COURSE_GUIDE.md) and
[thematic analysis of the conversation](docs/CONVERSATION_ANALYSIS.md). They cover
how concrete user feedback changed the requirements, the mistakes uncovered by
verification, and how to distinguish implemented behaviour from supported claims.
The optional [portable AI launcher](docs/AI_LAUNCHER.md) is separate from the app.

## Licence and data credits

Original code, artwork and course material: [MIT](LICENSE).
Transit data: Auckland Transport, CC BY 4.0. Addresses: LINZ, CC BY 4.0.
Walking database: © OpenStreetMap contributors, ODbL 1.0.
Map renderer: Leaflet 1.9.4, BSD 2-Clause (vendored licence included).
These dataset licences are separate from the code licence. Keep the
[full source and transformation notices](NOTICE.md) with redistributed builds.
