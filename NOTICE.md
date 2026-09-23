# Data sources and redistribution notices

Along is independent. No source organisation endorses its routing results.
The MIT licence for original code and teaching material does not relicense the
following datasets. Public builds include these transformed databases in full.

## Auckland Transport

Source: [official GTFS download](https://gtfs.at.govt.nz/gtfs.zip).
[AT's GTFS page](https://at.govt.nz/about-us/at-data-sources/general-transit-feed-specification/)
identifies the work as [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Attribution: Auckland Transport.

Changes: schedules are converted to SQLite and compact JSON connection arrays;
stop, trip, calendar, transfer and accessibility fields are selected for local
routing. `data/network.json.gz` is the redistributed transformed schedule.
Realtime API access is separate and subject to the
[AT API terms](https://dev-portal.at.govt.nz/api-terms-of-use).

## OpenStreetMap

© OpenStreetMap contributors. Source: the
[BBBike Auckland extract](https://download.bbbike.org/osm/bbbike/Auckland/).
The source and derived walking database are available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
See [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).

Changes: selected walkable ways become directed edges, with compact coordinates,
street names, time estimates and mapped accessibility flags. The complete derived
database is distributed as `data/streets.json.gz`, including in the public ZIP.
`scripts/import_streets.py` documents the transformation. Preserve attribution,
licence notices and the ODbL terms when redistributing or adapting this database.

## LINZ addresses

Sourced from the LINZ Data Service and licensed for reuse under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Crown copyright — Toitū Te Whenua Land Information New Zealand.
Canonical dataset: [NZ Addresses](https://data.linz.govt.nz/layer/123113-nz-addresses/).
The importer uses the public
[ArcGIS mirror](https://www.arcgis.com/home/item.html?id=3632c8130f034ff8bbfb122a50533550),
whose item metadata names LINZ and the CC BY 4.0 licence.

Changes: current Auckland address points are geographically filtered, rounded to
six decimal places and reduced to ID, address, street and coordinates.
`data/addresses.json.gz` contains the transformed address database. Address
coordinates are not verified entrances or evidence of an accessible approach.

## Build provenance

`build-info.json` in the static build records the build time, dataset hashes and
byte sizes. Keep source snapshots and generated bundles for reproducible releases;
downloading the latest upstream feed later may produce different results.

## Map renderer and optional street tiles

Leaflet 1.9.4 is distributed under its BSD 2-Clause licence; see
`public/vendor/leaflet/LICENSE`. AT trip shapes provide offline route geometry.
Optional online street tiles are © OpenStreetMap contributors (ODbL). Normal
viewport requests use browser HTTP caching; no tile download or offline tile
archive is offered. See https://operations.osmfoundation.org/policies/tiles/.
