# Install Along and use it offline

**Use at your own risk.** Along is an experimental AI-coding course app, not an
official Auckland Transport service. Check important journey and accessibility
information with AT.

This guide accompanies the local version-38 upgrade candidate. That candidate is
not yet a published release. Regular Along remains version 37; Device Preview is
separate. Do not clear website data to update: that can erase saved places and
device keys.

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

To choose live information, open **Settings → Device and AT-key setup**. Create
your device group, then choose **Use my own AT key** and **Set up live information**.
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

## Optional automatic connection

After pairing and permitting journey sharing, open **Settings → Share saved
journeys with my devices → Automatic connection with a relay**. Enter your chosen
compatible secure `wss://` R2 relay on each device. No relay is selected by default.
The actual R2 implementation has passed local tests; external endpoint and mobile
network compatibility remain to be checked.

Keep both apps open. A relay connection alone is not proof that the other device
received your saved places; look for its saving confirmation. Offline edits stay
local until reconnection. Mobile browsers can suspend background apps. Recovery
choices and devices at different checkpoints may need an explicit review before
sharing continues. Initial pairing still requires exchanging connection messages.

**Stop automatic relay sharing** keeps the address for later; **Remove relay
address** clears that choice. Both preserve saved places. A relay sees your network
address, device/group identifiers, certificates, traffic timing and message sizes.
Journey payloads are encrypted between permitted devices. This relay connection
does not send your AT key, learning history or current location. Planning and
direct AT requests work independently of the relay.

## Update and reopen

Use **Settings → Check for an app update** or the app's `update.html` page in the
same browser used to install it. Choose **Update and reopen**, then reopen the
installed app and check its version. Pulling down to refresh also checks for an
update; offline checks stay quiet. Saved places and downloaded travel data should
remain. If an update fails, keep the existing app and retry online.

**Forget history and saved places** clears those local choices. When journey
sharing is enabled, saved-place removals are also shared with permitted devices
when connected. This is different from removing a relay address.
