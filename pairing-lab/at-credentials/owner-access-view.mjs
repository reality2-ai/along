import {loadLocalATOwner} from './local-owner.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {updateLocalATPolicy} from './owner-policy.mjs';
const mounted = new WeakMap();
// The enclosing device-selection flow supplies the selected member and certificate.
// A friendly label is display text only; the exact member identity is reviewable.
export function showOwnerDeviceAccess(container, {wasm, store, expectedGroup, peer, certificate,
  deviceName = 'Selected device', focus = false, onBack = () => {}}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || !(peer instanceof Uint8Array) || peer.length !== 32
      || !(certificate instanceof Uint8Array) || certificate.length !== 136) throw new Error('Device access unavailable');
  const group = expectedGroup.slice(), member = Array.from(peer, b => b.toString(16).padStart(2, '0')).join('');
  const proof = certificate.slice();
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const panel = node('section', ''); panel.className = 'pairing-comparison';
  const heading = node('h2', 'AT access for this device'); heading.tabIndex = -1;
  const label = node('p', String(deviceName).slice(0, 100));
  const explanation = node('p', 'Checking saved access…');
  const status = node('p', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const action = node('button', ''); action.type = 'button'; action.className = 'pairing-primary'; action.hidden = true;
  const back = node('button', 'Back'); back.type = 'button';
  const details = node('details', ''); details.append(node('summary', 'Device identity'), node('p', member));
  panel.append(heading, label, explanation, status, action, back, details); container.replaceChildren(panel);
  let disposed = false, busy = false, reviewed, granted, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); action.disabled = true; back.disabled = true;
    reject(new Error('Device access review closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
  if (focus) heading.focus();
  action.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || action.hidden || !reviewed) return;
    const moveFocus = document.activeElement === action;
    busy = true; action.disabled = true;
    status.textContent = 'Saving the access change on this device…';
    try {
      const devices = granted ? reviewed.devices.filter(id => id !== member) : [...reviewed.devices, member];
      const result = await updateLocalATPolicy({wasm, store, expectedGroup: group,
        expectedRevision: reviewed.revision, devices, certificates: [proof], signal: lifetime.signal});
      if (disposed) return;
      heading.textContent = granted ? 'Access removal saved' : 'Access permission saved';
      status.textContent = granted
        ? 'The change is saved here. The other device must receive it. This does not invalidate a copied key at Auckland Transport.'
        : 'The change is saved here. The key has not been sent. The other device must accept it before delivery.';
      resolve(result);
    } catch {
      if (!disposed) {
        status.textContent = 'The change could not be confirmed. Go Back and review the current device access before trying again.';
        reject(new Error('Device access change unconfirmed'));
      }
    } finally {
      busy = false;
      if (!disposed) { action.hidden = true; if (moveFocus) back.focus(); }
    }
  });
  const ready = (async () => {
    try {
      const owner = await loadLocalATOwner({wasm, store, expectedGroup: group, signal: lifetime.signal});
      if (!owner || owner.binding.owner === member) throw new Error('Owner required');
      const saved = await openCredentialPolicyStore({store, ...owner.binding}).read({signal: lifetime.signal});
      if (saved.status !== 'policy-loaded') throw new Error('Policy required');
      if (disposed) return;
      reviewed = saved.policy; granted = reviewed.devices.includes(member);
      heading.textContent = granted ? 'Remove this device’s AT access?' : 'Allow this device to use your AT key?';
      explanation.textContent = granted
        ? 'This removes permission to use and receive your AT key. Downloaded journey planning still works. A device that is offline will not learn about the change until it reconnects.'
        : 'This allows the selected trust-group device to receive your AT key for optional live information. Downloaded journey planning does not need this permission.';
      action.textContent = granted ? 'Remove AT access' : 'Allow AT access'; action.hidden = false;
    } catch {
      if (!disposed) { explanation.textContent = 'Device access could not be loaded. Go Back to check your connection and settings.'; reject(new Error('Device access unavailable')); }
    }
  })();
  return Object.freeze({ready, completed, dispose});
}
