import {loadSoftwareIssuer} from './software-persona.mjs';
import {openMembership} from './membership.mjs';
import {removeSoftwareMember} from './member-removal.mjs';
import {showRemovalTransfer} from './removal-transfer-view.mjs';
const mounted = new WeakMap();
export function showMemberRemoval(container, {wasm, store, expectedGroup, subject, certificate,
  deviceName = 'Selected device', focus = false, onBack = () => {}}) {
  if (![expectedGroup, subject].every(value => value instanceof Uint8Array && value.length === 32)
      || !(certificate instanceof Uint8Array) || certificate.length !== 136) throw Error('Device review unavailable');
  const group = expectedGroup.slice(), peer = subject.slice(), proof = certificate.slice();
  const peerId = Array.from(peer, b => b.toString(16).padStart(2, '0')).join('');
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const panel = node('section', ''); panel.className = 'pairing-comparison';
  const heading = node('h2', 'Remove this device from your group?'); heading.tabIndex = -1;
  const label = node('p', String(deviceName).slice(0, 100));
  const explanation = node('p', 'This saves a group removal on this device. Share its signed message with your other devices so they can enforce it too. Automatic delivery and group-key replacement are not available in this preview.');
  const limits = node('p', 'This cannot erase saved journeys or an AT key already copied to that device. Replace an exposed AT key with Auckland Transport. Your local journeys are kept.');
  const status = node('p', 'Checking the selected device and your group authority…'); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const remove = node('button', 'Save device removal here'); remove.type = 'button'; remove.className = 'pairing-primary'; remove.hidden = true;
  const back = node('button', 'Back'); back.type = 'button';
  const details = node('details', ''); details.append(node('summary', 'Device identity'), node('p', peerId));
  panel.append(heading, label, explanation, limits, status, remove, back, details); container.replaceChildren(panel);
  let disposed = false, busy = false, resolve, reject, child;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const dispose = () => {
    if (disposed) return; disposed = true; lifetime.abort(); child?.dispose(); remove.disabled = true; back.disabled = true;
    reject(Error('Device removal review closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
  if (focus) heading.focus();
  remove.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || remove.hidden || remove.disabled) return;
    const moveFocus = document.activeElement === remove;
    busy = true; remove.disabled = true; panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Saving the signed removal on this device…';
    try {
      const receipt = await removeSoftwareMember({wasm, store, expectedGroup: group, subject: peer,
        certificate: proof, signal: lifetime.signal});
      if (disposed) return;
      heading.textContent = 'Device removal saved here';
      status.textContent = 'The removal is saved on this device. It has not been delivered to your other devices. Previously shared copies remain available there.';
      offerTransfer(receipt.evidence);
      resolve(receipt);
    } catch {
      if (!disposed) { status.textContent = 'Removal could not be confirmed. Go Back and review this device again to check the saved result.'; reject(Error('Device removal unconfirmed')); }
    } finally {
      if (!disposed) {
        remove.hidden = true; panel.removeAttribute('aria-busy');
        if (moveFocus && (document.activeElement === remove || document.activeElement === document.body)) back.focus();
      }
      busy = false;
    }
  });
  const offerTransfer = evidence => {
    const share = node('button', 'Share this removal'); share.type = 'button'; share.className = 'pairing-primary';
    share.addEventListener('click', event => {
      if (!event.isTrusted || disposed) return;
      child = showRemovalTransfer(container, {wasm, store, expectedGroup: group, evidence, focus, onBack: leave});
    }); panel.insertBefore(share, back);
  };
  const ready = (async () => {
    let issuer, membership;
    try {
      issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal: lifetime.signal});
      if (issuer.member === peerId) throw Error('Self removal unavailable');
      const member = Uint8Array.from(issuer.member.match(/../g), b => parseInt(b, 16));
      membership = openMembership(store, wasm, group, member);
      const standing = await membership.peerStatus(proof, peer);
      if (disposed) return;
      if (standing === 'revoked') {
        heading.textContent = 'Device removal already saved here';
        status.textContent = 'This device already holds the signed removal. This does not confirm delivery to other devices.';
        const saved = await store.read('membership', Array.from(group, b => b.toString(16).padStart(2, '0')).join(''));
        if (disposed) return;
        const evidence = saved?.value?.revocations.find(value => Array.from(value.subject, b => b.toString(16).padStart(2, '0')).join('') === peerId);
        if (!evidence) throw Error('Removal unavailable');
        offerTransfer(evidence);
      } else if (['current', 'stale'].includes(standing)) {
        status.textContent = 'Check the device identity before saving this removal.'; remove.hidden = false;
      } else throw Error('Membership unavailable');
    } catch {
      if (!disposed) { status.textContent = 'This device removal could not be reviewed. No removal was made by this screen. Go Back to check your group.'; reject(Error('Device removal unavailable')); }
    } finally { membership?.close(); issuer?.close(); }
  })();
  return Object.freeze({ready, completed, dispose});
}
