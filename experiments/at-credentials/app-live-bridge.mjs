// Build-time integration seam for the experimental journey app. The public app
// does not import this module. A trusted bootstrap supplies actual saved-device
// clients; no provider URL or credential is accepted from journey screens.
let factory;
const clients = new Set();
export function configureAppLiveConnection(createClient) {
  if (createClient !== undefined && typeof createClient !== 'function') throw new Error('Live client factory unavailable');
  for (const client of clients) client.cancel();
  factory = createClient;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('along-live-connection-changed'));
}
export function createLiveClient() {
  let held, selectedFactory, generation = 0, closed = false;
  const cancel = () => { generation++; held?.close?.(); held?.cancel(); held = undefined; selectedFactory = undefined; clients.delete(client); };
  const client = Object.freeze({
    get configured() { return !closed && typeof factory === 'function'; },
    async read(kind, {requested = false} = {}) {
      if (!requested) return {available: false, reason: 'not-requested'};
      if (closed) return {available: false, reason: 'cancelled'};
      if (!factory) return {available: false, reason: 'not-configured'};
      if (selectedFactory !== factory) {
        cancel(); selectedFactory = factory;
        try { held = factory(); clients.add(client); } catch { selectedFactory = undefined; return {available: false, reason: 'unavailable'}; }
      }
      const started = generation;
      try {
        const result = await held.read(kind, {requested: true});
        return started === generation ? result : {available: false, reason: 'cancelled'};
      } catch { return {available: false, reason: 'unavailable'}; }
    },
    cancel,
    close() { closed = true; cancel(); },
  });
  return client;
}
