// Destructive action is fixed to the lab database; never a caller-selected name.
export const LAB_DATABASE = 'along-device-preview-devices-v1';
export function showLabReset(container, {store, onBack, onRemoved, focus = false}) {
  const document = container.ownerDocument;
  let disposed = false, started = false, removed = false;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const heading = element('h2', 'Remove this test device?'); heading.tabIndex = -1;
  const explanation = element('p', 'This removes only this browser’s pairing-lab identity, group keys, membership and local AT-key settings. Along’s saved journeys are not removed. You will lose this test identity and may lose the ability to invite devices to its group.');
  const limits = element('p', 'Other devices keep their data. This does not revoke group membership elsewhere or revoke an AT key. Close other pairing-lab tabs first. Once removal starts, it cannot be cancelled.');
  const remove = element('button', 'Remove this test device data'); remove.type = 'button';
  const back = element('button', 'Keep this test device'); back.type = 'button'; back.className = 'pairing-primary';
  const next = element('button', 'Return to setup'); next.type = 'button'; next.className = 'pairing-primary'; next.hidden = true;
  const status = element('p', ''); status.setAttribute('role', 'status');
  panel.append(heading, explanation, limits, back, remove, status, next); container.replaceChildren(panel);
  if (focus) heading.focus();
  const leave = () => { if (!disposed && !started) { disposed = true; onBack(); } };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !started) { event.preventDefault(); leave(); } });
  remove.addEventListener('click', event => {
    if (!event.isTrusted || disposed || started) return;
    started = true; remove.disabled = true; back.hidden = true;
    status.textContent = 'Removing this browser’s test device data…';
    try {
      store.close();
      const request = document.defaultView.indexedDB.deleteDatabase(`r2-browser:${LAB_DATABASE}`);
      request.onblocked = () => {
        if (!disposed) status.textContent = 'Removal is waiting. Close other pairing-lab tabs. The request will continue when they close; it cannot be cancelled.';
      };
      request.onerror = () => {
        if (!disposed) status.textContent = 'Removal could not be confirmed. Reopen the lab to check the saved state before setting up again.';
      };
      request.onsuccess = () => {
        removed = true;
        if (disposed) return;
        heading.textContent = 'Test device data removed';
        status.textContent = 'The lab’s saved state was removed from this browser. Other devices and Along’s journeys were not changed.';
        remove.hidden = true; next.hidden = false; next.focus();
      };
    } catch {
      if (!disposed) status.textContent = 'Removal could not be started. Reopen the lab to check its saved state.';
    }
  });
  next.addEventListener('click', event => {
    if (!event.isTrusted || disposed || !removed) return;
    disposed = true; onRemoved();
  });
  return Object.freeze({dispose: () => { disposed = true; }});
}
