// Review an already connected recovery session. The flow owns signaling; this
// screen owns cancellation once mounted and never treats sending as delivery.
const mounted = new WeakMap();
export function showEpochRecoveryReview(container, {session, focus = false, onBack = () => {}}) {
  mounted.get(container)?.();
  const document = container.ownerDocument;
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const panel = node('section', ''); panel.className = 'pairing-comparison';
  const heading = node('h2', 'Checking your other device'); heading.tabIndex = -1;
  const explanation = node('p', 'Both saved device identities must be verified before you can accept an update. Your downloaded journeys remain available.');
  const status = node('p', 'Keep both devices open…'); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const action = node('button', 'Receive group key update'); action.type = 'button'; action.className = 'pairing-primary'; action.hidden = true;
  const back = node('button', 'Back'); back.type = 'button';
  panel.append(heading, explanation, status, action, back); container.replaceChildren(panel);
  let disposed = false, busy = false, finished = false, context, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const dispose = () => {
    if (disposed) return;
    disposed = true; session.signal.removeEventListener('abort', failed); session.close();
    action.disabled = true; back.disabled = true; reject(Error('Recovery review closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  const failed = () => {
    if (disposed || finished) return;
    finished = true; action.hidden = true; panel.removeAttribute('aria-busy');
    heading.textContent = 'Key update is not confirmed';
    status.textContent = 'The connection ended before this screen could confirm the saved keys. Keep this device’s data and reconnect to check its saved version. Downloaded journeys are still available.';
    reject(Error('Recovery installation unconfirmed'));
    session.close();
    if (document.activeElement === action || document.activeElement === document.body) back.focus();
  };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); } });
  session.signal.addEventListener('abort', failed, {once: true});
  if (focus) heading.focus();
  const ready = (async () => {
    try {
      context = await session.authenticated();
      if (disposed || finished) return;
      if (session.signal.aborted) throw Error('Recovery ended');
      const confirmationOnly = context.from === context.to;
      heading.textContent = confirmationOnly ? 'Confirm your saved group keys?' : 'Receive your group key update?';
      action.textContent = confirmationOnly ? 'Check saved keys and send confirmation' : 'Receive group key update';
      explanation.textContent = confirmationOnly
        ? 'Your other device needs confirmation of the keys already saved here. This checks the saved installation without replacing your keys.'
        : 'The device that invited you has newer group keys. Accept to update this device so it can connect again. This does not share journeys or an AT API key.';
      status.textContent = confirmationOnly ? `Both devices use key version ${context.to}.`
        : `This device uses key version ${context.from}. Your other device offers version ${context.to}.`;
      action.hidden = false;
    } catch { failed(); }
  })();
  action.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || finished || busy || action.hidden || action.disabled || !context) return;
    busy = true; action.disabled = true; panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Accepted. Keep both devices open while the other device sends the update or requests confirmation.';
    try {
      await session.acceptRecovery();
      const installed = await session.installation();
      if (disposed || finished) return;
      if (installed.status !== 'installed-local' || installed.epoch !== context.to) throw Error('Different installation');
      finished = true; action.hidden = true;
      heading.textContent = 'Group keys saved on this device';
      status.textContent = `Key version ${installed.epoch} is saved here. Check your other device for its installation confirmation before closing this screen. If that connection is interrupted, reconnect to confirm these saved keys.`;
      resolve(installed);
      if (document.activeElement === action || document.activeElement === document.body) back.focus();
    } catch { failed(); }
    finally { if (!disposed) panel.removeAttribute('aria-busy'); busy = false; }
  });
  if (session.signal.aborted) failed();
  return Object.freeze({ready, completed, dispose});
}
