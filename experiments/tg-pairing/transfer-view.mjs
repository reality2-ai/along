// Public device-message transfer only. The controller validates the message and
// owns protocol resources. No automatic clipboard read or network transmission.
const mounted = new WeakMap();
export function showDeviceTransfer(container, {title, explanation, outgoing, incomingLabel = 'Reply from your other device',
  action = 'Check reply', receive = true, onReceive, signal, focus = false, onBack = () => {}}) {
  if (typeof receive !== 'boolean' || typeof onReceive !== 'function' || typeof outgoing !== 'string' || outgoing.length > 65536) throw new Error('Transfer configuration unavailable');
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, busy = false, finished = false, copying = false, left = false;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const heading = element('h2', title); heading.tabIndex = -1;
  const description = element('p', explanation);
  const status = element('p', ''); status.setAttribute('role', 'status');
  const copy = element('button', 'Copy device message'); copy.type = 'button'; copy.className = 'pairing-primary';
  const details = element('details', ''), summary = element('summary', 'Show message for manual copying');
  const label = element('label', 'Device message to copy'), output = element('textarea', '');
  output.readOnly = true; output.rows = 4; output.value = outgoing; output.spellcheck = false;
  label.append(output); details.append(summary, label);
  const incoming = element('label', incomingLabel), input = element('textarea', '');
  input.rows = 4; input.maxLength = 65536; input.spellcheck = false; input.autocomplete = 'off'; incoming.append(input);
  const submit = element('button', action); submit.type = 'button';
  const qr = element('button', 'Show QR code'); qr.type = 'button';
  const qrArea = element('div', '');
  const scan = element('button', 'Scan device message'); scan.type = 'button';
  const scanArea = element('div', '');
  const back = element('button', 'Back'); back.type = 'button';
  panel.append(heading, description, copy, qr, qrArea, details, incoming, scan, scanArea, submit, status, back); container.replaceChildren(panel);
  if (!receive) { incoming.hidden = true; scan.hidden = true; }
  if (!outgoing) { qr.hidden = true; copy.hidden = true; details.hidden = true; submit.className = 'pairing-primary'; }
  if (focus) heading.focus();
  const end = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); signal?.removeEventListener('abort', end);
    output.value = ''; input.value = ''; qr.hidden = true; scan.hidden = true; qrArea.replaceChildren(); scanArea.replaceChildren(); copy.hidden = true; details.hidden = true; incoming.hidden = true; submit.hidden = true;
    panel.removeAttribute('aria-busy');
    status.textContent = 'This exchange has ended. Go Back and start again when both devices are ready.';
    if ((panel.contains(document.activeElement) || busy && document.activeElement === document.body) && document.activeElement !== back) back.focus();
    if (mounted.get(container) === end) mounted.delete(container);
  };
  mounted.set(container, end);
  signal?.addEventListener('abort', end, {once: true});
  const leave = () => { if (!left) { left = true; end(); onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
  qr.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || finished) return;
    try {
      const module = await import('./qr-transfer.mjs');
      if (!disposed && !finished) module.renderTransferQr(qrArea, outgoing);
    } catch { if (!disposed && !finished) status.textContent = 'This message cannot be shown as a QR code. Use Copy device message instead.'; }
  });
  scan.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || finished || scan.disabled) return;
    scan.disabled = true;
    try {
      const module = await import('./qr-transfer.mjs');
      if (!disposed && !finished) await module.scanTransferQr(scanArea, input, lifetime.signal);
    } catch { if (!disposed) status.textContent = 'Scanning is unavailable. Paste the device message instead.'; } finally { if (!disposed && !finished) scan.disabled = false; }
  });
  copy.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || copying || busy || finished) return;
    copying = true;
    try {
      await document.defaultView.navigator.clipboard.writeText(outgoing);
      if (!disposed && !finished) status.textContent = receive ? 'Copied. Transfer this message to your other device, then paste its reply here.' : 'Copied. Transfer this message to your other device, then continue here.';
    } catch {
      if (!disposed && !finished) { details.open = true; output.focus(); output.select(); status.textContent = 'Copy was unavailable. Select and copy the device message below.'; }
    } finally { copying = false; }
  });
  input.addEventListener('input', () => {
    if (!disposed && !finished) { submit.className = input.value.trim() ? 'pairing-primary' : ''; copy.className = input.value.trim() ? '' : 'pairing-primary'; }
  });
  submit.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy || finished) return;
    const value = receive ? input.value.trim() : '';
    if (receive && (!value || value.length > 65536)) { status.textContent = 'Paste the message from your other device first.'; input.focus(); return; }
    scanArea.replaceChildren();
    busy = true; submit.disabled = true; panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Checking the device message…';
    try {
      // The controller must honor this signal before/after async work and pass
      // it into any newly created session. It retains ownership of its results.
      await onReceive(value, lifetime.signal);
      if (disposed) return;
      finished = true; output.value = ''; input.value = ''; qr.hidden = true; scan.hidden = true; qrArea.replaceChildren(); scanArea.replaceChildren();
      copy.hidden = true; details.hidden = true; incoming.hidden = true; submit.hidden = true;
      status.textContent = 'Device message checked. Connecting still requires the remaining steps on both devices.';
      if (panel.contains(document.activeElement) || document.activeElement === document.body) back.focus();
    } catch {
      if (!disposed) { end(); status.textContent = 'This message could not be accepted. Go Back and start a new exchange. Your downloaded journeys are still available.'; }
    } finally { if (!disposed) panel.removeAttribute('aria-busy'); }
  });
  if (signal?.aborted) end();
  return Object.freeze({dispose: end, signal: lifetime.signal});
}
