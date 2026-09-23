# Along Device Preview: S23 and desktop check

Candidate **3801** is prepared locally; the release URL will be supplied when it
is published. These instructions are for that preview, not public version 37 or
the standalone pairing lab. No coding or terminal commands are required.

Use your Samsung S23 and desktop. Record the browser name/version on each device.
Use dummy addresses from the examples and dummy key text only. Keep the regular
Along installation. Do not clear the whole website's storage to restart a test;
that can remove data from both apps. Mark anything you cannot check as **not tested**.

## Install and plan offline

1. Open the supplied preview URL in the browser used for installation. In Settings,
   check **App version 3801 · Device preview** and wait for timetable and addresses
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
