# Data imports and coverage

Run the commands in the README from the repository root. Python's standard
library handles GTFS and addresses. `requirements-import.txt` pins pyosmium for
street preprocessing. The browser does not require Python or pyosmium.

| Input | Output | Transformation |
| --- | --- | --- |
| AT `gtfs.zip` | `transit.sqlite`, `network.json.gz`, `routes.json.gz` | Stops, routes, calendars, exceptions, trips, transfers and timed connections and published trip shapes |
| LINZ-derived public address service | `addresses.json.gz` | Current Auckland addresses inside the configured bounding box |
| BBBike `Auckland.osm.pbf` | `streets.json.gz` | Directed walking graph, names, cost and mapped barrier flags |

See [source licences](../NOTICE.md). Do not combine the licences into a claim that
all data is MIT licensed. The downloadable build includes each complete derived
bundle, with its source attribution and transformation instructions.

## Order and refresh

1. Import GTFS. The importer atomically replaces the database and exports the
   browser timetable and route-geometry bundles. It needs temporary disk space as well as the final database.
2. Import addresses before streets. With the separate LINZ address bundle present,
   the street importer omits its redundant OSM address list, reducing download size.
3. Import streets from the downloaded PBF.
4. Run tests against dates covered by the feed. Build and deploy the complete
   public directory. Keep the old deployed bundle until verification succeeds.
5. Users choose **Update downloaded timetable** to fetch the host's current data.
   App assets update separately through the service worker.

The address importer caches downloaded pages as `data/addresses-*.json` so an
interrupted import can resume. To intentionally refresh from the upstream service,
move those cached pages to a dated archive directory before importing again. Do
not mix archived and fresh pages from different snapshots. Upstream services can
change during pagination; preserve the completed output used for a release.

All three input sources change over time. Reproducible *behaviour* requires
preserving the exact source files/bundles, not merely rerunning a latest-data URL.
`build-info.json` records output hashes and sizes. Keep original source snapshots
with your release archive if you need to reproduce the transformation exactly.

## Coverage and data assumptions

Street/address bounds: west 174.45, south −37.15, east 175.05, north −36.66.
This is urban Auckland, not the whole Auckland region. Address labels include
suburbs. Coordinates identify address points, not necessarily entrances.

Transit service dates come from feed metadata, calendars and exceptions. GTFS
hours above 24:00 belong to the previous service day. Searches use Auckland local
time, independent of the device time zone.

GTFS wheelchair value 0 is unknown. A child stop can inherit confirmed access
from its parent, but absence of a confirmation is never treated as confirmation.
The currently imported feed has no positively confirmed stop/trip values.

Street flags cover selected mapped steps, barriers, narrow ways and steep slopes.
They do not establish real-world wheelchair access. Short graph access links,
station transfers and building entrances remain estimates.

## Runtime and deployment details

The four gzip JSON files are raw assets, not HTTP content-encoded responses.
Hosts must not add `Content-Encoding: gzip` to these files; the worker's
`DecompressionStream` expects the gzip bytes. Do not configure a SPA fallback
that returns HTML for missing data or JavaScript files.

Browsers store decoded data in IndexedDB. A failed download leaves an existing
usable walking map in memory; a page reload restores the last stored bundles.
Network, street, address and route-geometry updates are not a single atomic database transaction.
Do not publish incompatible schema changes without an app migration.

Route geometry is exported from the same GTFS ZIP by `export_route_geometry.py`,
called by `import_gtfs.py`. For an existing timetable import, run
`python3 scripts/export_route_geometry.py data/gtfs.zip data/routes.json.gz`.
Use the matching ZIP: shape references use exact trip IDs. The geometry bundle is
approximately 2.53 MiB compressed and is downloaded into IndexedDB. If unavailable,
route lists remain usable and maps show stop positions without an invented path.


## Original stop visit identities

New GTFS imports retain each connection's original boarding `stop_sequence` in a
separate SQLite `connection_sequences` table. The browser export adds an optional
`connectionSequences` array aligned one-to-one with the seven-value connection
records. Sequence values come from GTFS; they are not row numbers or inferred
positions. Existing connection fields and the version-1 format remain intact.
Old databases export without this optional field, and old downloaded bundles
continue to plan journeys normally.

The planner carries the source sequence into nearby departures, stop boards and
journey legs. Live matching can distinguish repeated visits using that sequence,
while also checking the stop ID when the live record supplies it. Without a
verified sequence, a repeated stop still retains its scheduled time. A sequence
conflict is not silently retried as a stop-ID-only match.

## Operator and direction identities

New imports retain route agency IDs and trip direction IDs in `route_agencies`
and `trip_directions`. The optional browser arrays `routeAgencies` and
`tripDirections` align with `routes` and `trips`; absent values are null. Agency
IDs must exist in agency.txt. A route without an agency ID uses the sole known
agency only when there is exactly one. Directions retain explicit GTFS 0 or 1;
they are not inferred from names or route geometry.

Stop rows and journey legs carry these identities into contextual alert matching.
Older databases and downloaded bundles remain usable, but cannot match alerts
that require missing identities. Incorrect array lengths are rejected.
