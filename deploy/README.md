# Host Along

This is the complete static Along webapp. Extract the ZIP and upload **its contents**
to an HTTPS website, at either the site root or a folder such as `/along/`.
You do not need Python or Node on the production host.

Keep every file, including `data/`, `vendor/`, the icons, licence notices and
`.nojekyll`. The four gzip data bundles are required for the complete offline
experience. Serve `.json.gz` as `application/gzip` without `Content-Encoding`:
the app decompresses these bytes itself.

GitHub Pages: put the extracted files at the root of a deployment branch and
select that branch in Settings → Pages. Open `https://OWNER.github.io/REPO/`.

AWS: upload into your existing HTTPS apps site, or use S3 with CloudFront/Amplify.
The app folder URL must serve its `index.html`; missing data or API requests must
return real errors, not that HTML page. Allow HTML, `sw.js` and unversioned assets
to revalidate on updates. Publish the bundle together and invalidate the app's
CDN prefix when needed. Preserve the trailing slash in the app URL.

Open the hosted app, check offline readiness in Settings, then use Install app or
Add to Home Screen. A ZIP or file:// page cannot provide the installed/offline app.
The first download is around 40 MB; browser storage can be evicted.

Routes, stops, scheduled times and AT route geometry run locally. Online street
backgrounds are optional requests to OpenStreetMap, not an offline tile archive.
Allow https://tile.openstreetmap.org in img-src if setting a Content Security Policy.

Live predictions and alerts require a separate authenticated backend at the app's
api/predictions and api/alerts paths. Never put an AT API key in this directory.
Without that backend, Along uses labelled schedules. It does not show live vehicles.

Moving to another hostname does not transfer saved journeys: storage is local to
that browser and origin. Current coverage, accessibility and schedule limitations
are explained in the app. Keep LICENSE, NOTICE.md and vendor licences when sharing.
