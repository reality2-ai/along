// Experimental invitation sharing UI. The enclosing enrollment controller still
// owns challenge exchange, session comparison and admission. No network send.
import {createSoftwareInvitation} from './software-invitation.mjs';
const mounted = new WeakMap();
export function showSoftwareInvitation(container, {wasm, store, expectedGroup, focus = false,
  lifetimeMs = 60000, onBack = () => {}}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw new Error('Device group required');
  const group = expectedGroup.slice(), document = container.ownerDocument;
  mounted.get(container)?.();
  const lifetime = new AbortController();
  let disposed = false, busy = false, invitation, copyingFocus = false;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const heading = element('h2', 'Invite your other device'); heading.tabIndex = -1;
  const explanation = element('p', 'Keep both devices with you. Create an invitation, then transfer it to Along on your other device. You will need to compare a code on both devices before connecting.');
  const note = element('p', 'An invitation stays open for up to one minute. It contains no AT key or saved journeys. Copying it does not connect a device.');
  const status = element('p', ''); status.setAttribute('role', 'status');
  const start = element('button', 'Create invitation'); start.type = 'button'; start.className = 'pairing-primary';
  const copy = element('button', 'Copy invitation'); copy.type = 'button'; copy.className = 'pairing-primary'; copy.hidden = true;
  const manual = element('details', ''); manual.hidden = true;
  const summary = element('summary', 'Show invitation for manual copying');
  const label = element('label', 'Invitation text');
  const text = element('textarea', ''); text.readOnly = true; text.rows = 4; text.spellcheck = false;
  label.append(text); manual.append(summary, label);
  const back = element('button', 'Back'); back.type = 'button';
  panel.append(heading, explanation, note, status, start, copy, manual, back); container.replaceChildren(panel);
  if (focus) heading.focus();
  const ended = () => {
    if (disposed) return;
    const moveFocus = document.activeElement === copy || manual.contains(document.activeElement)
      || copyingFocus && document.activeElement === document.body;
    copy.hidden = true; manual.hidden = true; manual.open = false; text.value = '';
    start.hidden = false; start.disabled = false; start.textContent = 'Create a new invitation';
    status.textContent = 'This invitation has ended. Create a new one when both devices are ready.';
    if (moveFocus) start.focus();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); invitation?.close(); text.value = '';
    start.disabled = true; copy.disabled = true; back.disabled = true;
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
  start.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || start.hidden) return;
    const moveFocus = document.activeElement === start;
    busy = true; start.disabled = true; panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Preparing your invitation…';
    try {
      invitation?.close();
      const value = await createSoftwareInvitation({wasm, store, expectedGroup: group, signal: lifetime.signal, lifetimeMs});
      if (disposed) { value.close(); return; }
      invitation = value; invitation.signal.addEventListener('abort', ended, {once: true});
      if (invitation.signal.aborted) { ended(); return; }
      start.hidden = true; copy.hidden = false; copy.disabled = false; manual.hidden = false;
      text.value = invitation.descriptor;
      status.textContent = 'Invitation ready. Copy it to your other device, and keep this screen open.';
      if (moveFocus) copy.focus();
    } catch {
      if (!disposed) {
        status.textContent = 'An invitation could not be created. Go Back to check your device group. Your downloaded journeys are still available.';
        start.hidden = true; if (moveFocus) back.focus();
      }
    } finally {
      if (!disposed) { busy = false; panel.removeAttribute('aria-busy'); }
    }
  });
  copy.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || copy.disabled || copy.hidden || !invitation || invitation.signal.aborted) return;
    const selected = invitation; copyingFocus = document.activeElement === copy; copy.disabled = true;
    try {
      await document.defaultView.navigator.clipboard.writeText(selected.descriptor);
      if (!disposed && invitation === selected && !selected.signal.aborted) status.textContent = 'Copied. Paste the invitation on your other device. No device is connected yet.';
    } catch {
      if (!disposed && invitation === selected && !selected.signal.aborted) {
        manual.open = true;
        status.textContent = 'Copy was unavailable. Select and copy the invitation text below.';
        text.focus(); text.select();
      }
    } finally {
      if (!disposed && invitation === selected && !selected.signal.aborted) {
        copy.disabled = false;
        if (copyingFocus && document.activeElement === document.body) copy.focus();
        copyingFocus = false;
      }
    }
  });
  // Trusted controller only. This does not assert comparison, admission or AT permission.
  return Object.freeze({dispose, currentInvitation: () => disposed || invitation?.signal.aborted ? undefined : invitation});
}
