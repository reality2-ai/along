# Install Along Device Preview

**An experimental AI-coding course app. Use at your own risk.** This preview is
not an official Auckland Transport app. Check important journey and accessibility
information with AT. The preview is not the regular Along release.

## Keep the preview separate

The installed name is **Along Device Preview** (some launchers shorten it to
**Along Preview**). The next release candidate shows **App version 3806 · Device preview** in Settings. The published preview remains 3805 until its release checks pass.
The preview starts with its own saved places, offline download and device setup.
It does not import the regular app's AT key or saved journeys. Keep your regular
Along installation while testing.

If you already installed preview 3801, use **Check for updates** or open this
preview's `update.html` page and choose **Update and reopen**. Updating preserves
the preview's saved places, identity and stored key. Do not clear site data.

Version 3802 adds a device list and signed group-removal messages. Devices issued
membership before 3802 may be absent from the list. Removal is enforced by each
device only after it learns the signed update; it does not erase copied data,
replace an AT key at its provider. Version 3804 adds reviewed group-key updates and saved installation confirmations. Automatic delivery remains
unfinished. Version 3805 compacts repeated queued journey edits and explains
when the separate limit on shared places is reached. It preserves local saves;
it does not reclaim retained deletion records.

These separate storage names prevent accidental mixing; they are not a security boundary. They do not protect one
page from other scripts on the same website. Clearing this website's browser data
may remove both apps, including saved device keys. Browser software storage is not
hardware-backed custody or protection from a compromised browser or same-origin script.

## Candidate 3806: optional automatic reconnection

This section describes the unpublished candidate, not the current 3805 site.
After pairing devices and allowing saved-journey sharing, open **Settings → Share
saved journeys with my devices → Automatic connection with a relay**. Enter the
same secure `wss://` R2 relay address on both devices and choose **Use this relay**.
No address is supplied or enabled by default. External relay compatibility still
needs verification; a matching protocol is required, not just any WebSocket server.

Keep Along open on both devices. A relay connection alone does not mean the other
device is connected or that a journey has been received. The sharing screen reports
when a permitted device confirms saving the journeys. If offline, changes stay
locally and reconnection retries. Mobile browsers may suspend a background app.
Recovery differences must be reviewed before automatic sharing resumes; devices at
different checkpoints still need a reviewed checkpoint transfer.

**Stop automatic relay sharing** keeps the address for later. **Remove relay
address** clears that saved choice. Neither action removes your saved journeys.
Planning and direct AT access work without a relay. The relay sees network and
device/group identifiers, certificates and traffic timing/sizes. Journey payloads
are encrypted between permitted devices; this connection does not send your AT
key, learning history or current location. Pairing and sharing permission remain
separate deliberate steps.

## Prepare and install

1. Open the supplied preview link in the browser you intend to use for installation.
2. Wait for the timetable and addresses to say they are ready offline in Settings.
3. Install using the browser instructions below. Choose the preview's install action,
   rather than the one on the regular Along page.
4. Open the installed preview and check its name and version in Settings.
5. Try a new address search in flight mode. Scheduled planning should remain available.

The portal supplies the initial download and updates. It does not calculate your
routes. Already downloaded scheduled planning works without the portal or another
device. Online data, uncached street-map backgrounds and device connection need a
network connection. Offline storage remains subject to browser limits and clearing.

<!-- platform-guide -->

## Optional current AT information

Times are scheduled unless a contextual check returns a verified live match.
Setting up a device or saving an AT key does not prove that a feed is available.
The preview can use a personal AT key for direct requests to Auckland Transport;
there is no Along live-data proxy. AT receives the key and your IP address. Use
dummy key text for the current device tests; it will not retrieve live AT feeds.

When inspecting a stop, journey or service, use its live-information action if
you have configured access. Unavailable or unmatched data leaves the scheduled
journey in place. No live request is required for offline planning. A changed
prediction does not automatically replace your chosen journey.

## Optional sharing between your devices

Device setup and connection are optional. In Settings, set up each test device,
then invite and join them. Compare the displayed codes on devices you control.
Connection messages are copied or scanned between devices; automatic discovery
and automatic reconnect are not implemented. Keep both devices open while sharing.

**Share saved journeys with my devices** has a separate permission review. It can
exchange saved starting places, destinations, preferred bus/train/ferry numbers,
and later changes or removals. Learning history, current location, accessibility
settings and the journey currently on screen are not shared. No Along server stores
these shared journeys. Copies remain on a receiving device after you stop sharing.

AT-key sharing is a separate choice with its own permission. Keys are encrypted in
browser software storage, with the limits described above. Device connection is a
documented subset of Reality2, not full hardware-backed R2 conformance or verified
compatibility with another R2 application.

Use **Manage journey-sharing devices** to stop journey sharing, including while
offline. This does not revoke TG membership or revoke an AT key at AT. Removing
AT access uses its separate control. Forgetting history also removes your local
saved places; those saved-place removals are shared when permitted devices connect.

## Updates and feedback

Use the preview's Settings → Check for an app update. Update and reopen should keep
its saved places and device setup. Pulling down to refresh checks for updates and
fails quietly offline. Updating the downloaded timetable is a separate action.

Feedback goes to the public Along GitHub repository only after you review and
submit it through GitHub. Opening the issue composer is not confirmed delivery.
Never include API keys, private connection messages or personal addresses unless
you deliberately want to publish them. Feedback drafts are kept separately for
the preview.


For version 3805, update both devices before pairing or reconnecting: the public
connection formats changed. Device setup includes reviewed group-key updates,
per-device confirmations and recovery of a lost acknowledgment. These updates
preserve existing sharing choices; replacing an AT subscription key is a separate
provider action. Downloaded planning remains available if devices cannot connect.
