# Along — your Auckland commute

An independent, installable webapp for finding a useful next ride and planning
street-address-to-street-address journeys across walking, buses, trains and ferries.
After the first download, address search and scheduled routing run in your browser,
including offline. **Once prepared, Along does not need the web portal to operate.**
**Your searches, saved journeys and preferences stay on your device.** No account
or uploaded journey history is needed.

Along uses Auckland Transport's public data and its own bounded routing engine.
It is **not an official AT app** and does not reproduce AT Mobile's journey planner.
Live predictions are optional and require a separately configured backend.

## What you can do

- Compare different lines at nearby stops, including estimated walking time at your pace.
- Search addresses or stops, compare journey options, then reveal steps and walking detail.
- Tap route badges to explore directions, branches, mapped paths and scheduled stop times.
- Open a stop for its location and upcoming scheduled departures; Back returns to your task.
- Save journeys or let repeated searches suggest a routine; pause learning or clear it.
- Choose more walking time, avoid mapped steps/barriers, or require confirmed stop/vehicle access.
- Install on desktop or Android, and reopen with downloaded data when offline.
- Check for app updates by refreshing or returning to the app; offline checks stay quiet.

The design rule is: **make the user's likely next action the clearest option,
while keeping alternatives accessible**. See [interaction principles](docs/INTERACTION_PRINCIPLES.md).

## Install and try

Follow the [browser-by-browser installation and offline guide](docs/INSTALL.md)
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

There is no public production URL yet. You can host the static build below or run
a private copy. The four data bundles total approximately **38 MiB**;
uncompressed storage and memory are considerably larger. Browser storage can be
evicted. Do not rely on an expired timetable or mistake scheduled times for live
predictions. See [release evidence and limits](docs/RELEASE_CHECKLIST.md).

## Explore a route or stop

Tap a route badge in a journey or nearby departures, or choose **Explore a bus,
train or ferry route** on the opening screen. Choose a direction/branch to see the
published AT path, full stop sequence and a scheduled service's stop times.
Filter stop names with a term such as **Symonds**. A street without a matching
stop name may still be on the path; this is not a street-intersection search.

Tap a stop name or map marker for its location and scheduled departures. Back or
Escape returns through the detail layers without changing your planned journey.
Downloaded paths and stop locations work offline. **Show street map (online)**
adds an OpenStreetMap background on request; those tiles are not in the offline
bundle. Maps supplement the keyboard-accessible stop list.

Source repository: [reality2-ai/along](https://github.com/reality2-ai/along).
The source and course material are public. A public app site has not yet been
deployed; use the hosting instructions below to run your own copy.

## Run from source

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

```sh
python3 scripts/build_static.py
```

This produces `dist/`, a ZIP in `releases/`, and a SHA-256 checksum. Upload the
**contents of dist** to an HTTPS static host, including the four `data/*.json.gz`
files and `.nojekyll` on GitHub Pages. Both `/` and a repository subpath are
supported. Serve `.gz` files as raw gzip bytes **without a Content-Encoding header**;
the browser worker decompresses them itself. Serve JavaScript as JavaScript, not HTML.

For a local preview: `python3 -m http.server 3082 --directory dist`. Localhost is
a development secure context; a phone needs HTTPS. A ZIP cannot be installed by
opening `index.html` as a `file://` URL. Host it first. Static hosting supplies
scheduled journeys; optional live API endpoints are absent by design.

The builder packages only public assets, public datasets and licence notices.
It does not package `.env`, agent conversations or private deployment settings.
See [hosting and restart setup](docs/HOSTING.md).

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

Register through the [AT developer portal](https://dev-portal.at.govt.nz/), subscribe
to the relevant realtime API, copy `.env.example` to `.env`, set `AT_API_KEY`, and
restart `server.py`. The Python proxy sends the key in a server-side header. Never
put it in browser JavaScript or a static build.

Nearby departures use matching live predictions when available; expired or failed
feeds fall back to labelled schedules. **Journey itineraries remain scheduled.**
Route details and stop-detail timetables also remain scheduled. Live data can add
arrival predictions, reported cancellations and alerts; AT also offers vehicle
positions, but Along does not yet display live vehicles or replan around delays.
The adapter is fixture-tested; authenticated verification remains pending a key.
See [AT realtime documentation](https://dev-portal.at.govt.nz/realtime-api).

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
There is no cross-device synchronisation; the [Reality2 design](docs/R2_SYNC_DESIGN.md)
is a proposal, not an implemented feature.
Clearing browser site data removes the stored routes and offline datasets.

## Development and verification

```sh
npm ci
npx playwright install chromium
npm test
# Start python3 server.py in another terminal, with datasets imported:
npm run test:browser
npm run test:updates
npm run build
npm run test:static
python3 test/check_route_exploration.py
```

Set `CHROMIUM_PATH` to use an existing Chromium. `TEST_BASE_URL` selects a different
local server for the browser suite. Real-data tests use 23 September 2026; update
fixtures when the feed no longer covers that date. Synthetic unit tests do not
need downloaded data. See [architecture](docs/ARCHITECTURE.md), [performance evidence](docs/PERFORMANCE.md),
[contributing](CONTRIBUTING.md), and [release evidence](docs/RELEASE_CHECKLIST.md).

## AI-assisted coding course

Start with the [course guide](docs/COURSE_GUIDE.md) and
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
