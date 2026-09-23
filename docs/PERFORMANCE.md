# Performance evidence

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

## Reproduce

```sh
npm run build
npm run test:static
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
