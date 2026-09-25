// Along bootstrap carriage over the current extended-frame hive binding. These
// temporary keys are NOT the target group's keys. Admission here only proves
// possession of the invitation; signed proof, comparison and core enrollment
// still decide membership. No storage access or application permissions here.
import {readConnectionInvitation, connectionContext, connectionBytes} from './connection-invitation.mjs';
import {createHiveTransport} from '../r2-current/hive-transport.mjs';
import {gate, protectEvent, wireEntry, MAX_PLAINTEXT} from '../r2-current/group-protection.mjs';
import {heartbeatFrame} from '../r2-current/heartbeat.mjs';
import {parseFrame, TYPE} from '../r2-current/frame.mjs';
import {eventHash} from '../r2-current/names.mjs';
import {duplicateCache} from '../r2-current/duplicates.mjs';
import {segment, reassembler} from '../r2-current/segments.mjs';
const EVENT = eventHash('nz.along.invitation.channel.v1');
const LIMITS = Object.freeze({maxPacket:16384,maxPieces:128});
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8',{fatal:true});
const randomId = () => crypto.getRandomValues(new Uint32Array(1))[0];
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
export async function createInvitationChannel({invitation, role, signal, onError = () => {}, onStatus = () => {},
  transportFactory = createHiveTransport}) {
  if (!['candidate','provisioner'].includes(role) || signal?.aborted) throw Error('Connection ended');
  const selected = readConnectionInvitation(invitation), context = encoder.encode(connectionContext(selected));
  const secret = connectionBytes(selected.secret);
  let derived;
  try {
    const key = await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
    derived = new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',
      salt:await crypto.subtle.digest('SHA-256',context),info:encoder.encode('along/invitation-channel/v1')},key,512));
  } finally { secret.fill(0); }
  const keys = {payloadKey:derived.subarray(0,32),integrityKey:derived.subarray(32),epoch:0n};
  const other = role === 'candidate' ? 'provisioner' : 'candidate';
  const group = connectionBytes(selected.routingGroup);
  const [self,target] = await Promise.all([wireEntry(group,connectionBytes(selected[role])),wireEntry(group,connectionBytes(selected[other]))]);
  if (signal?.aborted || selected.expires <= Date.now()) { derived.fill(0); throw Error('Connection invitation expired'); }
  const duration = selected.expires - Date.now(), started = performance.now();
  let stopped = false, listener, nextSend = 0, nextReceive = 0, outgoing = Promise.resolve(), incoming = Promise.resolve(), queued = 0;
  const pending = new Map(), sleepers = new Set(), recent = [], seen = duplicateCache();
  const pieces = reassembler({...LIMITS,maxEntries:2,lifetimeMs:60000});
  let hive, deadline;
  const current = () => {
    if (stopped || signal?.aborted || performance.now() - started >= duration || Date.now() >= selected.expires) throw Error('Connection ended or invitation expired');
  };
  const close = () => {
    if (stopped) return; stopped = true; clearTimeout(deadline); hive?.stop();
    signal?.removeEventListener('abort',close); listener = undefined; derived.fill(0); pieces.clear();
    for (const record of pending.values()) record.reject(Error('Connection ended')); pending.clear();
    for (const wake of [...sleepers]) wake();
  };
  const fail = error => { if (stopped) return; close(); try { onError(error); } catch {} };
  const sleep = ms => new Promise(resolve => {
    const wake = () => { clearTimeout(timer); sleepers.delete(wake); resolve(); };
    const timer = setTimeout(wake,ms); sleepers.add(wake);
  });
  const transmit = packet => {
    // Serial transmission bounds frames queued in the socket and preserves the
    // host's 64 frames/10 s origin limit, leaving room for other control traffic.
    const action = outgoing.then(async () => {
      current();
      for (const plaintext of segment(packet,randomId(),MAX_PLAINTEXT,LIMITS)) {
        for (;;) {
          current(); const now = performance.now();
          while (recent.length && now - recent[0] >= 10000) recent.shift();
          if (hive.connected && recent.length < 48) break;
          await sleep(100);
        }
        const frame = await protectEvent({keys,origin:self,target,eventHash:EVENT,plaintext}); current();
        while (!hive.send(frame)) { current(); await sleep(100); }
        recent.push(performance.now());
      }
    });
    outgoing = action.catch(() => {}); return action;
  };
  const acknowledge = n => transmit(encoder.encode(JSON.stringify({v:1,ack:n})));
  const receive = async bytes => {
    current(); const frame = parseFrame(bytes,'extended');
    if (frame.discard || frame.originless || frame.type !== TYPE.EVENT || frame.eventHash !== EVENT
        || !same(frame.origin,target) || !same(frame.target,self)) return;
    const result = await gate(bytes,{self,keys:[keys]}); current();
    if (result.kind !== 'group') return;
    let packet;
    try {
      if (!seen.admit(frame.origin,frame.msgId)) return;
      packet = pieces.accept(other,result.plaintext);
    } finally { result.plaintext.fill(0); }
    if (!packet) return;
    let value; try { value = JSON.parse(decoder.decode(packet)); } catch { return; } finally { packet.fill(0); }
    if (!value || Array.isArray(value) || value.v !== 1) return;
    const fields = Object.keys(value).sort().join(',');
    if (fields === 'ack,v' && Number.isSafeInteger(value.ack)) {
      const record = pending.get(value.ack);
      if (record) { pending.delete(value.ack); record.resolve(); }
    } else if (fields === 'body,n,v' && Number.isSafeInteger(value.n) && value.n >= 0
        && value.n < 8 && typeof value.body === 'string') {
      if (value.n > nextReceive || !listener) return;
      if (value.n === nextReceive) { nextReceive++; listener(value.body); }
      await acknowledge(value.n);
    }
  };
  try { hive = transportFactory({url:selected.relay,
    announce:() => heartbeatFrame({origin:self,msgId:randomId(),beaconId:self.slice(4),classHash:new Uint8Array(4)}),
    onStatus: state => { if (!stopped) { onStatus(state); if (state === 'refused') fail(Error('Relay binding refused')); } },
    onFrame: bytes => {
      if (stopped || queued >= 128) return; queued++;
      incoming = incoming.then(() => receive(bytes)).catch(fail).finally(() => { queued--; });
    }}); } catch (error) { close(); throw error; }
  deadline = setTimeout(() => fail(Error('Connection invitation expired')),duration);
  signal?.addEventListener('abort',close,{once:true});
  if (signal?.aborted) close();
  return Object.freeze({endpoint:selected.relay,
    start() { current(); hive.start(); }, close,
    subscribe(fn) {
      current(); if (listener || typeof fn !== 'function') throw Error('Connection receiver unavailable');
      listener = fn; return () => { if (listener === fn) listener = undefined; };
    },
    send(text) {
      current();
      if (typeof text !== 'string' || nextSend >= 8 || pending.size >= 2) throw Error('Connection message unavailable');
      const n = nextSend, packet = encoder.encode(JSON.stringify({v:1,n,body:text}));
      if (packet.length > LIMITS.maxPacket) throw Error('Connection message too large');
      nextSend++;
      const completed = new Promise((resolve,reject) => pending.set(n,{resolve,reject}));
      void (async () => {
        try {
          // Retry a lost frame/ack with fresh frame IDs. Duplicates are acknowledged
          // but delivered to the enrollment sequencer exactly once.
          while (pending.has(n)) { await transmit(packet); if (pending.has(n)) await sleep(1500); }
        } catch (error) { fail(error); } finally { packet.fill(0); }
      })();
      return completed;
    },
  });
}
