import {readJourneyPermission, setJourneyPermission} from './permission.mjs';
const mounted = new WeakMap();
export function showJourneyPermission(container, {wasm, store, expectedGroup, peer, certificate,
  deviceName = 'Selected device', focus = false, onBack = () => {}}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32 || !(peer instanceof Uint8Array)
      || peer.length !== 32 || certificate !== undefined && (!(certificate instanceof Uint8Array) || certificate.length !== 136)) throw Error('Device review unavailable');
  const group = expectedGroup.slice(), selectedPeer = peer.slice(), proof = certificate?.slice();
  const member = Array.from(selectedPeer, b => b.toString(16).padStart(2, '0')).join('');
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const panel = node('section', ''); panel.className = 'pairing-comparison';
  const heading = node('h2', 'Saved-journey sharing'); heading.tabIndex = -1;
  const label = node('p', String(deviceName).slice(0, 100));
  const explanation = node('p', 'Checking this device’s saved permission…');
  const status = node('p', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const action = node('button', ''); action.type = 'button'; action.className = 'pairing-primary'; action.hidden = true;
  const back = node('button', 'Back'); back.type = 'button';
  const details = node('details', ''); details.append(node('summary', 'Device identity'), node('p', member));
  panel.append(heading, label, explanation, status, action, back, details); container.replaceChildren(panel);
  let disposed = false, busy = false, reviewed, allowed, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const dispose = () => {
    if (disposed) return; disposed = true; lifetime.abort(); action.disabled = true; back.disabled = true;
    reject(Error('Journey permission review closed'));
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
    status.textContent = 'Saving your choice on this device…';
    try {
      const receipt = await setJourneyPermission({wasm, store, expectedGroup: group, peer: selectedPeer,
        certificate: proof, allow: !allowed, expectedRevision: reviewed.revision, signal: lifetime.signal});
      if (disposed) return;
      heading.textContent = allowed ? 'Journey-sharing permission removed' : 'Journey-sharing permission saved';
      status.textContent = allowed
        ? 'This device no longer permits journey sharing with the selected device. Copies already shared remain there. Your local saved journeys are kept.'
        : 'Permission is saved here. This screen has not sent any journeys. The other device must also allow sharing before you connect.';
      resolve(receipt);
    } catch {
      if (!disposed) { status.textContent = 'The change could not be confirmed. Go Back and review the saved permission before trying again.'; reject(Error('Journey permission unconfirmed')); }
    } finally {
      if (!disposed) {
        action.hidden = true;
        if (moveFocus && (document.activeElement === document.body || document.activeElement === action)) back.focus();
      }
      busy = false;
    }
  });
  const ready = (async () => {
    try {
      reviewed = await readJourneyPermission({wasm, store, expectedGroup: group});
      if (disposed) return;
      if (reviewed.member === member) throw Error('Choose another device');
      allowed = reviewed.peers.includes(member);
      if (!allowed && !proof) throw Error('Membership proof needed');
      heading.textContent = allowed ? 'Stop sharing saved journeys with this device?' : 'Share saved journeys with this device?';
      explanation.textContent = allowed
        ? 'Stop future exchanges on this device. This does not remove the other device from your trust group or erase copies it already received.'
        : 'Allow saved starting and destination addresses, chosen bus/train/ferry preferences, and changes or removals to be exchanged with this device. Current location, search history and the screen you are using stay local. AT-key access is a separate choice.';
      action.textContent = allowed ? 'Stop journey sharing' : 'Allow journey sharing'; action.hidden = false;
    } catch {
      if (!disposed) { explanation.textContent = 'Sharing permission could not be reviewed. No change has been made by this screen. Go Back to check your devices.'; reject(Error('Journey permission unavailable')); }
    }
  })();
  return Object.freeze({ready, completed, dispose});
}
