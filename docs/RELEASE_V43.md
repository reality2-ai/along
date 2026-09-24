# Along version 43

Access and transfer searches now calculate walking times without constructing
unused predecessor paths. Displayed walking directions still reconstruct their
full paths. This reduces temporary allocation while retaining journey choices.

[Allocation evidence](evidence/routing-path-allocations.json) records over 99.9%
fewer predecessor entries in the first arrival search, with 5.345 s before and
3.819 s after in that desktop run. Retained heap stayed near 236 MB. This is not
a phone benchmark, a guarantee of speedup or a reduction in downloaded data.
Three complete arrival itineraries, including walking geometry, match v42 exactly;
three transit legs match the original GTFS independently. All 80 unit tests pass.

## Release evidence

- Source: `8da1a5533b1e45290192c0d2917906a6ce4a3af8`.
- [Qualification](evidence/regular-v43-qualification.json): 23 distinct scenarios
  plus two labelled aliases, including installed v37–v42 upgrades, arrival routing,
  sharing and group/credential recovery. Source and candidate remained unchanged.
- The initial runner stopped after the user's exit/resume. Its missing process
  handle and absent runner were confirmed. Seventeen completed passes were
  retained only after source, candidate and log hashes matched; six unfinished
  scenarios ran again, preserving interrupted logs. No interrupted case counted
  as passed. The final complete qualification succeeded.
- [Static checks](evidence/regular-v43-static.json): offline planning, update and
  storage failures, keyboard, axe and narrow layout.
- [Package](evidence/regular-v43-package.json): 285 payload files; ZIP 41,719,126 bytes,
  SHA-256 `38ce5497bfa2bc324ffc109e48925b10b9b6f8749f5c04f338bc16985188bfd8`.
- Pages commit `1c724f4946eff29284fc22c444841ac63f4fefe2`;
  [deployment](https://github.com/reality2-ai/along/actions/runs/36064492132).

The [286-file public comparison](evidence/regular-v43-public-files.json) and
[fresh public browser](evidence/regular-v43-public-browser.json) both pass. The
GitHub release is published; uploaded ZIP digest and length match the local package.

The [isolated public-source rebuild](evidence/regular-v43-public-source-rebuild.json)
reproduces all 283 application files byte for byte. It uses the verified public
runtime archive; runtime compiler reproduction has separate evidence. Packaging
metadata and physical-device behaviour are outside that comparison.

## Remaining limits

See the [goal audit](RELEASE_CHECKLIST.md) and [device guide](DEVICE_CHECK.md).
Physical S23 pairing/performance, current installation and TalkBack acceptance
remain unverified, as does signed-in interactive GitHub feedback submission.
Legacy relay tests establish only compatibility with the older implementation;
[current R2 hive integration](R2_CURRENT_STANDARD_REVIEW.md) is still pending its
browser transport contract. Group updates retain explicit transfer flows. There
is no default relay, and offline planning is independent of it.

Experimental AI-coding course app, used at your own risk; not an official AT service.
