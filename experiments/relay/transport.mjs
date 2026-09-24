// Experimental Notekeeper-shaped relay transport. Caller supplies verified
// authentication and protected frames; this module provides neither membership
// authorization nor encryption. Not mounted in Along.
export function relayEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) throw Error('Relay address unavailable');
  const url = new URL(value);
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.search) throw Error('Use a secure relay address without credentials, query or fragment');
  return url.href;
}
export function createRelayTransport({url, createHello, onFrame, onStatus = () => {},
  WebSocket: Socket = globalThis.WebSocket, timers = globalThis, random = Math.random}) {
  const endpoint = relayEndpoint(url);
  if (typeof createHello !== 'function' || typeof onFrame !== 'function') throw Error('Relay callbacks required');
  let socket, retry, deadline, heartbeat, stopped = true, ready = false, attempt = 0, generation = 0;
  const status = value => { try { onStatus(value); } catch {} };
  const clear = () => { for (const id of [retry, deadline, heartbeat]) timers.clearTimeout(id); retry = deadline = heartbeat = undefined; };
  const detach = () => {
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try { socket.close(); } catch {} socket = undefined;
  };
  const stop = () => { stopped = true; ready = false; generation++; clear(); detach(); status('disconnected'); };
  const fail = (permanent = false) => {
    ready = false; generation++; clear(); detach();
    if (stopped) return;
    if (permanent) { stopped = true; status('refused'); return; }
    status('waiting');
    if (stopped) return;
    const delay = Math.min(60000, 1000 * 2 ** Math.min(attempt++, 6)) * (0.8 + 0.2 * random());
    retry = timers.setTimeout(connect, delay);
  };
  const connect = () => {
    if (stopped) return;
    clear(); detach(); let greeted = false, awaitingPong = false; const run = ++generation; status('connecting');
    const current = () => !stopped && run === generation;
    if (!current()) return;
    try { socket = new Socket(endpoint); socket.binaryType = 'arraybuffer'; } catch { fail(); return; }
    deadline = timers.setTimeout(() => { if (current()) fail(); }, 10000);
    socket.onopen = async () => {
      try {
        const hello = await createHello();
        if (!current()) return;
        if (typeof hello !== 'string' || new TextEncoder().encode(hello).length > 8192) throw Error('Invalid greeting');
        socket.send(hello); greeted = true;
      } catch { if (current()) fail(true); }
    };
    const ping = () => {
      if (!current() || !ready) return;
      try { awaitingPong = true; socket.send(JSON.stringify({type: 'ping'})); } catch { fail(); return; }
      deadline = timers.setTimeout(() => { if (current()) fail(); }, 10000);
    };
    socket.onmessage = event => {
      if (!current()) return;
      try {
        if (typeof event.data === 'string') {
          if (event.data.length > 8192) throw Error('Oversize control');
          const message = JSON.parse(event.data);
          if (!ready) {
            if (!greeted || message.type !== 'welcome' || !Number.isSafeInteger(message.peers) || message.peers < 0) throw Error('Invalid welcome');
            ready = true; attempt = 0; timers.clearTimeout(deadline); status('connected');
            if (!current()) return;
            heartbeat = timers.setTimeout(ping, 30000);
          } else if (message.type === 'pong' && awaitingPong) {
            awaitingPong = false;
            timers.clearTimeout(deadline); timers.clearTimeout(heartbeat);
            heartbeat = timers.setTimeout(ping, 30000);
          } else throw Error('Unexpected relay control');
        } else {
          if (!ready || !(event.data instanceof ArrayBuffer) || !event.data.byteLength || event.data.byteLength > 65536) throw Error('Invalid frame');
          onFrame(new Uint8Array(event.data));
        }
      } catch { fail(true); }
    };
    socket.onclose = event => { if (current()) fail([4401, 4403].includes(event.code)); };
    socket.onerror = () => { if (current()) fail(); };
  };
  return Object.freeze({endpoint,
    start() { if (stopped) { stopped = false; attempt = 0; connect(); } },
    disconnect: stop,
    send(frame) {
      if (!ready || stopped || !(frame instanceof Uint8Array) || !frame.length || frame.length > 65536
          || socket.bufferedAmount + frame.length > 131072) throw Error('Relay cannot send');
      try { socket.send(frame); } catch (error) { fail(); throw error; }
    },
  });
}
