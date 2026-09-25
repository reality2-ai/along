// Browser carriage for the hive WebSocket binding `r2.extended.v1`: one binary
// message is one complete extended L4 frame. No greeting or login. This module
// neither authenticates nor decrypts; frames go to `onFrame` for the gate.
// Lifecycle follows the binding contract: announce about every two seconds while
// running, reconnect no more than ten seconds apart, treat silence as loss.
import {relayEndpoint} from '../relay/transport.mjs';

export const SUBPROTOCOL = 'r2.extended.v1';
export const MAX_MESSAGE = 65535;
const ANNOUNCE_MS = 2000, SILENCE_MS = 30000, OPEN_MS = 10000, MAX_RETRY_MS = 10000;
// The host disconnects a peer above 64 messages per second; stay well below.
const SEND_PER_SECOND = 32, MAX_BUFFERED = 8 * 65567;

export const hiveEndpoint = relayEndpoint;

export function createHiveTransport({url, announce, onFrame, onStatus = () => {},
  WebSocket: Socket = globalThis.WebSocket, timers = globalThis, now = () => Date.now(), random = Math.random}) {
  const endpoint = relayEndpoint(url);
  if (typeof announce !== 'function' || typeof onFrame !== 'function') throw Error('Hive callbacks required');
  let socket, retry, deadline, heartbeat, stopped = true, ready = false, attempt = 0, generation = 0;
  let windowStart = 0, sentInWindow = 0;
  const status = value => { try { onStatus(value); } catch {} };
  const clear = () => {
    timers.clearTimeout(retry); timers.clearTimeout(deadline); timers.clearTimeout(heartbeat);
    retry = deadline = heartbeat = undefined;
  };
  const detach = () => {
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try { socket.close(); } catch {} socket = undefined;
  };
  const current = run => !stopped && run === generation;
  const fail = () => {
    ready = false; generation++; clear(); detach();
    if (stopped) return;
    status('waiting');
    if (stopped) return;
    const delay = Math.min(MAX_RETRY_MS, 500 * 2 ** Math.min(attempt++, 5)) * (0.8 + 0.2 * random());
    retry = timers.setTimeout(connect, delay);
  };
  const admit = () => {
    const t = now();
    if (t - windowStart >= 1000) { windowStart = t; sentInWindow = 0; }
    if (sentInWindow >= SEND_PER_SECOND) return false;
    sentInWindow++; return true;
  };
  const transmit = frame => {
    if (!ready || stopped || !(frame instanceof Uint8Array) || !frame.length || frame.length > MAX_MESSAGE
        || socket.bufferedAmount + frame.length > MAX_BUFFERED || !admit()) return false;
    try { socket.send(frame); return true; } catch { fail(); return false; }
  };
  const watchSilence = run => {
    timers.clearTimeout(deadline);
    deadline = timers.setTimeout(() => { if (current(run)) fail(); }, SILENCE_MS);
  };
  const beat = run => {
    if (!current(run)) return;
    try { const frame = announce(); if (frame) transmit(frame); } catch {}
    if (current(run)) heartbeat = timers.setTimeout(() => beat(run), ANNOUNCE_MS);
  };
  const connect = () => {
    if (stopped) return;
    clear(); detach();
    const run = ++generation; status('connecting');
    if (!current(run)) return;
    try { socket = new Socket(endpoint, SUBPROTOCOL); socket.binaryType = 'arraybuffer'; } catch { fail(); return; }
    deadline = timers.setTimeout(() => { if (current(run)) fail(); }, OPEN_MS);
    socket.onopen = () => {
      if (!current(run)) return;
      // A server that did not select the binding is not this contract; stop rather than guess.
      if (socket.protocol !== SUBPROTOCOL) { stopped = true; ready = false; generation++; clear(); detach(); status('refused'); return; }
      ready = true; attempt = 0; status('connected');
      if (!current(run)) return;
      watchSilence(run); beat(run);
    };
    socket.onmessage = event => {
      if (!current(run)) return;
      const data = event.data;
      if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength > MAX_MESSAGE) { fail(); return; }
      watchSilence(run);
      try { onFrame(new Uint8Array(data)); } catch {}
    };
    socket.onclose = () => { if (current(run)) fail(); };
    socket.onerror = () => { if (current(run)) fail(); };
  };
  return Object.freeze({endpoint,
    start() { if (stopped) { stopped = false; attempt = 0; connect(); } },
    stop() { stopped = true; ready = false; generation++; clear(); detach(); status('disconnected'); },
    // Returns whether the frame was handed to the socket; admission is not delivery.
    send: transmit,
    get connected() { return ready && !stopped; },
  });
}
