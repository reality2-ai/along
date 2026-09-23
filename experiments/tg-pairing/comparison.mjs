// Isolated UI component. Not loaded by Along and not an enrollment authority.
const activeViews = new WeakMap();
export function showComparison(container, {code, onDecision, signal, focus = false}) {
  if (!(code instanceof Uint8Array) || code.length !== 4 || typeof onDecision !== 'function') throw new TypeError('Invalid comparison screen');
  activeViews.get(container)?.();
  const lifetime = new AbortController();
  const groups = [...code].map(byte => byte.toString(16).padStart(2, '0').toUpperCase());
  const doc = container.ownerDocument;
  const section = doc.createElement('section'); section.className = 'pairing-comparison';
  const title = doc.createElement('h2'); title.textContent = 'Do both devices show this code?'; title.tabIndex = -1;
  const explanation = doc.createElement('p'); explanation.textContent = 'Look at the code on each device. Continue only when you have both devices with you and every character matches.';
  const display = doc.createElement('p'); display.className = 'pairing-code';
  const visual = doc.createElement('span'); visual.textContent = groups.join(' '); visual.setAttribute('aria-hidden', 'true');
  const spoken = doc.createElement('span'); spoken.className = 'pairing-screen-reader';
  spoken.textContent = 'Comparison code: ' + groups.map(group => [...group].join(', ')).join('; ') + '.';
  display.append(visual, spoken);
  const match = doc.createElement('button'); match.type = 'button'; match.className = 'pairing-primary'; match.textContent = 'Both devices are here and the codes match';
  const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel — codes differ or I’m unsure';
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const boundary = doc.createElement('p'); boundary.className = 'pairing-note'; boundary.textContent = 'Comparing codes does not finish pairing. Enrollment must still complete before this device can use shared information.';
  section.append(title, explanation, display, match, cancel, status, boundary); container.replaceChildren(section);
  let decided = false, disposed = false;
  const expire = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); match.disabled = true; cancel.disabled = true;
    status.textContent = 'This comparison has ended. Start a new invitation to try again.';
  };
  const decide = async matched => {
    if (decided || disposed || signal?.aborted) return;
    decided = true; match.disabled = true; cancel.disabled = true;
    status.textContent = matched ? 'Comparison confirmed. Waiting for enrollment.' : 'Cancelling this invitation…';
    try {
      await onDecision(matched, lifetime.signal);
      if (!disposed) status.textContent = matched ? 'Comparison confirmed. Enrollment is not yet complete.' : 'This invitation was cancelled.';
    } catch {
      if (!disposed) status.textContent = 'Could not finish this step. Start a new invitation to try again.';
    }
  };
  match.addEventListener('click', event => { if (event.isTrusted) void decide(true); });
  cancel.addEventListener('click', () => { void decide(false); });
  section.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void decide(false); }
  });
  const dispose = () => {
    expire(); signal?.removeEventListener('abort', expire);
    if (activeViews.get(container) === dispose) activeViews.delete(container);
  };
  activeViews.set(container, dispose);
  signal?.addEventListener('abort', expire, {once: true});
  if (signal?.aborted) expire();
  if (focus) title.focus();
  return Object.freeze({dispose});
}
