import {loadLocalPersona} from './local-persona.mjs';
import {loadSoftwareIssuer} from './software-persona.mjs';
import {installPreparedIssuerEpoch} from './epoch-installation.mjs';
const mounted = new WeakMap();

// Review one explicit successor. Reopening is required before another update;
// a concurrent tab cannot turn approval of version N into approval of N + 1.
export function showEpochRotation(container, {wasm, store, expectedGroup, focus = false, onBack = () => {}}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw Error('Group update unavailable');
  const group = expectedGroup.slice(), document = container.ownerDocument, lifetime = new AbortController();
  mounted.get(container)?.();
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const panel = node('section', ''); panel.className = 'pairing-comparison';
  const heading = node('h2', 'Update your group keys?'); heading.tabIndex = -1;
  const explanation = node('p', 'This changes the keys your devices use to communicate. Other devices must receive the update before they can connect again. Your downloaded journeys stay available.');
  const limits = node('p', 'This does not replace your AT API key or erase copies already shared. Remove an unwanted device from the group before updating these keys.');
  const status = node('p', 'Checking this device’s group authority…'); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const action = node('button', 'Update keys on this device'); action.type = 'button'; action.className = 'pairing-primary'; action.hidden = true;
  const back = node('button', 'Back'); back.type = 'button';
  panel.append(heading, explanation, limits, status, action, back); container.replaceChildren(panel);
  let disposed = false, busy = false, reviewed, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); action.disabled = true; back.disabled = true;
    reject(Error('Group update review closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); } });
  if (focus) heading.focus();
  const ready = (async () => {
    let issuer;
    try {
      issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal: lifetime.signal});
      const local = await loadLocalPersona({wasm, store, expectedGroup: group});
      if (disposed) return;
      if (local?.origin !== 'initial' || local.member !== issuer.member || local.epoch === 0xffffffffffffffffn) throw Error('Group update unavailable');
      reviewed = {member: local.member, epoch: local.epoch};
      status.textContent = `This device uses key version ${reviewed.epoch}. Continue to save version ${reviewed.epoch + 1n} here. No other device is updated by this step.`;
      action.hidden = false;
    } catch {
      if (!disposed) { status.textContent = 'Group keys could not be reviewed. Nothing was changed by this screen. Go Back to continue planning.'; reject(Error('Group update unavailable')); }
    } finally { issuer?.close(); }
  })();
  action.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || action.hidden || action.disabled || !reviewed) return;
    const moveFocus = document.activeElement === action;
    busy = true; action.disabled = true; panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Saving new group keys on this device…';
    let issuer;
    try {
      issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal: lifetime.signal});
      const local = await loadLocalPersona({wasm, store, expectedGroup: group});
      if (disposed || local?.member !== reviewed.member || local.epoch !== reviewed.epoch) throw Error('Reviewed version changed');
      const prepared = await issuer.prepareRotation();
      if (disposed || prepared.from !== reviewed.epoch || prepared.to !== reviewed.epoch + 1n) throw Error('Reviewed version changed');
      const installed = await installPreparedIssuerEpoch({wasm, store, expectedGroup: group, epoch: prepared.to, signal: lifetime.signal});
      if (disposed) return;
      heading.textContent = 'Group keys updated on this device';
      status.textContent = `Key version ${installed.epoch} is saved here. This does not confirm that any other device has received it. Each device needs an update connection and its own confirmation.`;
      resolve(Object.freeze({status: 'installed-local', epoch: installed.epoch, delivered: false}));
    } catch {
      if (!disposed) { status.textContent = 'The key update could not be confirmed. Go Back and reopen this review to check the saved version. Your saved data has been kept.'; reject(Error('Group update unconfirmed')); }
    } finally {
      issuer?.close(); busy = false;
      if (!disposed) {
        action.hidden = true; panel.removeAttribute('aria-busy');
        if (moveFocus && (document.activeElement === action || document.activeElement === document.body)) back.focus();
      }
    }
  });
  return Object.freeze({ready, completed, dispose});
}
