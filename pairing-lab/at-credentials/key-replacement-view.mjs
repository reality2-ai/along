import {loadLocalATOwner} from './local-owner.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {updateLocalATPolicy} from './owner-policy.mjs';
import {openLocalATVault} from './local-vault.mjs';
import {showCredentialSetup} from './credential-view.mjs';
const mounted = new WeakMap();
export function showOwnerKeyReplacement(container, {wasm, store, expectedGroup, focus = false, onBack = () => {}}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw new Error('Device group required');
  const group = expectedGroup.slice(), lifetime = new AbortController(), document = container.ownerDocument;
  mounted.get(container)?.();
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const panel = node('section', ''); panel.className = 'pairing-comparison';
  const heading = node('h2', 'Replace your AT key?'); heading.tabIndex = -1;
  const explanation = node('p', 'Have your replacement key from Auckland Transport ready. Continuing stops Along from using the previous key on this device until you save the replacement. Downloaded journeys still work.');
  const limits = node('p', 'This does not change or revoke a key at AT. Manage that with AT. Other devices must receive the updated settings and replacement key; devices that are offline may still hold the previous key.');
  const status = node('p', 'Checking your saved settings…'); status.setAttribute('role', 'status');
  const action = node('button', 'Continue to replacement key'); action.type = 'button'; action.className = 'pairing-primary'; action.hidden = true;
  const back = node('button', 'Back'); back.type = 'button';
  panel.append(heading, explanation, limits, status, action, back); container.replaceChildren(panel);
  let disposed = false, busy = false, reviewed, binding, child, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); child?.dispose(); action.disabled = true; back.disabled = true;
    reject(new Error('Key replacement closed'));
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
    busy = true; action.disabled = true; status.textContent = 'Preparing replacement settings…';
    try {
      await updateLocalATPolicy({wasm, store, expectedGroup: group, expectedRevision: reviewed.revision,
        devices: reviewed.devices, rotate: true, signal: lifetime.signal});
      if (disposed) return;
      child = showCredentialSetup(container, {vault: openLocalATVault({wasm, store, ...binding}), focus: moveFocus, onBack: leave});
      await child.ready;
      const receipt = await child.completed;
      if (!disposed) resolve(receipt);
    } catch {
      if (!disposed && !child) {
        status.textContent = 'Replacement could not be confirmed. Go Back to check the saved settings before trying again.';
        action.hidden = true; if (moveFocus) back.focus();
      }
      reject(new Error('Key replacement unconfirmed'));
    } finally { busy = false; }
  });
  const ready = (async () => {
    try {
      const owner = await loadLocalATOwner({wasm, store, expectedGroup: group, signal: lifetime.signal});
      if (!owner) throw new Error('Owner required');
      binding = owner.binding;
      const policy = await openCredentialPolicyStore({store, ...binding}).read({signal: lifetime.signal});
      const state = await openLocalATVault({wasm, store, ...binding}).inspect({signal: lifetime.signal});
      if (policy.status !== 'policy-loaded' || state.status !== 'saved-unverified') throw new Error('Saved key required');
      if (disposed) return;
      reviewed = policy.policy; status.textContent = 'Back leaves your current key unchanged.'; action.hidden = false;
    } catch {
      if (!disposed) { status.textContent = 'Replacement is unavailable here. Go Back to check the current key settings.'; reject(new Error('Key replacement unavailable')); }
    }
  })();
  return Object.freeze({ready, completed, dispose});
}
