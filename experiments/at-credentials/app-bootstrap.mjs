import {configureAppLiveConnection} from './app-live-bridge.mjs';
// Restore optional lab settings only. A stalled runtime/storage operation cannot
// hold the scheduled planner indefinitely or enable live access after timeout.
let store, timer, settings;
const lifetime = new AbortController();
const current = () => { if (lifetime.signal.aborted) throw new Error('Optional restore ended'); };
const stop = () => { lifetime.abort(); settings?.dispose(); configureAppLiveConnection(undefined); store?.close(); };
window.addEventListener('pagehide', stop, {once: true});
export const restoration = (async () => {
  try {
    const {openBrowserStorage} = await import('../tg-pairing/storage.mjs'); current();
    const opened = await openBrowserStorage('along-pairing-lab-v1');
    if (lifetime.signal.aborted) { opened.close(); return; }
    store = opened;
    const saved = await store.read('candidate-persona', 'active'); current();
    const group = saved?.value?.record?.group;
    if (!(group instanceof Uint8Array) || group.length !== 32) { store.close(); return; }
    // First use without a saved identity does not need to compile WASM.
    const wasm = await import('../tg-pairing/hive_wasm.js'); current();
    await wasm.default(); current();
    const {loadATBinding} = await import('./local-owner.mjs'); current();
    const binding = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime.signal}); current();
    if (!binding) { store.close(); return; }
    const {mountAppConnectionSettings} = await import('./app-connection-settings.mjs'); current();
    settings = mountAppConnectionSettings({wasm, store, expectedGroup: group, role: binding.role});
  } catch { stop(); }
})();
await Promise.race([restoration, new Promise(resolve => {
  timer = setTimeout(() => { stop(); resolve(); }, 3000);
})]);
clearTimeout(timer);
