# Version 46 — guided device recovery

**Published and verified on 26 September 2026.** Open
[Along](https://reality2.ai/along/) or download the
[v46 package](https://github.com/reality2-ai/along/releases/tag/v0.46.0).
Physical-device and public-hive acceptance remain open.

## Release evidence

- Qualified source: `41879985547457af3a0118041ea297533df78a06`.
- [Qualification](evidence/regular-v46-qualification.json): all 41 distinct cases
  passed, plus two explicitly labelled aliases; source and candidate unchanged.
- [Static browser](evidence/regular-v46-static-check.json): installation eligibility,
  keyboard/AX semantics, contrast, zoom/reflow, data refresh and offline routing passed.
- [Local source rebuild](evidence/regular-v46-local-source-rebuild.json): 314 candidate
  files matched. [Anonymous public-source rebuild](evidence/regular-v46-public-source-rebuild.json):
  313 application files matched using the public prebuilt runtime.
- [Package](evidence/regular-v46-package.json): ZIP 41,803,104 bytes, SHA-256
  `6932a00e90881cac00b0c473ba39ed2de07e368a30e9f9be31f045664e164903`.
- Pages commit `d5cee38ec1fae80a7893d2dc56d7cb0d0f6352a6`;
  [deployment 36213403609](https://github.com/reality2-ai/along/actions/runs/36213403609) succeeded.
  [All 316 served files](evidence/regular-v46-public-files.json) matched the release.
- [Public-browser check](evidence/regular-v46-public-browser.json) passed, including
  offline routing and feedback-draft retention.
- [Selected-hive probe](evidence/regular-v46-hive-probe.json) still received the host
  announcement but no protected messages in either direction. Local relay checks
  do not establish public interoperability.

See the [S23/desktop checklist](DEVICE_CHECK_V46.md). The earlier failed and
interrupted runs below are retained as historical evidence, not release approval.

## Change and preparation history

The candidate adds a guided group-key update for an already-connected device:
one invitation, relay review, verified update acceptance and automatic reply and
confirmation exchange. A lost final confirmation retains the recipient's local
success and can be checked using a new invitation. It also delivers issuer-signed
group-removal notices through the selected relay. Planning and direct personal-key
AT access remain independent of that relay.

The new recovery path uses independent ephemeral encryption bound to the existing
mutual identity proofs. Invitations admit connections for one minute; admitted
recovery has a separate bounded transfer window for paced signed removal lists.
No new sharing permission, AT key or device identity is created by recovery.
See [implementation and limits](../experiments/tg-pairing/AUTOMATIC_RECOVERY.md).

Focused local evidence covers automatic recovery, guided screens, full-app saved
places and offline reconciliation, refused authority, interrupted atomic storage,
256 signed removals, AT-owner renewal, and scanner/expiry controls. These checks
are being included in full candidate qualification, including installed v45 to
v46 upgrade alongside older installed versions. Source and candidate must remain
unchanged throughout that qualification.

Public-hive forwarding, physical S23/desktop installation and pairing, spoken
TalkBack and signed-in GitHub feedback observations remain separate acceptance
items. Local TLS relay tests do not prove those outcomes. No human coding is needed.

## Initial qualification and correction

The first full run completed all 41 distinct scenarios. Two installed-version
checks (v41 and v42) failed an immediate cross-tab storage read; all other distinct
checks passed, with source and candidate unchanged. The
[failed qualification](evidence/regular-v46-initial-qualification.json) is retained.

A direct Chromium diagnostic observed three delayed cross-tab reads in 300 writes,
which subsequently caught up. The unchanged app passed an instrumented v42 upgrade.
The corrected test first asserts the edit was stored by the old writer, then
requires the other tab to observe the same complete serialized snapshot before
continuing its offline/identity checks. It uses the existing polling deadline.
No production app code changed. This supports the timing explanation, but does
not establish the cause of every original failed read. See
[diagnostic evidence](evidence/v46-upgrade-observation.json).
Full qualification must pass again before this candidate can be released.

## Second qualification interrupted

The second run recorded 40 distinct results: 39 passed and the v41 upgrade
observation failed before seeing an installation worker. The environment changed
before a final report was saved; the process handle is no longer available.
The remaining relay-membership result is unverified. Preserve the
[partial results](evidence/regular-v46-second-qualification-progress.json);
they are not successful release qualification.

A controlled Chromium experiment demonstrated that an update request can join an
older in-flight check and return without observing the newly published script.
The unchanged v41 app upgrade passed with tracing. The corrected test arms its
observer before publication and retries only no-op checks within the original
30-second deadline. It requires an actual injected download failure and the
worker's redundant state, retaining the offline, identity and saved-data checks.
Its focused v41 run passed. See [evidence](evidence/v46-update-job-observation.json).
This supports a possible race explanation, not definitive attribution of the
original failure.

The session temporarily had read-only Git metadata and could not reach the
GitHub API or bind a local test server. Access has since returned. The correction
and evidence are being committed for a fresh full qualification; do not publish
this candidate using the partial results. At that stage the last verified public release
remained v45; the completed release evidence above supersedes that status.
