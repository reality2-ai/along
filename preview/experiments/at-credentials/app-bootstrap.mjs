import {configureAppLiveConnection} from './app-live-bridge.mjs';
import {mountAppDeviceSettings} from './app-device-settings.mjs';
import {mountAppConnectionSettings} from './app-connection-settings.mjs';
import {mountAppJourneySettings} from '../journey-sync/app-settings.mjs';
// Restore optional lab settings only. A stalled runtime/storage operation cannot
// delay the scheduled planner or enable live access after timeout.
let stopActive;
export let restoration;
async function start() {
  let store, timer, settings, journeySettings, configuredContext, releaseDeadline, manual = false, closed = false;
  const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  const contextKey = ({group, member, binding}) => JSON.stringify([hex(group), member, binding?.role, binding?.binding.owner, binding?.binding.credential]);
  const lifetime = new AbortController();
  const current = () => { if (lifetime.signal.aborted) throw new Error('Optional restore ended'); };
  const stop = () => { lifetime.abort(); if (!manual) { settings?.dispose(); journeySettings?.dispose(); configureAppLiveConnection(undefined); store?.close(); } };
  const deviceSettings = mountAppDeviceSettings({onChanged: context => {
    if (closed) return;
    const key = contextKey(context);
    if (key === configuredContext) return;
    configuredContext = key;
    lifetime.abort(); manual = true;
    settings?.dispose(); settings = undefined;
    journeySettings?.dispose(); journeySettings = undefined;
    if (store !== context.store) store?.close();
    store = context.store;
    configureAppLiveConnection(undefined);
    journeySettings = mountAppJourneySettings({wasm: context.wasm, store, expectedGroup: context.group, member: context.member});
    if (context.binding) settings = mountAppConnectionSettings({wasm: context.wasm, store,
      expectedGroup: context.group, role: context.binding.role});
  }});
  stopActive = () => {
    closed = true; manual = false; clearTimeout(timer); stop(); deviceSettings.dispose();
    releaseDeadline?.();
  };
  restoration = (async () => {
    try {
      const {openBrowserStorage} = await import('../tg-pairing/storage.mjs'); current();
      const opened = await openBrowserStorage('along-device-preview-devices-v1');
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
      const {loadLocalPersona} = await import('../tg-pairing/local-persona.mjs'); current();
      const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
      if (!identity) { store.close(); return; }
      current();
      configuredContext = contextKey({group, member: hex(saved.value.record.subject), binding});
      journeySettings = mountAppJourneySettings({wasm, store, expectedGroup: group, member: identity.member});
      if (binding) settings = mountAppConnectionSettings({wasm, store, expectedGroup: group, role: binding.role});
    } catch { if (!closed) stop(); }
  })();
  await Promise.race([restoration, new Promise(resolve => {
    releaseDeadline = resolve;
    timer = setTimeout(() => { if (!closed) stop(); resolve(); }, 3000);
  })]);
  clearTimeout(timer);
}
window.addEventListener('pagehide', () => { stopActive?.(); stopActive = undefined; });
window.addEventListener('pageshow', event => {
  if (event.persisted && !stopActive) void start();
});
// Do not hold the importing journey module behind optional storage/WASM work.
// The bridge announces any later configuration change to the running app.
void start();
