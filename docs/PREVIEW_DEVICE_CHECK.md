# Along Device Preview: S23 and desktop check

Open [Along Device Preview](https://reality2.ai/along/preview/public/) and check
version **3805**. These instructions are for that preview, not regular version 37 or
the standalone pairing lab. No coding or terminal commands are required.

Use your Samsung S23 and desktop. Record the browser name/version on each device.
Use dummy addresses from the examples and dummy key text only. Keep the regular
Along installation. Do not clear the whole website's storage to restart a test;
that can remove data from both apps. Mark anything you cannot check as **not tested**.

If preview 3801, 3802, 3803 or 3804 is already installed, open
[preview update recovery](https://reality2.ai/along/preview/public/update.html)
and choose **Update and reopen**. Check that saved places and setup remain and
Settings shows 3805. Do not recreate an existing group to test an update.

## Reported timeout — investigation pending

The user reports repeated timeouts when attempting the earlier preview check.
The user clarified that scanning the QR code and choosing the action to use it
produced no visible progress, eventually timing out. The exact screen, installed
version, browsers and network are not yet confirmed; this is not a passing
pairing or sharing check. Preserve device data. If a timeout
occurs, record the screen title and error wording, whether both devices were on
the same Wi-Fi, and browser/version on each. Do not publish connection messages
or keys. The current preview has no relay fallback; optional user-selected relay
support is approved for development, but is not deployed.

Development checks found a separate candidate-side expiry gap: its proof timed out
internally while the screen continued waiting. The source now reports the unfinished
step and shows the return QR immediately after Use. A narrow-screen Chromium test
covers simulated scan → review → Use, visible return QR, expiry without identity
changes, and a successful retry through actual enrollment. Camera input is mocked;
this does not establish the cause of the S23 report. These fixes are not in the
published 3805 preview yet.

## Install and plan offline

1. Open the supplied preview URL in the browser used for installation. In Settings,
   check **App version 3805 · Device preview** and wait for timetable and addresses
   to be ready offline.
2. Follow the preview's **Install on your device** guide. The installed name is
   **Along Device Preview** or **Along Preview**. Check that the icon opens its own
   window and still shows the preview version.
3. Plan 277 Broadway Newmarket → 10 Victoria Road Devonport for 23 September 2026
   at 09:00. These dates test the downloaded snapshot; they are not travel advice.
   Save the places before choosing a journey, then add a service preference.
4. Turn on flight mode, reopen the preview, and search 277 Broadway → 1 Queen Street
   Auckland Central. Pull down to refresh. Planning should work without an update
   error. Open the installation guide while offline too.

## Connect the two test devices

Return online, preferably on the same Wi-Fi network, and keep both screens open.
On each device, choose Settings → **Device and AT-key setup** → **Set up my device**
→ **Create my device group**. Read the software-storage limits before proceeding.

On desktop, open **Connect or recover another device** → **Invite my other device**.
On the phone, choose **Join my other device**. Follow the invitation, challenge,
reply and connection-message prompts. QR codes and manual copying are alternatives;
scanning fills a field, after which you choose its review/check action. Connection
messages can contain network addresses; do not post them in public feedback.

Compare every character of the displayed codes on devices you control. Confirm
only if they match. Keep both screens open until the phone reports **Device
connected** and desktop reports **Other device installed**. Reload and check that
the saved setup remains. Do not create new identities to recover an interrupted
installation; preserve the last screen and report its wording.

Version 3803 also recovers completed older enrollments from verified installation
receipts when you open the device list. Interrupted older enrollments without a
receipt can still be missing; report this as **older enrollment**, not a reason
to clear storage. The list is not a live roster and may include an interrupted
enrollment. Both devices must update before reconnecting: the new connection
messages exchange signed group removals before allowing shared access.

## Share saved places and stop sharing

1. On each device, save a different example address pair. In Settings, open
   **Share saved journeys with my devices**. Choose **Start journey connection**
   on desktop and **Join journey connection** on the phone.
2. Transfer the device message, review the device and journey-sharing permission,
   then transfer the request and reply as prompted. Choose **Use journey connection**
   on both. Close Settings and check that each device has the saved places and
   service preferences. Learning history should remain local.
3. While one device follows a journey, change a saved place on the other. The
   current route and step should stay in place. On desktop, focus a saved shortcut
   with the keyboard while removing it on the phone; it should stay under focus
   until you leave that group of shortcuts.
4. Disconnect. Offline, remove a saved place on one device and save another on the
   other. Reconnect online through the same flow. Check that the removal and new
   save both arrive. Reconnection is currently manual.
5. Open **Manage journey-sharing devices**, select a device and try Back first.
   Then review again and choose **Stop journey sharing**. Later edits should no
   longer arrive from that device. Already received copies should remain. Try
   removing the other device's saved permission after an offline reopen as well.

## Optional dummy AT-key check

In **Device and AT-key setup**, use **Use my own AT key** and save
`along-preview-test-key`. This dummy key will not retrieve live feeds. Saving it
should not display it elsewhere or claim that AT accepted it. Reload and check
that the saved key is still recognised.

To test sharing, choose **Share my AT key** on its owner device and **Receive a
shared AT key** on the other. Review each permission and transfer the connection
messages. The receiver should report **Shared AT key saved**, and the owner
**Other device saved the key**. These are separate from journey-sharing permission.
To reconnect later, choose **Connect an existing AT-key device** on both devices.
Transfer the key owner’s device message first, then the recipient’s request and
the owner’s reply as prompted. Choose **Use this connection** on both. No AT
request should occur just from reconnecting.

Do not post keys or transfer messages when reporting a problem.

## Updates, access and results

Use the preview's Settings → **Check for an app update**. With no newer release,
it should say it is already current. When a newer preview is provided, check that
the displayed version changes and saved places/device setup remain. Do not infer
a successful upgrade from a same-version check.

Try desktop keyboard-only navigation and 200% zoom. On the phone, check scrolling,
touch targets, QR scanning/cancellation and TalkBack separately. The
[existing TalkBack check](PAIRING_DEVICE_CHECK.md#usability-and-cancellation)
explains the distinction from ordinary touch use. Check labels, permission
announcements, Back, address suggestions and journey steps.

Report the version and browser on both devices, which checks passed, and the last
screen/action for any failure. These observations qualify the actual devices;
automated Chromium tests do not establish physical installation or spoken-reader
acceptance.

## Optional GitHub submission check

If you use a GitHub account, choose **Give feedback on this screen** and type a
short, non-private observation. You can label it a device-check report. Leave
optional context unchecked unless you want to share the displayed version and
general screen name. Review the exact text, open GitHub, sign in there if needed,
and choose **Submit new issue** once. Never enter GitHub credentials into Along.

Copy the resulting issue URL back into Along's feedback dialog and choose its
receipt check. It should confirm the report is in the repository. Reopen the
dialog and check that it points to the existing issue instead of inviting another
submission. If you already submitted but cannot verify receipt, keep the draft
and issue URL; do not submit again merely because verification failed. Mark this
check **not tested** if you do not use GitHub or do not want to post publicly.

## Group removal — do this last

Only test this with a disposable test pairing created in 3805. Removal stops that
device's group access; it does not remove its local journeys. Skip it for an older
enrollment missing from the list or a group you want to keep using.

1. On the device that created the group, open **Device and AT-key setup → Connect
   or recover another device → Review group devices**. Select the other device,
   inspect its identity, then try Back. No removal should be saved.
2. Select it again and choose **Save device removal here**. Check that the result
   says it is saved here and has not been delivered to the other devices.
3. Choose **Share this removal** and transfer the signed message privately. On the
   other device choose **Device and AT-key setup → Receive a group removal**,
   paste the message and choose **Check and save removal**.
4. Check that the receiver says it has been removed from the group. Reopen it
   offline: journey planning should still work, while group sharing is unavailable.
   Reopening the issuer's review should show the saved removal.

Copying alone is not delivery. Copies of journeys or keys already shared remain
on the other device; group-key updates do not erase those copies or replace an AT subscription key. Dummy keys only.


## Update group keys on your test devices

Update both devices to 3805 before connecting: the invitation and AT-reconnect
message formats changed. Keep the same saved group and AT sharing choices.

1. On the device that created the group, open **Device and AT-key setup → Connect
   or recover another device → Update group keys on this device**. Review the
   explanation, then confirm the local update. It should not claim the other
   device has received it yet.
2. Go Back and choose **Send a group key update**, then your other device. On that
   device choose **Receive a group key update** under its device setup controls.
3. Follow the starting message, update request and reply steps. On the receiving
   device review and accept the update. On the owner choose **Send update or check
   confirmation**. Check for local keys saved on the recipient and a signed
   installation confirmation on the owner.
4. Reopen both apps. Check saved places and service preferences, reconnect journey
   sharing and make a harmless saved-place edit. It should arrive on the other
   device without asking you to replace its identity or reset its permissions.
5. If you configured dummy AT-key sharing, reconnect the existing AT devices.
   A dummy key cannot produce real live data; do not report that as a failure of
   group recovery. Existing owner and permission choices should remain.
6. If the connection drops after keys are saved, start another key-update exchange.
   It should offer to confirm existing keys when both versions already match.
   Keep saved data; do not create a new group to recover a missing confirmation.

Report confusing wording, missing controls, update/reconnect failures and TalkBack
announcements. These are manual device checks; browser automation does not prove
physical installation, QR camera use or network reachability.
