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
