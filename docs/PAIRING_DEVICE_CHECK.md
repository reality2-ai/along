# Experimental device-pairing check

This checks the standalone Along pairing lab, not the public journey app. The lab
has not yet been published: use the HTTPS test URL supplied with a verified lab
build when it is available. Do not substitute the normal Along URL. No coding,
terminal commands or AT key are required from the tester.

The test creates encrypted software group keys in this browser. It also offers
local AT-key storage testing with dummy text only. It does not sync journeys,
contact AT or enable live AT information. It is a course experiment used at your own
risk, without hardware-backed storage protection. Site code can use the keys.

## Before starting

Use the Samsung S23 and a desktop, with the same Wi-Fi network if possible. Keep
both browsers open and visible. Private/incognito browsing can prevent persistence.
Record the browser names and versions on both devices, plus the lab build identifier
supplied with the URL. A camera is optional: copy/paste remains available.

Do not clear the whole site's storage to restart this test; that could remove
Along's saved journeys as well. If either lab already reports membership in a
group, restore that state and report it instead of trying to enroll again.
A recovery path is available for an installation whose receipt was retained by
the inviting device; it is not a general repair or group-management tool.

## Pair the devices

1. On each device, open the lab, choose **Set up this test device**, read the
   browser-storage limits, then choose **Create my device group**. Choose
   **Restore saved test device** when the home screen returns.
2. On desktop, choose **Invite my other device**. On the S23, choose
   **Join my other device**. The invitation lasts one minute; have both devices
   ready before beginning. Report if that is too short.
3. Transfer the invitation from desktop to the S23. You can choose **Show QR code**
   on desktop and **Scan invitation QR code** on the phone. Camera permission is
   requested only when scanning. Alternatively, use copy/paste through a method
   you already trust. Review the invitation and confirm it came from your device.
4. Follow the prompts to send the phone's challenge to desktop, desktop's reply
   to the phone, the phone's connection details to desktop, and desktop's connection
   reply to the phone. QR scanning fills a field; choose the indicated review/check
   action afterwards. Connection details can include network addresses. Do not post
   these messages publicly.
5. Choose **Compare device codes** where shown. Check every character on both
   screens. Confirm only when both devices are physically with you and match.
   Otherwise choose **Cancel — codes differ or I’m unsure**.
6. Keep both pages open. The phone should show **Device connected**. Desktop should
   show **Other device installed** and say confirmation was sent. These are separate
   outcomes; report the exact wording if either differs.
7. Reload both pages, choose **Restore saved test device**, and check that the phone
   still reports membership with installation confirmation. No invitation or
   additional enrollment should be needed to display that saved state.

## Usability and cancellation

Before confirming any comparison, try Back or **Stop scanning** on one device.
Check that camera use stops and that a late permission response does not restart
scanning. On desktop, try keyboard-only controls and 200% zoom. On the S23, note
whether the next action requires awkward scrolling or whether QR codes are too
small or dense to read. Unsupported camera scanning should leave copy/paste usable.

After cancellation, start a new invitation only if the receiving device still has
its initial identity. If the screen says its group was saved locally but confirmation
failed, preserve the saved state; do not keep trying to enroll it. Return home and
restore both saved devices. On the joining device, choose **Recover installation
confirmation**. On the device that invited it, choose **Confirm an interrupted
connection**. Transfer the recovery message and reply, then choose **Check
installation confirmation** on the joining device. Keep both screens open.

The joining device should say **Installation confirmed**; the inviting device says
**Installation confirmation sent**, which alone does not prove receipt. If the
original installation receipt was never saved on the inviting device, this recovery
cannot confirm it. Preserve the data and report the result. Recovery does not
replace identities, enroll devices or grant AT-key access.

TalkBack is a separate check. If tested, enable it through Android Settings →
Accessibility → TalkBack (menu labels may vary; see
[Google’s TalkBack guide](https://support.google.com/accessibility/answer/6007100?hl=en)), then try field labels, status
announcements, review, Back and code comparison. Report TalkBack as **not tested**
if you only used ordinary touch interaction.

## Check local AT-key storage with dummy text

After pairing, return home, restore the device, and choose **Test optional AT-key
storage** → **Set up live information**. Enter `along-test-key` as dummy text and
choose **Save key on this device**. Do not use a real AT key in this experiment.
Saving should report that the key has not been checked with AT.

Reload, restore the device, and reopen the same settings. It should report that
an AT key is saved without displaying its value or asking you to create settings
again. This does not share the key with the other device or fetch live information.
The reset below also removes these local test credentials and settings.

## Restart only the lab test

After recording results, return to the lab home screen and choose **Remove this
test device data…** only if you want to discard this test identity. **Keep this
test device** backs out without removal. Read the confirmation, close other lab
tabs, then confirm removal. If another tab holds storage open, the lab waits;
it does not claim success. Once started, removal cannot be cancelled.

After **Test device data removed**, choose **Return to setup**. Along’s saved
journeys and offline timetable should remain available. Other devices retain
their data: this is local deletion, not remote membership or AT-key revocation.
Do not use it as recovery for an interrupted installation you want to preserve.

## Report results

Report the lab build, both browsers, whether the devices shared Wi-Fi, and the last
screen reached. Mark setup, pairing, reload/restore, QR scanning, camera stop,
keyboard/zoom and TalkBack as passed, failed or not tested. Describe what you
expected and what happened. Do not include invitation text, connection details,
keys, saved journeys or precise location in public feedback.

A same-host automated browser pass does not establish phone-to-desktop reachability.
This direct WebRTC prototype has no signaling relay, STUN or TURN service; some
network combinations will not connect. A successful pairing also does not establish
saved-journey synchronization, AT-key sharing, current-epoch updates or device
removal behavior. Those remain separate development and verification work.
