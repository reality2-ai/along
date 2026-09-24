import {validateState} from './state.mjs';
const MAX_BYTES = 2 * 1024 * 1024, CHUNK = 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const failure = () => new Error('Journey transfer unconfirmed');
function frame(type, id, number, bytes = new Uint8Array()) {
  const packet = new Uint8Array(21 + bytes.length);
  packet[0] = type; packet.set(id, 1); new DataView(packet.buffer).setUint32(17, number); packet.set(bytes, 21);
  return packet;
}

// Run only over an authenticated application session. Each direction has one
// bounded transfer; acknowledgments pace chunks, while a receipt follows commit.
export function createJourneyExchange({group, ...options}) {
  if (!/^[0-9a-f]{64}$/.test(group)) throw failure();
  const exchange = createBoundedExchange({...options,
    encode: state => encoder.encode(JSON.stringify(validateState(state, group))),
    decode: bytes => validateState(JSON.parse(decoder.decode(bytes)), group),
    commitStatus: 'journeys-saved', resultStatus: 'peer-saved-snapshot', frameBase: 0});
  return Object.freeze({sendSnapshot: exchange.sendPayload, receive: exchange.receive, close: exchange.close, signal: exchange.signal});
}

// Internal bounded transport, shared by distinct application frame domains.
export function createBoundedExchange({send, commit, encode, decode, commitStatus, resultStatus, frameBase, signal, timeoutMs = 15000, onClose = () => {}}) {
  if (typeof send !== 'function' || typeof commit !== 'function' || typeof encode !== 'function' || typeof decode !== 'function'
      || !Number.isSafeInteger(frameBase) || frameBase < 0 || frameBase > 251
      || typeof commitStatus !== 'string' || typeof resultStatus !== 'string'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw failure();
  const lifetime = new AbortController();
  let closed = false, sending = false, incoming, pending, timer, incomingTimer, queue = Promise.resolve();
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); clearTimeout(incomingTimer); incoming = undefined;
    signal?.removeEventListener('abort', close); lifetime.abort();
    pending?.reject(failure()); pending = undefined;
    try { onClose(); } catch {}
  };
  const current = () => { if (closed) throw failure(); };
  signal?.addEventListener('abort', close, {once: true});
  if (signal?.aborted) close();
  const transmit = async packet => { current(); await send(packet); current(); };
  const request = async (packet, type, number, hash) => {
    current();
    const answer = new Promise((resolve, reject) => {
      pending = {id: packet.slice(1, 17), type, number, hash, resolve, reject};
      timer = setTimeout(close, timeoutMs);
    });
    try { await Promise.all([transmit(packet), answer]); }
    catch { close(); throw failure(); }
  };
  const receive = async packet => {
    current();
    if (!(packet instanceof Uint8Array) || packet.length < 21 || packet.length > 2048) throw failure();
    const type = packet[0] - frameBase, id = packet.slice(1, 17);
    const number = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(17);
    const bytes = packet.slice(21);
    if (type === 3 || type === 4) {
      if (!pending || !equal(id, pending.id) || type !== pending.type || number !== pending.number
          || (type === 3 ? bytes.length !== 0 : !equal(bytes, pending.hash))) throw failure();
      clearTimeout(timer); const answer = pending; pending = undefined; answer.resolve(); return;
    }
    if (type === 1) {
      if (incoming || bytes.length !== 32 || number < 1 || number > MAX_BYTES) throw failure();
      incoming = {id, hash: bytes, bytes: new Uint8Array(number), offset: 0};
      incomingTimer = setTimeout(close, timeoutMs);
      await transmit(frame(3 + frameBase, id, 0)); return;
    }
    if (type !== 2 || !incoming || !equal(id, incoming.id) || number !== incoming.offset
        || !bytes.length || bytes.length > CHUNK || number + bytes.length > incoming.bytes.length) throw failure();
    clearTimeout(incomingTimer); incomingTimer = setTimeout(close, timeoutMs);
    incoming.bytes.set(bytes, number); incoming.offset += bytes.length;
    if (incoming.offset < incoming.bytes.length) { await transmit(frame(3 + frameBase, id, incoming.offset)); return; }
    const snapshot = incoming;
    if (!equal(await digest(snapshot.bytes), snapshot.hash)) throw failure();
    current();
    const state = await decode(snapshot.bytes);
    current();
    const receipt = await commit(state, {signal: lifetime.signal});
    if (receipt?.status !== commitStatus) throw failure();
    current();
    clearTimeout(incomingTimer); incoming = undefined;
    await transmit(frame(4 + frameBase, id, snapshot.bytes.length, snapshot.hash));
  };
  return Object.freeze({
    async sendPayload(state) {
      current(); if (sending) throw failure();
      const bytes = encode(state);
      if (!(bytes instanceof Uint8Array) || bytes.length < 1) throw failure();
      if (bytes.length > MAX_BYTES) throw failure();
      sending = true;
      try {
        const id = crypto.getRandomValues(new Uint8Array(16)), hash = await digest(bytes); current();
        await request(frame(1 + frameBase, id, bytes.length, hash), 3, 0);
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          const end = Math.min(offset + CHUNK, bytes.length);
          await request(frame(2 + frameBase, id, offset, bytes.slice(offset, end)), end === bytes.length ? 4 : 3, end, hash);
        }
        return {status: resultStatus, digest: hex(hash)};
      } catch { close(); throw failure(); }
      finally { sending = false; }
    },
    receive(packet) {
      if (!(packet instanceof Uint8Array) || packet.length > 2048) { close(); return Promise.reject(failure()); }
      const copy = packet.slice();
      const operation = queue.then(() => receive(copy)).catch(() => { close(); throw failure(); });
      queue = operation.catch(() => {}); return operation;
    },
    close, signal: lifetime.signal,
  });
}
