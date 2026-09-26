# Version 46 device check

Version 46 is published. The selected public hive still fails message forwarding;
wait for its verified repair before trying the connection steps below. Installation,
offline planning and accessibility checks can be tried now. No coding is needed, and no QR contents, connection links or API keys should be included in reports.

Update the installed app in its original browser
and check **App version 46** in Settings on the S23 and desktop. Record both browser
names. Keep existing saved places and device data; do not clear storage to retry.

1. On the device managing your connection, open Settings → **My devices** →
   **Connect another device**. Choose your verified relay and **Create invitation**.
   On a fresh device this also saves its connection keys; no separate group-creation
   screen is needed.
2. On the other device, scan that invitation or open its invitation link. Review
   the displayed relay, then choose **Connect and compare codes**. There should be
   no return QR or connection message to copy.
3. Compare every character on both devices. Confirm only if they match and both
   devices are yours. Wait for **Device connected** on the receiving device and
   **Connection saved** on the inviting device.
4. Choose **Choose what to share**, then **Share and reconnect** on both. Confirm
   that saved places and service preferences appear on the other device. An AT
   key should not be shared by this choice.
5. Go offline on one device, change a saved place, and reopen offline. Restore
   connectivity with both apps open; check that the change arrives without another
   invitation. Also try different networks, such as phone mobile data and desktop
   Wi-Fi, after the same-network check succeeds.

For an already-connected device needing updated group keys, use its entry in
**My devices** and create an update invitation. Open or scan it on that existing
device, review the selected relay and choose **Connect and review update**.
Follow the approval steps; no return QR or manual key message should be needed.
Check that saved places remain and the owner sees confirmation. If confirmation
is lost, report the exact message; keep the receiving device's saved data.
Do not create a replacement group or share invitation contents in your report.

On desktop, try keyboard-only operation and 200% zoom. On the S23, check that
the main action is visible and comfortably tappable. For TalkBack, open Android
Settings → Accessibility → TalkBack and enable it. Touch explores controls;
swipe left/right moves focus and double-tap activates the focused control.
Repeat invitation review, code comparison, sharing and Back. Disable TalkBack
from its settings when finished. Mark any check you did not try as **not tested**.

For a failure, report the screen heading, last action and visible message,
whether devices used the same network, and whether a saved place was retained.


## Optional feedback submission check

When signed in to GitHub, open **Give feedback on this screen**, enter a brief
synthetic test report without private addresses, keys or invitation contents, and
review it. Continue to GitHub and choose **Submit new issue**. Copy the resulting
issue URL back into Along to check its receipt. Reopen offline and check that the
receipt is retained. Report the public issue number so the AI can review and close
the synthetic report. If you do not perform the final GitHub submission, mark this
check **not tested**; opening the composer alone does not count. No coding is needed.
