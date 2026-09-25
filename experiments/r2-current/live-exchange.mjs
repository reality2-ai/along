// Live interoperability check against the deployed current R2 WebSocket hive.
// Two independent connections act as two members of a synthetic trust group
// (random keys created for this run; no user data). Each announces with a
// production HEARTBEAT, then exchanges group-protected EVENTs through the host.
// Browser- and Node-compatible; see live-check.mjs and browser-live-check.mjs.
import {decode, encode} from './cbor.mjs';
import {gate, protectEvent, wireEntry} from './group-protection.mjs';
import {parseFrame, TYPE} from './frame.mjs';
import {heartbeatFrame, readAnnouncement} from './heartbeat.mjs';
import {duplicateCache} from './duplicates.mjs';
import {eventHash} from './names.mjs';

export async function runLiveExchange(url = 'wss://wairoa.mariko.org.nz/r2') {
  const random = n => crypto.getRandomValues(new Uint8Array(n));
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const EVENT = eventHash('nz.along.check.v1');

  const group = random(32);
  const keys = {payloadKey: random(32), integrityKey: random(32), epoch: 0};
  const stranger = {payloadKey: random(32), integrityKey: random(32), epoch: 0};

  async function member(name) {
    const self = await wireEntry(group, random(32));
    const socket = new WebSocket(url, 'r2.extended.v1');
    socket.binaryType = 'arraybuffer';
    const m = {name, self, socket, received: [], announcements: [], raw: [], dup: duplicateCache()};
    socket.onmessage = async ({data}) => {
      const bytes = new Uint8Array(data);
      m.raw.push(bytes);
      const a = readAnnouncement(bytes); if (a) m.announcements.push(a);
      const frame = parseFrame(bytes);
      if (frame.discard || frame.originless || frame.type !== TYPE.EVENT) return;
      if (!m.dup.admit(frame.origin, frame.msgId)) { m.duplicates = (m.duplicates ?? 0) + 1; return; }
      const result = await gate(bytes, {self, keys: [keys]});
      m.received.push({kind: result.kind, origin: toHex(frame.origin), hop: frame.hop, route: frame.route.length,
        value: result.kind === 'group' ? decode(result.plaintext).get(0) : null});
    };
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error(name + ' failed to open')); });
    m.protocol = socket.protocol;
    m.beacon = {beaconId: random(4), classHash: random(4)};
    m.announce = () => socket.send(heartbeatFrame({origin: self, msgId: crypto.getRandomValues(new Uint32Array(1))[0], ...m.beacon}));
    return m;
  }

  const target = self => { const t = new Uint8Array(8); t.set(self.subarray(0, 4)); return t; };
  const waitFor = async (predicate, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (predicate()) return true; await pause(25); } return false; };

  const a = await member('a'), b = await member('b');
  a.announce(); b.announce();
  await pause(300);
  const send = (from, value, k = keys) => protectEvent({keys: k, origin: from.self, target: target(from.self), eventHash: EVENT, plaintext: encode(new Map([[0, value]]))});

  const ab = await send(a, 'a-to-b'); a.socket.send(ab);
  const forward = await waitFor(() => b.received.some(r => r.value === 'a-to-b'));
  const ba = await send(b, 'b-to-a'); b.socket.send(ba);
  const reverse = await waitFor(() => a.received.some(r => r.value === 'b-to-a'));
  a.socket.send(ab); await pause(500);
  const forwardCopies = b.received.filter(r => r.value === 'a-to-b').length;
  const foreign = await send(a, 'stranger', stranger); a.socket.send(foreign);
  const strangerArrived = await waitFor(() => b.raw.some(x => x.length === foreign.length + 8 && toHex(x.subarray(39, 47)) === toHex(foreign.subarray(31, 39))), 3000);
  const strangerDelivered = b.received.some(r => r.value === 'stranger');
  const hostAnnounced = a.announcements.some(x => toHex(x.origin) !== toHex(a.self) && toHex(x.origin) !== toHex(b.self));
  const peerBeaconSeen = b.announcements.some(x => toHex(x.origin) === toHex(a.self));
  const hop = b.received.find(r => r.value === 'a-to-b');
  a.socket.close(); b.socket.close();

  return {
    checked_at: new Date().toISOString(), url, protocol: [a.protocol, b.protocol],
    forward_delivered: forward, reverse_delivered: reverse,
    relayed_hop_and_route: hop ? {hop: hop.hop, route_entries: hop.route} : null,
    host_suppressed_identical_resend: forwardCopies === 1,
    wrong_group_key_frame_arrived: strangerArrived,
    wrong_group_key_refused: !strangerDelivered,
    host_announcement_received: hostAnnounced,
    peer_heartbeat_forwarded: peerBeaconSeen,
    passed: forward && reverse && strangerArrived && !strangerDelivered,
    scope: 'Two independent WebSocket connections in one runtime, with a synthetic group created for this run attempted to exchange XChaCha20-Poly1305/HMAC-SHA256 protected extended EVENT frames through the deployed host. The result fields determine whether the deployed relay forwarded them; this scope description is not a success claim. It does not verify the browser app, saved-journey synchronisation, enrolment, revocation, reconnection or physical devices.',
  };
}
