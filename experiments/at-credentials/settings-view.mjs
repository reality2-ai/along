import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {establishLocalATOwner, loadATBinding} from './local-owner.mjs';
import {openLocalATVault} from './local-vault.mjs';
import {showCredentialSetup} from './credential-view.mjs';
const mounted = new WeakMap();

// The enclosing device flow supplies its established group, never a peer payload.
// This screen makes no provider request and does not create a device identity.
export function showATSettings(container, {wasm, store, expectedGroup, focus = false, onBack = () => {}}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw new Error('Device group required');
  const group = expectedGroup.slice();
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, busy = false, child;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const heading = element('h2', 'Optional live information'); heading.tabIndex = -1;
  const explanation = element('p', 'Downloaded journeys work without a connection. You can add your own Auckland Transport key to check current information when you choose.');
  const status = element('p', 'Checking this device’s settings…'); status.setAttribute('role', 'status');
  const setup = element('button', 'Set up live information'); setup.type = 'button'; setup.className = 'pairing-primary'; setup.hidden = true;
  const back = element('button', 'Back'); back.type = 'button';
  panel.append(heading, explanation, status, setup, back); container.replaceChildren(panel);
  if (focus) heading.focus();
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); child?.dispose(); setup.disabled = true; back.disabled = true;
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
  const unavailable = () => {
    if (disposed) return;
    setup.hidden = true;
    status.textContent = 'These settings could not be opened. Go Back to device settings. Your downloaded journeys are still available.';
    if (document.activeElement === setup || document.activeElement === document.body && busy) back.focus();
  };
  const open = async (binding, activated = false) => {
    if (disposed) return;
    const moveFocus = activated && (document.activeElement === document.body || panel.contains(document.activeElement))
      || focus && panel.contains(document.activeElement);
    child = showCredentialSetup(container, {vault: openLocalATVault({wasm, store, ...binding}), focus: moveFocus, onBack: leave});
    await child.ready;
  };
  setup.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || setup.hidden) return;
    const activated = document.activeElement === setup;
    busy = true; setup.disabled = true; status.textContent = 'Saving your live-information settings…';
    try {
      const owner = await establishLocalATOwner({wasm, store, expectedGroup: group, signal: lifetime.signal});
      await open(owner.binding, activated);
    } catch { unavailable(); }
  });
  const ready = (async () => {
    try {
      const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
      if (disposed) return;
      if (!identity) throw new Error('Device identity unavailable');
      const owner = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime.signal});
      if (disposed) return;
      if (owner) await open(owner.binding);
      else {
        status.textContent = 'Continue to create local settings for your personal AT key. This does not contact AT or connect another device.';
        setup.hidden = false;
      }
    } catch { unavailable(); }
  })();
  return Object.freeze({ready, dispose});
}
