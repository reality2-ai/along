# Hosting, phone access and restart setup

> **Current direction:** Along must work without an Along-operated central
> backend. Live information should be requested directly from its original
> provider. The proxy instructions below describe retained experimental code,
> not the intended public deployment. No public proxy has been deployed.


## Public static host

Run `npm run build` with all datasets imported. Upload the contents of `dist/` to
an HTTPS host. A GitHub Pages repository path works; the build rewrites asset and
manifest paths to relative URLs. Deploy the entire bundle together, retaining
`NOTICE.md`, `LICENSE` and the complete `data/` directory.

Use a short/no-cache policy for `sw.js` and HTML so update checks can discover new
releases. Preserve raw `.gz` bytes without Content-Encoding. Do not put API keys
in a static host's public environment or JavaScript. Scheduled/offline routing
works without any live backend.

Public publication is separate from preparing the ZIP. No repository name,
public domain or hosting account is assumed by this project.

## Local Python host

`python3 server.py` binds to loopback on port 3080 by default. `.env` can select
`PORT` and set `AT_API_KEY`. The server uses an explicit static-file allowlist;
it does not expose arbitrary source files or `.env`.

The standard-library server is suitable for local/private use. For a public live
proxy, place it behind an appropriate HTTPS deployment, review upstream API terms
and traffic limits, and retain server-side secret handling. The static build can use an explicitly configured live base URL with
`predictions`, `alerts` and `vehicles` endpoints.

## Test on a phone over Tailscale

Connect the phone and host to the same tailnet. Check existing mappings first:

```sh
tailscale serve status
tailscale serve --bg --https=8443 http://127.0.0.1:3080
```

Use a free port; do not replace another service's mapping. Open the HTTPS URL
printed by Tailscale. Depending on your installation, Serve may need administrator
permission or a configured operator. Serve access remains private to the tailnet
and its access policy. A plain HTTP tailnet IP does not provide the same browser
secure-context capabilities as HTTPS.

## Restart after boot

`deploy/along.service` is a user systemd example. Adjust its working directory and
Python path for your checkout before installing it:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/along.service ~/.config/systemd/user/along.service
systemctl --user daemon-reload
systemctl --user enable --now along
loginctl enable-linger "$USER"
```

Lingering allows the user manager to start without login and may require local
administrator authorisation. The service restarts after failure. Enable the
Tailscale daemon at boot through your system's service manager as appropriate.

```sh
systemctl --user status along
systemctl --user restart along
journalctl --user -u along -n 50 --no-pager
```

Restart after Python/server changes; static files are read on request. Browser
service-worker caches still require an app update. Check **Settings → App version**
to identify the interface actually loaded on a device.

## GitHub Pages or your existing AWS apps site

The same `dist/` directory works on either host. Use a trailing-slash app URL,
for example `https://example.org/along/`, so relative assets and service-worker
scope resolve correctly. Each app has its own subdirectory and worker scope.

For GitHub Pages, publish the **contents** of `dist/` to the root of a deployment
branch, then select that branch in repository Settings → Pages. Retain `.nojekyll`
and all four data bundles. The resulting project URL is
`https://OWNER.github.io/REPOSITORY/`. Generated data is ignored in the source
checkout; publishing only the source branch will not produce a working app.
See [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

For AWS, upload the contents into the chosen app prefix in your existing HTTPS
site, or use S3 with CloudFront/Amplify. Configure `/along/` to serve
`/along/index.html`; keep missing data/API files as real 404 responses rather than
rewriting every request to HTML. Set JavaScript/CSS/manifest MIME types correctly
and serve `.json.gz` as `application/gzip` **without** `Content-Encoding: gzip`.
CloudFront's cache policy must permit revalidation of HTML, `sw.js` and the
unversioned app assets when publishing a release; invalidate that app prefix when
needed. See [AWS static hosting guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html).

The optional AT backend exposes `api/predictions`, `api/alerts` and `api/vehicles`.
CloudFront can route those paths to a protected backend. GitHub Pages cannot run
that backend: the current static-only build gracefully uses scheduled information.
Changing hostname creates a different browser storage origin; existing saved
journeys do not automatically transfer to the new public site.

Route paths and stop markers work offline from AT data. Street-map backgrounds
are optional online OpenStreetMap tiles, requested only on the person's explicit
choice. Permit `https://tile.openstreetmap.org` in `img-src` if setting CSP. Do not
prefetch or package street tiles. Leaflet is vendored locally with its licence;
it does not require a CDN at runtime. Review the
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) for hosting
scale and provider requirements before a large public rollout.

## Reality2 portal

The organisation site already uses GitHub Pages with the custom domain
`reality2.ai`. GitHub project sites inherit that domain, so enabling Pages for
`reality2-ai/along` without its own CNAME would serve `https://reality2.ai/along/`.
This does not require replacing the organisation homepage or changing DNS.
The deployment bundle is on the `site-preview` branch, configured as the Pages
source at `/`, without another CNAME. Publish updates by rebuilding the static
bundle and updating this branch; a source-only change on `main` does not deploy
the app.

The portal's role is distribution and updates. Once prepared in the installed
app, address search, scheduled journeys and local personalisation do not require
the portal. Installation help is cached too. Journey history is not uploaded.
See [browser/platform installation and privacy details](INSTALL.md).

Service-worker scope stays under `/along/`. Browser storage permissions are
origin-based, so host only mutually trusted applications on the same domain;
subdirectories are not separate security origins. Saved data from a private host
will not automatically move to the public origin.


## AT subscription credentials

The Python server accepts one subscription credential in `AT_API_KEY`, held on
the backend, or reads the ignored root-level `APIKey` file when the environment
variable is absent. An explicitly empty `AT_API_KEY` disables live access even if
the file exists. The file must contain only the key; it is never served by the
HTTP asset routes or copied into the static build. Its request uses the `Ocp-Apim-Subscription-Key` header documented by
[AT's developer portal](https://dev-portal.at.govt.nz/), keeping credentials out of
request URLs. A public GitHub Pages build cannot hold this secret: connecting live
data requires a separately hosted proxy and client endpoint configuration. That
public proxy is not currently deployed.

Authenticated checks on 23 September 2026 returned fresh trip updates, service
alerts and vehicle locations through the existing adapter. See the
[aggregate evidence](evidence/at-authenticated-check.json). Of 2,129 trip update
instances, 1,827 matched downloaded trip IDs; this does not establish a prediction
for every scheduled service. A public live proxy is still not deployed. Credentials
remain outside Git and all public build assets.

AT documents English-only text for realtime alert descriptions and headings in
[its realtime guide](https://dev-portal.at.govt.nz/realtime-api). Preserve the
source language and label it explicitly in a Māori interface; translating the
interface does not establish a reviewed translation of changing service alerts.

### Local backend readiness after version 31

The Python asset allowlist now includes the phrase and feedback modules, so the
current interface can run against the local backend again. Its CSP permits the
explicit anonymous GitHub receipt check. Local HTTP tests verify those modules
and rejection of credential-file paths. Credential-loader tests use dummy values
and verify environment precedence, explicit disable and non-disclosing errors.
This does not restart the retired Alfred service or deploy a public live proxy.


### Live adapter progress after version 32

The server adapter rechecks feed freshness on cache hits, so its 60-second cache
cannot extend the 180-second freshness window. The alert response now retains
`informed_entity`, `active_period`, feed timestamp and alert identifiers, without
truncating the feed before contextual filtering. Restrictions are preserved,
including unknown selector fields, to avoid accidentally broadening their scope.
The endpoint does not require the local Python timetable planner.

These changes prepare contextual live integration; they do not enable live data
on GitHub Pages. Client filtering, explicit opt-in, secure public proxy hosting
and end-to-end live journey/stop checks remain to be completed. Reference:
[GTFS Realtime alert and selector definitions](https://gtfs.org/documentation/realtime/reference/#message-alert).

The tested `public/live-context.js` matcher is now available for client integration.
It matches all selector restrictions against a single verified stop/leg context,
accepts alternative selectors, checks dated trip identities and feed freshness,
and respects half-open active/communication/impact periods. Missing context and
unknown restrictions do not become generic journey advice. Its functions have no
network, storage or journey-state side effects. Five focused JavaScript scenarios
cover these contracts; the adapter tests also verify preservation of the newer
communication/impact fields. This module is not yet connected to the public UI.


### Explicit live checks (source integration, not yet a public release)

The nearby screen now uses `live-client.js`: live data is fetched only after
“Check live departures”. Ordinary navigation/filtering/refresh uses scheduled
results. The control is hidden when `live-config.js` has no proxy URL, as in the
public static configuration. The Python server supplies `./api/` configuration
when a server-side key exists; the key never appears in that module. Leaving
nearby cancels pending reads and drops their cache. Offline checks retain the
schedule without an error dialog. Network-wide alerts remain an explicit action.

The client sends only a feed name to the proxy, without coordinates, addresses,
history, cookies or a referrer. The proxy still receives the network IP address.
It checks feed freshness even on cache hits, deduplicates pending reads and ignores
responses cancelled by navigation. This does not yet provide live selected-stop
boards, selected-journey alerts or vehicle positions. Secure public deployment is
still outstanding; a hosting preference has been requested from the user.

Verification for this source integration: all 45 JavaScript and 11 Python tests
pass; the existing mobile-nearby accessibility flow passes; a configured-proxy
browser fixture confirms zero requests before a click, one on explicit intent,
no request on ordinary refresh, and retained departures offline. That fixture
blocks service workers to intercept configuration reliably and verifies session
behaviour; it is not an installed-app or authenticated-public-proxy test.

### Stop-board live checks (source integration)

Configured deployments now offer an explicit live check within stop details.
The board retains scheduled times and row order, annotating only matched predicted,
cancelled or skipped departures. Closing/navigating the detail cancels its reader;
a freshness timer restores scheduled cells after 180 seconds from the feed stamp.
Unmatched or offline results remain scheduled. No public proxy is enabled yet.

`live-predictions.js` checks trip ID, service date, any supplied route/start time,
unique stop identity and schedule relationships. `stopDetails` supplies the dated
trip and visit count from the downloaded timetable. Repeated stop visits retain
scheduled information because the compact data lacks original stop_sequence;
loop predictions require extending the data import before they can be supported.
No-data, replacement/unscheduled trips and changed platform assignments are not
silently treated as ordinary departure predictions. The basis is the
[GTFS StopTimeUpdate reference](https://gtfs.org/documentation/realtime/reference/#message-stoptimeupdate).

Six focused matcher/exploration tests pass. Three browser checks pass: existing
mobile nearby/accessibility, route/map/stop/offline Back, and explicit configured
live checks at nearby/individual stops with an empty-feed fixture. That last check
proves request intent, empty-match messaging and Back, not a real AT prediction
appearing on a physical device. Matched display, expiration and cancellation browser fixtures now pass, including
actual abort on Back, unchanged row order, retained scheduled times, 360 px reflow
and an axe check of the live board. These use synthetic live events matched to
real downloaded departures; they do not establish public proxy availability.

### Contextual stop alerts (source integration after version 34)

A configured stop check requests both predictions and alerts after the user's
explicit action. Matching alerts appear in a collapsed service-updates disclosure;
only its count is added to the status announcement. Text is rendered as text,
not trusted HTML. Alert expiry clears the disclosure independently of prediction
expiry, and leaving the detail cancels both pending feeds.

Each departure supplies a verified stop, route, route type, dated trip and start
time. Matching is evaluated at its displayed Auckland departure time. A separate
stop-only context covers the inspected stop's two-hour window, including when no
departures are returned. Wall-time conversion does not depend on the device's
timezone; ambiguous or missing daylight-saving wall times are left unmatched.
Agency/direction restrictions still need corresponding source metadata before
those selectors can match. Selected-journey integration is described below.
The public proxy remains unconfigured; version 34 is still the deployed release.

### Selected-journey service alerts (source integration)

Configured deployments now offer “Check live times and alerts” below
the primary progress action. It checks the remaining legs only, on explicit
request. Dated trip identities and intermediate stop arrival/departure intervals
are retained by the planner, including runs beginning on the previous service
day. Route-wide alerts match the ridden interval; stop restrictions match the
corresponding stop visit. No route, time or progress is automatically changed.

Advancing a step or leaving the journey clears and cancels the check. Results
expire after the feed freshness window, and offline failure retains the chosen
schedule. Unknown agency/direction selectors still require additional source
metadata; this is not a guarantee that every relevant alert can be identified.
Vehicle position source integration is described below. Public version 34
still has no configured live proxy.

For the journey-alert integration, all 54 JavaScript and 11 Python tests pass,
as do all five live-data browser scenarios. The journey fixture verifies matching
against a real downloaded leg with a synthetic alert, exclusion of a wrong-date
alert, unchanged chosen-step content, expiry and quiet offline fallback. These
checks do not establish authenticated public live availability.

### Selected-journey departure predictions (source integration)

The same explicit check now fetches predictions alongside alerts. Each remaining
transit leg is matched by dated trip, route, start time and boarding stop. The
planner retains full-trip stop visit counts; repeated visits remain scheduled
rather than guessing which visit a prediction refers to. Matched expected times,
cancellations and skipped boarding stops appear beside the scheduled itinerary.
Unmatched legs retain their schedule. Expected departures do not imply predicted
arrival times or guaranteed transfers, and do not change journey progress.

Prediction and alert results expire independently. The browser fixture exercises
an expected departure, cancellation, skipped stop, wrong service date, expiry and
offline fallback against a real downloaded journey, using synthetic live records.
Public version 34 still uses the offline schedule; this source integration needs
a configured secure live proxy and a subsequent release before public use.

### Contextual vehicle positions (source integration)

Configured route-detail maps now offer an explicit current-position check for the
selected departure. The proxy exposes `/api/vehicles` using AT's `vehiclelocations`
feed. Matching requires one dated trip, consistent route/start time when supplied,
a scheduled trip relationship, valid coordinates, and both feed and individual
GPS timestamps within 180 seconds. Missing or ambiguous identity and unknown GPS
freshness leave the scheduled route visible. The timestamp distinction follows
the [GTFS vehicle-position specification](https://gtfs.org/documentation/realtime/feed-entities/vehicle-positions/).

A matched marker includes its observation time and a text description of its
straight-line distance from the nearest stop in the selected run. It is not an
arrival prediction. Results expire when either timestamp becomes stale; changing
the run or leaving the detail clears the marker and cancels pending requests.
No automatic polling, street-tile loading or location permission is involved.
The browser test uses a real downloaded route with synthetic vehicle records;
public hosting remains unconfigured, and public version 34 is unchanged.

### Feed-only service for a separate host

`live_proxy:application` is a WSGI entry point that does not import the planner or
serve files. It exposes only GET `/api/predictions`, `/api/alerts` and
`/api/vehicles`. Requests cannot select an upstream URL or include query parameters.
It reuses the server-side AT credential loader and 60-second upstream cache;
stale data and failures retain the client's scheduled fallback.

Configure the service environment with `AT_API_KEY` through the hosting provider's
secret mechanism and `ALONG_ALLOWED_ORIGINS=https://reality2.ai`. Additional trusted
HTTPS origins can be space-separated; paths, wildcards and credentials are not
accepted. The browser origin is `https://reality2.ai`, not its `/along/` path.
Responses allow that exact origin, vary on Origin and never enable cookies or
browser credentials. GET preflights are supported. CORS is browser access control,
not authentication: other clients can call a public feed proxy. See
[MDN's CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

The host must provide HTTPS, a production WSGI server, request/concurrency limits,
and edge rate limiting suited to the AT subscription allowance. Each worker has
its own cache, so worker counts and replica counts affect upstream usage. Configure
proxy access-log retention deliberately; this module does not log requests but
the hosting stack may. No user addresses, journey choices or GPS positions are
needed by these endpoints. This is a prepared entry point, not a deployed service
or a completed load/security review of a hosting stack.

After selecting and deploying the host, set the public `live-config.js` base URL
to its HTTPS `/api/` location (never a key), allow that host in `connect-src` if
applying a content-security policy, then test from the actual Pages origin before
publishing an app update. Validate all three feeds, CORS, expiry, offline fallback,
AT usage limits and the absence of secrets from the public bundle. The current
public config remains empty.

A WebAssembly server running in the browser would not protect a shared AT key:
the code and its inputs are on the user's device. It also cannot provide current
AT data offline. WASM may help local computation where justified, but it does not
replace the remote secret-holding role of this proxy. A personal-key mode would
be a separate feature requiring verification of AT's browser access and terms.

### Direct-provider architecture (latest user direction)

The user clarified that independence means no central Along server, including for
live information. Do not deploy the proposed proxy. A read-only check of AT's
vehicle-location endpoint returned HTTP 200 for both an OPTIONS preflight allowing
the subscription-key header and an authenticated GET, with `Access-Control-Allow-Origin: *`.
See [the recorded header check](evidence/at-direct-cors-check.json). This establishes
that this endpoint permits cross-origin browser access; all-feed browser integration
and the credential experience still need implementation and verification.

A shared key embedded in JavaScript or WASM would be public. Optional direct access
using each user's own AT key is proposed, pending the user's decision. The key
would be sent only to AT on an explicit live check. Scheduled planning remains
key-free and offline. Existing proxy code is retained as an experiment, not a
required service or the planned architecture. The public app still has live
access disabled.

### Proposed Reality2 trust-group credential integration

The user proposed keeping each person's own AT key within their Reality2 trust
group. This is the current direction to investigate instead of a standalone
personal-key settings form. The intended flow is authorised device access to an
application credential, followed by a direct request to AT; no central Along
service should be required. TG membership removal cannot invalidate an AT key
already copied to a device: suspected exposure requires AT-side rotation too.

The Reality2 reading edition inspected is revision `006d57a4`, declared version
0.9.0 (working draft). Its [L5C management-wallet scope](https://reality2.ai/standard/L5C-management-wallet.html)
explicitly excludes application data and concerns custody of group-management
keys. An AT key must therefore not be treated as group identity or assumed to be
a built-in management-wallet field. Application storage/access policy and a real
browser-compatible runtime or device bridge still need to be identified and
verified. No TG credential API or security conformance is claimed by Along yet.
