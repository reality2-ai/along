// Experimental local first-use screen, excluded from the public build.
// Trusted UI activation is a UI boundary, not protection against same-origin JS.
import {initializeSoftwarePersona} from './software-persona.mjs';
const mounted = new WeakMap();
export function showLocalSetup(container, {wasm, store, focus = false, onBack = () => {}}) {
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, busy = false, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
  void completed.catch(() => {});
  const panel = document.createElement('section'); panel.className = 'pairing-comparison';
  const heading = document.createElement('h2'); heading.textContent = 'Set up this device'; heading.tabIndex = -1;
  const explanation = document.createElement('p');
  explanation.textContent = 'Connecting devices is optional. Your downloaded journeys work without it.';
  const limits = document.createElement('p');
  limits.textContent = 'Your group keys will be encrypted and saved in this browser. This is software protection, not hardware-backed storage. Code running as part of Along can use these keys. Clearing browser data can lose access to your group.';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  status.textContent = 'Checking this browser’s saved identity…';
  const create = document.createElement('button'); create.type = 'button';
  create.className = 'pairing-primary'; create.textContent = 'Create my device group'; create.hidden = true;
  const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back';
  panel.append(heading, explanation, limits, status, create, back); container.replaceChildren(panel);
  if (focus) heading.focus();
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort();
    create.disabled = true; back.disabled = true;
    reject(new Error('Local setup closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); leave(); }
  });
  create.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || create.hidden || create.disabled) return;
    const moveFocus = document.activeElement === create;
    busy = true; create.disabled = true; panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Saving this device’s identity…';
    try {
      const value = await initializeSoftwarePersona({wasm, store, signal: lifetime.signal});
      if (disposed) return;
      create.hidden = true;
      heading.textContent = 'Device group saved';
      status.textContent = 'Your group is saved in this browser and can be reopened here. No other device is connected yet.';
      resolve(value);
    } catch {
      if (!disposed) {
        // Failure may mean a concurrent tab committed. Never automatically retry
        // with a fresh identity or tell the person nothing could have saved.
        create.hidden = true;
        status.textContent = 'Setup could not finish here. Go Back and reopen setup to check the saved state. Your journeys are still available.';
        reject(new Error('Local setup unavailable'));
      }
    } finally {
      if (!disposed) {
        panel.removeAttribute('aria-busy');
        if (moveFocus && (document.activeElement === create || document.activeElement === document.body)) back.focus();
      }
    }
  });
  const ready = (async () => {
    try {
      const persona = await store.read('candidate-persona', 'active');
      const bootstrap = await store.read('persona-bootstrap', 'initial');
      if (disposed) return;
      if (persona || bootstrap) {
        heading.textContent = 'Saved device state found';
        status.textContent = 'This browser already has device data. It has not been replaced. Return to device settings to continue or recover it.';
      } else {
        status.textContent = 'No device identity was found. This may be first use, or this browser’s data may have been cleared.';
        create.hidden = false;
      }
    } catch {
      if (!disposed) status.textContent = 'This browser’s device data could not be read. Nothing has been replaced. Your journeys are still available.';
    }
  })();
  return Object.freeze({ready, completed, dispose});
}
