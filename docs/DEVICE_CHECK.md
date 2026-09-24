# Along 42: short S23 and desktop check

Use the regular app at <https://reality2.ai/along/>, not Device Preview.
No coding is needed. Start with pairing; report that result before attempting
the remaining checks if anything is confusing.

## Update both devices

In the browser used to install Along, open
[Update Along](https://reality2.ai/along/update.html), follow the update prompts,
and reopen the installed app. Check **App version 42** in Settings on both devices.
Record the browser names. Preserve existing saved places and device setup; do not
clear site storage or create replacement groups to retry an interrupted connection.

## Retry the step that timed out

Keep both devices online, preferably on the same Wi-Fi, with both screens open.
Open Settings → **Device and AT-key setup**. For a device without setup, choose
**Set up my device** → **Create my device group** and read the storage limits.
For an existing setup, continue with it.

On desktop choose **Connect or recover another device** → **Invite my other device**;
on the S23 choose **Join my other device**. Follow the QR/message prompts.
After the phone scans and you choose **Use**, a **return QR** should appear for
the desktop to read. Scanning the first QR is not the completed connection.
Continue through the prompts, compare every character of the displayed codes,
and confirm only if they match on your own devices. Completion should say
**Device connected** on the phone and **Other device installed** on desktop.

If it stalls, report the screen title, last button pressed, visible message,
browser names and whether both devices were on the same Wi-Fi. Do not include
QR codes, connection messages or keys in public feedback. The return-QR fix has
browser-test coverage; the original S23 timeout is not yet confirmed resolved.

## Then check sharing and offline use

Save a different example journey on each device. In Settings choose
**Share saved journeys with my devices**, then **Start journey connection** on
desktop and **Join journey connection** on the phone. Transfer and review the
messages as prompted and choose **Use journey connection** on both.
Check that both saved places and chosen service preferences arrive. Reload and
check that setup remains. History should stay local.

After the timetable and addresses are ready offline, enable flight mode and
reopen Along. Try a new search, such as 277 Broadway Newmarket → 1 Queen Street
Auckland Central, and pull down to refresh. Scheduled planning should still work
without an update error. Reconnect before expecting changes from the other device.

The older relay protocol can reconnect permitted devices in local tests.
Integration with the current R2 hive is still being checked; leave relay setup
alone until a compatible endpoint has been verified.
It needs an explicitly chosen endpoint; none is configured by default. It does
not replace the initial pairing exchange above. No real AT key is needed here.

## Accessibility and report

On desktop try keyboard-only use and 200% zoom. On Android, if you can test
TalkBack, check address suggestions, journey steps, opening a stop and Back.
Record actual spoken or navigation problems; ordinary touch use is a separate
check. Mark checks you cannot perform **not tested**.

Report: version and browser on each device; whether the return QR appeared;
whether pairing completed; whether saved places/preferences arrived; offline
reopening; and accessibility results. A partial result is useful.


## Removing shortcuts

On the home screen, open **Manage shortcuts** and use **Remove shortcut** for a
test journey. Confirm it disappears and stays absent after reopening offline.
Other saved journeys should remain. Removing only **Preferred services** inside
a journey keeps the saved places; that is a different action.


## Arrive by and removal from journey options

Plan 277 Broadway Newmarket → 10 Victoria Road Devonport for 23 September 2026,
**Arrive by 09:00**. Confirm the summary says Arrive by, the itinerary includes the
walk to the address, and the final arrival is before 09:00. This is a fixed test
snapshot, not current travel advice. Try switching back with Set departure to now.

Open a saved home shortcut and choose **Remove this shortcut** below the journey
choices. The journey options should stay usable, and the shortcut should remain
absent when you reopen offline. No coding is needed.


## Optional feedback submission check

If you can use a GitHub account, open **Give feedback on this screen** in regular
Along and type a short synthetic report such as “Device acceptance test — no bug
reported.” Leave optional context off and include no personal addresses, keys or
connection messages. Review the body and choose the GitHub action. On GitHub,
sign in if needed and deliberately submit the issue; opening the composer alone
is not submission. Return to Along, paste the new issue URL into its receipt
check, and verify that it opens the existing report instead of offering a new one.
If already submitted, check the existing issue before retrying. Report its issue
number so the maintainer can identify and close the test. This creates a public
issue; skip it and report **not tested** if you do not want to submit one.
