import {acceptRemoteATOwner} from './remote-owner.mjs';
const mounted = new WeakMap();
// The enclosing trusted pairing flow has already selected and verified this
// device. This view asks about AT access, not whether an arbitrary peer is trusted.
export function showRemoteOwnerConsent(container, {wasm, store, expected, ownerCertificate,
  policyBytes, policySignature, connection, focus = false, onBack = () => {}}) {
  const binding = Object.freeze({...expected});
  const inputs = {wasm, store, expected: binding, ownerCertificate: ownerCertificate.slice(),
    policyBytes: policyBytes.slice(), policySignature: policySignature.slice(), connection};
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, busy = false, finished = false, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const heading = element('h2', 'Use your connected device’s AT key?'); heading.tabIndex = -1;
  const explanation = element('p', 'Your connected device can share its Auckland Transport key with this device. The key will be stored encrypted in this browser and sent directly to AT when you choose live information.');
  const choice = element('p', 'This is optional. Your downloaded journeys still work without it. The key’s owner controls future sharing. Access changes take effect here when this device receives them.');
  const status = element('p', 'Checking the connection…'); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const allow = element('button', 'Allow this device to receive the key'); allow.type = 'button'; allow.className = 'pairing-primary'; allow.hidden = true;
  const back = element('button', 'Back'); back.type = 'button';
  const details = element('details', ''), summary = element('summary', 'Connected device identity');
  details.append(summary, element('p', String(binding.owner)));
  panel.append(heading, explanation, choice, status, allow, back, details); container.replaceChildren(panel);
  if (focus) heading.focus();
  const disconnected = () => {
    if (disposed || busy || finished) return;
    allow.hidden = true; status.textContent = 'The connection is no longer available. Go Back to reconnect. Your downloaded journeys still work.';
    reject(new Error('AT consent connection unavailable'));
  };
  connection.signal.addEventListener('abort', disconnected);
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); allow.disabled = true; back.disabled = true;
    connection.signal.removeEventListener('abort', disconnected);
    reject(new Error('AT consent closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
  allow.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || finished || allow.hidden || connection.signal.aborted) return;
    const moveFocus = document.activeElement === allow;
    busy = true; allow.disabled = true; status.textContent = 'Saving your choice on this device…';
    try {
      const receipt = await acceptRemoteATOwner({...inputs, signal: lifetime.signal});
      if (disposed) return;
      finished = true; heading.textContent = 'Ready to receive the key';
      status.textContent = 'Your choice is saved. The key has not been received yet.';
      resolve(receipt);
    } catch {
      if (!disposed) {
        status.textContent = 'Your choice could not be confirmed here. Go Back to check your device settings. Downloaded journeys are still available.';
        reject(new Error('AT consent unconfirmed'));
      }
    } finally {
      busy = false;
      if (!disposed) {
        allow.hidden = true;
        if (moveFocus && (document.activeElement === allow || document.activeElement === document.body)) back.focus();
      }
    }
  });
  const ready = (async () => {
    try {
      await connection.authenticated();
      if (disposed) return;
      if (connection.signal.aborted) { disconnected(); return; }
      status.textContent = 'Only continue if you want to use the key from the device you just connected.';
      allow.hidden = false;
    } catch { disconnected(); }
  })();
  return Object.freeze({ready, completed, dispose});
}
