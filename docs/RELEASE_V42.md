# Along version 42

Choose **Leave at** or **Arrive by** under journey timing. Arrival searches work
backwards from the deadline, including the final walk to the destination, and
show latest departures first. The search remains bounded to four hours and three
changes. Transit times are scheduled; walking connections are estimates.

Open a home shortcut and choose **Remove this shortcut** below the journey choices.
This removes that saved pair, preferred services and its local learning history,
while keeping the current journey options available. Other journeys remain.
The existing home management disclosure is still available. A failed storage
write retains the shortcut and reports the failure; successful removal restores
keyboard focus and remains removed after offline reopening.

## Evidence

- Source: `0c3b5446f0bcfd3abfd6969a57be76f91505cc73`.
- [Routing checks](evidence/arrive-by-routing.json): 79 unit tests, including 11
  arrival cases and a 35-network exhaustive comparison; exact deadlines,
  transfers, pickup/dropoff rules, preferred services, accessibility, directed
  walking, calendars and overnight service identities. Three representative
  address journeys meet their deadlines; three transit legs independently match
  the original AT GTFS ZIP.
- [Qualification](evidence/regular-v42-qualification.json): 22 distinct scenarios
  pass against unchanged source and candidate. Includes the new real-data offline
  arrival/removal flow, installed upgrades from v37–v41, sharing, credential
  recovery, membership changes and actual relay reconnection on loopback.
- [Static checks](evidence/regular-v42-static.json): existing Leave-at offline
  routing, data refresh, shortcut management, failed writes, keyboard, axe,
  zoom and narrow layout.
- [Package](evidence/regular-v42-package.json): 285 payloads, ZIP 41,718,843 bytes;
  SHA-256 `c41b2e06cab600d14b0365f527117c75fb90f193c3d2c5db9067b13ab3096f6d`.
- [Public files](evidence/regular-v42-public-files.json) and
  [fresh public browser](evidence/regular-v42-public-browser.json) cover the deployment.
- Pages commit `8462ef7d1a0e0dfc3c979a06d15c480f7ec96cb4`;
  [deployment](https://github.com/reality2-ai/along/actions/runs/36061651167).

The first focused UI check found that the timing selector did not expose the
expected accessible name. Explicit label association corrected it before the
passing qualification. The independent unit test for an unreachable reversed
walking path was corrected to expect the planner's existing no-connected-stops
error rather than an empty result.

## Use and remaining limits

Open [Along](https://reality2.ai/along/), [update an installed copy](https://reality2.ai/along/update.html),
or download the [v42 release](https://github.com/reality2-ai/along/releases/tag/v0.42.0).
Confirm version 42 in Settings and follow the [device check](DEVICE_CHECK.md).
Phone performance, the new contextual action, physical pairing and TalkBack need
physical acceptance. Desktop Node memory/timing measurements are attached to the
routing evidence; they are not phone benchmarks.

The server's AI owns relay setup. The user reported it working, but an exact
compatible public WebSocket URL has not been supplied or verified here. The
previously inferred /r2 path still returned 404 when checked. The user subsequently clarified that this relay protocol is from an older R2
iteration; see the [current-standard review](R2_CURRENT_STANDARD_REVIEW.md).
No relay is selected by default. Group security updates retain their explicit transfer flows.
Feedback's signed-in GitHub submission step remains an acceptance check.
See [Building Along](BUILDING.md) for setup and scoped historical reproduction
checks; v40 byte-for-byte results are not claims of v42 reproduction.

Experimental AI-coding course app, used at your own risk; not an official AT service.
