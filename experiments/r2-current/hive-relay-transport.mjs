// Carries Along's existing authenticated relay packets (signed discovery,
// per-peer handshake and per-peer protected data) over the current R2 hive
// binding. Each packet is divided into group-protected EVENT frames: the group
// key admits frames at the gate; the inner packet's own member signatures and
// pairwise encryption continue to attribute and confine it to one peer.
// Exposes the same {start, disconnect, send} shape and status strings as the
// archived relay transport, so the sharing service is unchanged above it.
import {createHiveTransport} from './hive-transport.mjs';
import {gate, MAX_PLAINTEXT, protectEvent, wireEntry, wireHalf} from './group-protection.mjs';
import {parseFrame, TYPE} from './frame.mjs';
import {heartbeatFrame} from './heartbeat.mjs';
import {duplicateCache} from './duplicates.mjs';
import {eventHash} from './names.mjs';
import {reassembler, segment} from './segments.mjs';

export const PACKET_EVENT = eventHash('nz.along.relay.packet.v1');
// A replaced epoch's keys stay in memory, never in storage, so frames already in
// flight during a rotation can still be admitted briefly (L5 7.1 Note 2).
const PRIOR_GRACE_MS = 60_000;
// The deployed host replicates at most 64 frames per origin per 10 s (L3 5.7.2);
// excess frames are silently not relayed, so pace below that with a margin.
export const RELAY_WINDOW = Object.freeze({frames: 56, ms: 10_000});
const application = new TextEncoder().encode('ALNRLY01');
const hex = b => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g), b => parseInt(b, 16));
const starts = (bytes, prefix) => bytes.length >= prefix.length && prefix.every((v, i) => bytes[i] === v);
const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

// Enrolled members hold installed traffic keys; the initial member derives its
// epoch-0 keys from its issuer custody instead of storing them.
export async function loadGroupTraffic(options) {
  const persona = await options.store.read('candidate-persona', 'active');
  if (persona?.value?.origin !== 'initial') return (await import('../tg-pairing/software-traffic.mjs')).loadSoftwareTraffic(options);
  const issuer = await (await import('../tg-pairing/software-persona.mjs')).loadSoftwareIssuer(options);
  try { return await issuer.ownTraffic(); } finally { issuer.close(); }
}

export function createHiveRelayTransportFactory({wasm, store, expectedGroup, member, loadTraffic = loadGroupTraffic,
  WebSocket, timers, now = () => Date.now(), relayWindow = RELAY_WINDOW}) {
  const group = expectedGroup.slice(), groupId = hex(group);
  return function hiveRelayTransport({url, onFrame, onStatus = () => {}}) {
    let self, groupTarget, membershipRevision, current, prior, stopped = true, sendQueue = Promise.resolve();
    const beacon = {beaconId: random(4), classHash: random(4)};
    const seen = duplicateCache({now}), pieces = reassembler({now}), recent = [];
    const sleep = ms => new Promise(resolve => (timers ?? globalThis).setTimeout(resolve, ms));
    // Sliding-window pacing of relayed frames from this origin.
    const paced = async () => {
      for (;;) {
        while (recent.length && now() - recent[0] >= relayWindow.ms) recent.shift();
        if (recent.length < relayWindow.frames) { recent.push(now()); return; }
        if (stopped) throw Error('Hive relay stopped');
        await sleep(Math.min(250, recent[0] + relayWindow.ms - now() + 1));
      }
    };
    const halves = new Map();
    const peerTarget = async subject => {
      const key = hex(subject);
      if (!halves.has(key)) { if (halves.size > 64) halves.clear(); halves.set(key, await wireHalf(subject)); }
      const out = groupTarget.slice(); out.set(halves.get(key), 4); return out;
    };
    // Revalidate cheaply on every use; reload the stored keys when membership changes.
    const keyring = async () => {
      const record = await store.read('membership', groupId);
      if (!record) throw Error('Hive group material unavailable');
      if (record.revision !== membershipRevision || !current) {
        const loaded = await loadTraffic({wasm, store, expectedGroup: group});
        const next = {epoch: loaded.epoch, payloadKey: loaded.payloadKey.slice(), integrityKey: loaded.integrityKey.slice()};
        loaded.destroy();
        if (current && current.epoch !== next.epoch) prior = {...current, until: now() + PRIOR_GRACE_MS};
        else if (current) { current.payloadKey.fill(0); current.integrityKey.fill(0); }
        current = next; membershipRevision = record.revision;
      }
      if (prior && now() >= prior.until) { prior.payloadKey.fill(0); prior.integrityKey.fill(0); prior = undefined; }
      return prior ? [current, prior] : [current];
    };
    const receive = async bytes => {
      const frame = parseFrame(bytes);
      if (frame.discard || frame.originless || frame.type !== TYPE.EVENT || frame.eventHash !== PACKET_EVENT) return;
      if (hex(frame.origin) === hex(self) || !seen.admit(frame.origin, frame.msgId)) return;
      const result = await gate(bytes, {self, keys: await keyring()});
      if (result.kind !== 'group') return;
      const packet = pieces.accept(hex(frame.origin), result.plaintext);
      result.plaintext.fill(0);
      if (packet && !stopped) onFrame(packet);
    };
    const hive = createHiveTransport({url, WebSocket, timers, now,
      announce: () => self && heartbeatFrame({origin: self, msgId: globalThis.crypto.getRandomValues(new Uint32Array(1))[0], ...beacon}),
      onStatus: state => { if (!stopped || state === 'disconnected') onStatus(state); },
      onFrame: bytes => { void receive(bytes).catch(() => {}); }});
    return Object.freeze({
      endpoint: hive.endpoint,
      start() {
        if (!stopped) return;
        stopped = false;
        void (async () => {
          self = await wireEntry(group, unhex(member));
          groupTarget = new Uint8Array(8); groupTarget.set(self.subarray(0, 4));
          await keyring();
          if (!stopped) hive.start();
        })().catch(() => { if (!stopped) { stopped = true; onStatus('refused'); } });
      },
      disconnect() {
        stopped = true; hive.stop();
        for (const k of [current, prior]) if (k) { k.payloadKey.fill(0); k.integrityKey.fill(0); }
        current = prior = undefined;
      },
      // The caller's copy may be cleared after this returns, so copy synchronously.
      send(packet) {
        if (stopped || !hive.connected) throw Error('Hive relay cannot send');
        const copy = packet.slice();
        sendQueue = sendQueue.then(async () => {
          const target = starts(copy, application) ? await peerTarget(copy.subarray(41, 73)) : groupTarget;
          const [keys] = await keyring();
          const packetId = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
          for (const plaintext of segment(copy, packetId, MAX_PLAINTEXT)) {
            await paced();
            const frame = await protectEvent({keys, origin: self, target, eventHash: PACKET_EVENT, plaintext});
            // Pace rather than drop when the per-second send budget is spent.
            for (const started = now(); !hive.send(frame);) {
              if (stopped || !hive.connected || now() - started > 5000) throw Error('Hive relay output refused');
              await sleep(50);
            }
          }
        }).catch(() => {}).finally(() => copy.fill(0));
      },
    });
  };
}
