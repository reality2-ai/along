// Browser-subset initial trust review only. No membership write, networking or
// cryptographic authorization happens merely because a person reviews this text.
import {decodeSoftwareInvitation, encodeSoftwareInvitation} from './software-invitation.mjs';
const mounted = new WeakMap();
export function showReceiveInvitation(container, {focus = false, onBack = () => {}} = {}) {
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, reviewed, accepted = false, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const heading = element('h2', 'Paste your invitation'); heading.tabIndex = -1;
  const explanation = element('p', 'On your other device, create an invitation in Along and copy it here. Keep that device’s invitation screen open.');
  const label = element('label', 'Invitation text');
  const input = element('textarea', ''); input.rows = 4; input.maxLength = 1024; input.spellcheck = false; input.autocomplete = 'off'; label.append(input);
  const status = element('p', ''); status.setAttribute('role', 'status');
  const scan = element('button', 'Scan invitation QR code'); scan.type = 'button';
  const scanArea = element('div', '');
  const next = element('button', 'Review invitation'); next.type = 'button'; next.className = 'pairing-primary';
  const back = element('button', 'Back'); back.type = 'button';
  panel.append(heading, explanation, label, scan, scanArea, status, next, back); container.replaceChildren(panel);
  if (focus) heading.focus();
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); scanArea.replaceChildren(); reviewed = undefined; input.value = '';
    next.disabled = true; back.disabled = true; reject(new Error('Invitation review closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const goBack = () => {
    if (disposed) return;
    if (reviewed && !accepted) {
      reviewed = undefined; label.hidden = false; scan.hidden = false;
      heading.textContent = 'Paste your invitation';
      explanation.textContent = 'On your other device, create an invitation in Along and copy it here. Keep that device’s invitation screen open.';
      next.textContent = 'Review invitation'; status.textContent = ''; input.focus();
    } else { dispose(); onBack(); }
  };
  back.addEventListener('click', goBack);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); goBack(); } });
  next.addEventListener('click', event => {
    if (!event.isTrusted || disposed || accepted) return;
    if (!reviewed) {
      try {
        reviewed = encodeSoftwareInvitation(decodeSoftwareInvitation(input.value.trim()));
        label.hidden = true; scan.hidden = true; scanArea.replaceChildren(); heading.textContent = 'Is this from your other device?';
        explanation.textContent = 'Continue only if you just copied this invitation from Along on a device you control. Do not use an invitation sent by someone else. You will still compare a code on both devices before joining the group.';
        status.textContent = 'The invitation’s format is recognised. Its source and expiry have not been verified.';
        next.textContent = 'Use invitation from my other device'; heading.focus();
      } catch {
        status.textContent = 'This invitation could not be read. Update Along on both devices, then copy a new invitation and try again.';
        input.setAttribute('aria-invalid', 'true'); input.focus();
      }
    } else {
      accepted = true; next.hidden = true; input.value = '';
      heading.textContent = 'Invitation reviewed';
      status.textContent = 'Ready to check the other device’s proof. This device has not joined the group yet.';
      resolve(Object.freeze({descriptor: reviewed, signal: lifetime.signal})); back.focus();
    }
  });
  scan.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || reviewed || scan.disabled) return;
    scan.disabled = true;
    try {
      const module = await import('./qr-transfer.mjs');
      if (!disposed && !reviewed) await module.scanTransferQr(scanArea, input, lifetime.signal);
    } catch { if (!disposed) status.textContent = 'Scanning is unavailable. Paste the device message instead.'; } finally { if (!disposed) scan.disabled = false; }
  });
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); if (!reviewed) status.textContent = ''; });
  return Object.freeze({completed, dispose});
}
