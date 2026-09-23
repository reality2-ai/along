# Hosting, phone access and restart setup

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
and traffic limits, and retain server-side secret handling. The static build
expects optional same-origin `api/predictions` and `api/alerts` endpoints.

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

The optional AT backend uses same-origin `api/predictions` and `api/alerts`.
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
