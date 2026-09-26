# Version 46 — candidate preparation

**Not published.** The public app is still verified v45. This record will be
completed only after v46 passes full qualification, packaging and public checks.

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
