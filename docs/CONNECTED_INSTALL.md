# Install Along and use it offline

**Use at your own risk.** Along is an experimental AI-coding course app, not an
official Auckland Transport service. Check important journey and accessibility
information with AT.

Check the installed app version in Settings. These instructions describe the
current guided device connection; older versions may show different controls.
Along Device Preview is a separate installation; its saved places and device
keys are not imported automatically. Do not clear website data to update: that
can erase saved places and device keys.

## Prepare and install

Open Along in the browser you intend to use for installation. Wait until the
timetable and addresses are ready offline, then follow your platform's steps
below. Open the installed app and try a new address search in flight mode.
The web portal provides downloads and updates; it does not calculate journeys.
Downloaded address search and scheduled planning run on your device.

<!-- platform-guide -->

## Scheduled journeys, optional current information

By default, departures and journey times come from the downloaded timetable.
They do not show where a bus or train is now, and may not reflect delays,
cancellations or changed services. Along labels current information separately
when it can obtain and match it. An unavailable or unmatched live result leaves
the schedule in place; it does not mean the service is on time.

To choose live information, open **Settings → My devices**. On a device without
setup, choose **Set up my device**, read the storage explanation and choose
**Create my device group**. Then choose **Use my own AT key** and
**Set up live information**. If this device already has a group, use its existing
setup; do not replace it. You do not need another device or a relay to use your
own key.
You need your own Auckland Transport API subscription key. Browser requests go
directly to AT; AT receives your IP address and the key. There is no Along live-data
proxy. The key is stored encrypted in this browser's device setup. Clearing site
data can remove access. The offline planner does not require a key.

Current information is requested for the stop, journey or route you are viewing.
It is not a background location tracker. Use the official AT app or website when
you need information that Along cannot verify.

## Keep your data on your devices

Search history and current location stay on your device. Saved places and service
preferences are shared only when you connect your devices and permit journey
sharing. Device pairing and permission to share are separate steps. No Along
server stores your journeys. Feedback sent to GitHub is public: review the draft
before choosing to send it.

Device keys use encrypted browser software storage. This is a limited R2 subset,
not hardware-backed protection or protection from a compromised browser or scripts
on the same website. Keep backups you control; browser storage can be removed by
the browser, operating system or a person clearing site data. A removed device
may retain previously received data. Revocation takes effect when another device
learns the signed update. Replace a compromised AT key through AT itself.

## Connect another device when you want to share

Device connection is optional. Keep both devices online with Along open. On the
inviting device, open **Settings → My devices → Connect another device**. Choose
your compatible secure `wss://` R2 relay and **Create invitation**. Review the
storage explanation first; on a fresh device this action creates its local group.
No relay is selected by default.

Scan the invitation on your other device or open its invitation link there.
Review the displayed relay, then choose **Connect and compare codes**. Compare
every character on both screens and confirm only when the codes match and both
devices are yours. The app exchanges the return messages; there is no return QR
to scan. Wait for **Device connected** on the receiving device and **Connection
saved** on the inviting device.

Choose **Choose what to share**, then **Share and reconnect** on both devices to
permit saved-place and service-preference sharing. This does not grant access to
your AT key. An already-connected receiving device can require recovery instead;
keep its existing data and use **Advanced device options** rather than creating a
replacement group. Invitation links and QR codes are private; do not post them
in public feedback.

## Reconnect and control sharing

After granting sharing permission, permitted devices reconnect through your
selected relay while both apps are open and online. To review its address or stop
it, open **Settings → Share saved journeys with my devices → Automatic connection
with a relay**. **Stop automatic relay sharing** keeps the address for later;
**Remove relay address** clears that choice. Both preserve saved places.

A relay connection alone is not proof that the other device received your saved
places; look for its saving confirmation. Offline edits stay local until
reconnection. Mobile browsers can suspend background apps. Recovery choices and
devices at different checkpoints may need an explicit review before sharing
continues. If connection fails, return to your journey; downloaded planning still
works. Do not clear storage to retry.

Compatibility depends on the selected relay actually forwarding protected
messages; accepting a connection is not enough. Local relay tests do not establish
that a public endpoint or a particular mobile network works.

A relay sees your network address, routing identifiers, traffic timing and message
sizes. Shared journey payloads are encrypted between permitted devices. Journey
sharing does not send your AT key, learning history or current location. Planning
and direct AT requests work independently of the relay.

## Update and reopen

Use **Settings → Check for an app update** or the app's `update.html` page in the
same browser used to install it. Choose **Update and reopen**, then reopen the
installed app and check its version. Pulling down to refresh also checks for an
update; offline checks stay quiet. Saved places and downloaded travel data should
remain. If an update fails, keep the existing app and retry online.

**Forget history and saved places** clears those local choices. When journey
sharing is enabled, saved-place removals are also shared with permitted devices
when connected. This is different from removing a relay address.
