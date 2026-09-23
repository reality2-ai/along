import {configureAppLiveConnection} from './app-live-bridge.mjs';
// The isolated app uses the pairing lab's explicitly created local identity.
// Missing/unreadable state leaves scheduled planning usable. No first-use identity
// is created, no key is read, and no provider request is made during bootstrap.
let store;
try {
  const wasm = await import('../tg-pairing/hive_wasm.js'); await wasm.default();
  const {openBrowserStorage} = await import('../tg-pairing/storage.mjs');
  store = await openBrowserStorage('along-pairing-lab-v1');
  const saved = await store.read('candidate-persona', 'active');
  const group = saved?.value?.record?.group;
  if (group instanceof Uint8Array && group.length === 32) {
    const {loadATBinding} = await import('./local-owner.mjs');
    const binding = await loadATBinding({wasm, store, expectedGroup: group});
    if (binding) {
      const {createSavedATClient} = await import('./saved-client.mjs');
      // Shared-key reads remain refused without the separately authenticated
      // owner-session controller; the connection UI must supply that next.
      configureAppLiveConnection(() => createSavedATClient({wasm, store, expectedGroup: group}));
    }
  }
} catch { configureAppLiveConnection(undefined); }
window.addEventListener('pagehide', () => { configureAppLiveConnection(undefined); store?.close(); }, {once: true});
