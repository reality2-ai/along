# Performance evidence

Version 39 retains the v38 datasets. Its [static check](evidence/regular-v39-static.json)
records measurements with concurrent qualification jobs; these are not a controlled
comparison or phone benchmark. The earlier results below retain their versions.

## Version 38

The [repeatable v38 static check](evidence/regular-v38-static-harness.json) on
25 September 2026 observed 7.59 seconds to offline-ready, 3.92 seconds for the
first Newmarket–Devonport search, and 2.76 seconds for offline reopening.
Compressed datasets total 41,308,937 bytes; browser-reported storage was
71,704,094 bytes. This is one local Chromium desktop run, not a phone or network
benchmark. Earlier v38 qualification ran alongside other jobs and recorded
different timings; do not infer an application speedup from this difference.

To reproduce, prepare the current candidate using [Building Along](BUILDING.md),
then run `REGULAR_CANDIDATE=1 CHROMIUM_PATH=/path/to/chromium npm run test:static`.
The measurements record the candidate manifest hash. Main-page transfer bytes
exclude worker dataset downloads and are not total download size.

## Historical version 17

Measured on 23 September 2026 using Chromium 151.0.7922.34 on the development
Linux desktop, local static HTTP serving under `/along/`. This is not a mobile
benchmark or a network-speed prediction. Raw results are in
[version 17 evidence](evidence/contextual-maps-v17.json).

| Measurement | Observed result |
| --- | --- |
| Compressed public datasets | 40,103,271 bytes (38.25 MiB) |
| Downloadable ZIP, including interface/notices | About 38.0 MiB |
| Fresh browser profile to offline-ready | 5.68 seconds |
| Offline reload to ready | 2.45 seconds |
| First Newmarket→Devonport mixed-mode search | 3.40 seconds |
| Browser-reported stored data/cache usage | 68,531,691 bytes (65.4 MiB) |

Worker fetches do not appear in the main page's Resource Timing list. The smaller
`mainPageResourceTransferBytes` value in the report is **not** the total download;
use the sum of dataset bytes plus interface resources. Storage usage is the
browser's reported accounting, not a guarantee of free disk space or peak memory.

An earlier, pre-map Node diagnostic loaded the three routing datasets concurrently,
constructed the graphs and planned train/ferry, bus and walking examples. Before
forced garbage collection it used approximately 740 MiB of JS heap and 1.03 GiB
resident memory; after collection the retained JS heap was approximately 214 MiB,
with about 106 MiB of ArrayBuffer storage. Resident memory stayed much higher
because the runtime retained allocated pages. This diagnostic is deliberately
recorded as a warning about memory demands, **not a measurement of Android or the
browser worker's peak**. Browser loading is sequential and engines differ.

## Limits and next decisions

Initial parse/decompression and graph construction can stress low-memory phones.
The physical Android test must check whether the app closes/reloads, how long
first preparation takes and whether routine use stays responsive. The current
measurements justify keeping work in a Web Worker; they do not demonstrate that
WASM is necessary or that every phone can run the full Auckland dataset.

If device evidence shows unacceptable cost, first profile JSON parsing, address
indexing, graph-grid construction and retained transfer caches. Consider smaller
regional datasets or more compact on-disk formats before adding a second runtime.
A WASM implementation should be compared against the same journeys, memory limits
and offline behaviour, with correctness and accessibility unchanged.

## Reproduce the legacy planner checks

```sh
npm run build:legacy
npm run test:static:legacy
node --expose-gc scripts/check_real_journeys.mjs
python3 test/check_gtfs_journeys.py
```

Set `CHROMIUM_PATH` for an existing browser. Preserve the bundles and
`build-info.json`: a later live source download is a different benchmark input.

## Interpretation across releases

Earlier measurements are retained in [static-metrics.json](evidence/static-metrics.json),
[data-refresh-metrics.json](evidence/data-refresh-metrics.json) and
[version 15 evidence](evidence/guided-interface-v15.json). These individual runs
are not a controlled performance comparison. The older memory diagnostic excludes
route geometry and Leaflet, and must not be cited as a version 17 peak estimate.
The geometry adds approximately 2.53 MiB compressed. Online street tiles are
additional network traffic only when the person explicitly enables that background.

## Version 36 dataset

The enriched timetable increases total compressed datasets to 41,308,937 bytes
(39.4 MiB). [The Chromium static-host check](evidence/static-v36-metrics.json)
measured about 70.6 MB of browser storage. Timings in this run were collected
while other release browser checks ran on the same machine, so they are not a
controlled speed comparison or a phone performance claim.


## Version 37 regression measurement

The [local static rebuild check](evidence/release-v37-recheck.json) observed 5.75
seconds from a fresh profile to offline-ready, 2.49 seconds for offline reopening,
and 3.40 seconds for the Newmarket–Devonport mixed-mode search. Chromium reported
70,563,618 bytes of browser storage; the four compressed datasets total
41,308,937 bytes. The browser reported no installability errors.

These are single-run desktop observations, not a controlled comparison with
previous releases or evidence about Samsung S23 memory/performance. The app still
needs physical-device observations before these figures can support phone claims.


## Version 42 measurements

The [v42 static Chromium run](evidence/regular-v42-static.json) measured 7.516 s
from a fresh profile to offline-ready, 3.467 s for offline reopening and 4.439 s
for the mixed-mode departure search. Reported origin storage was 71,716,638 bytes;
the four compressed data bundles total 41,308,937 bytes. The distribution ZIP is
41,718,843 bytes. These are different quantities: installed storage is not download
size, and browser quota is not memory use.

The [arrival-routing diagnostic](evidence/arrive-by-routing.json) also records
Node memory before and after explicit garbage collection. After collection,
heap use was 234,048,144 bytes and process RSS 1,095,290,880 bytes. RSS includes
more than the JavaScript heap and is not a phone/browser peak measurement. This
large process footprint warrants physical-device measurement before making a
low-memory-device claim. It does not by itself identify a memory leak.

These are individual desktop observations, not a controlled speed comparison
between versions. The public browser verifies functional offline arrival routing;
it does not establish Samsung S23 performance. No human coding is needed to test
responsiveness: report the device/browser, journey, approximate waiting time and
any reload or lost state.


## Version 43: avoid unused walking paths

[Allocation evidence](evidence/routing-path-allocations.json) compares five
sequential searches under a 384 MiB Node heap limit. This is a desktop diagnostic,
with collection between stages; external buffers and RSS are outside that limit.
Transfer/access searches now request distances without constructing predecessor
paths. Walking directions still request and reconstruct the full path.

In the first arrival search, cumulative predecessor entries fell from 6,852,670
to 6,261; those remaining belong to displayed walking routes. The run took
5.345 s before and 3.819 s after. Retained heap after five searches stayed near
236 MB, so the demonstrated change reduces temporary allocation, not the stored
network's size. Three complete arrival itineraries, including directions and
geometry, match v42 exactly, and three transit legs pass the original-GTFS check.
The 80 unit tests include distance-only equivalence across direction, pace and
barrier profiles. These observations do not promise the same speedup on phones.
See the [v43 release evidence](RELEASE_V43.md) for qualification and deployment.
