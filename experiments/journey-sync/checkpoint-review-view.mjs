// Contextual UI only. The owning flow supplies a freshly verified review and a
// guarded writer; successful UI tests alone do not establish durable recovery.
import {JourneyCapacityError} from './state.mjs';
const mounted = new WeakMap();
let sequence = 0;
export function showCheckpointReview(container, {review, onConfirm, onBack = () => {}, initialChoices = [], focus = false, signal, olderCopy = false}) {
  if (!review || !Array.isArray(review.differences) || typeof review.resolve !== 'function' || typeof onConfirm !== 'function') throw Error('Recovery review unavailable');
  mounted.get(container)?.();
  const document = container.ownerDocument, differences = structuredClone(review.differences), choices = new Map();
  for (const choice of initialChoices) {
    if (!differences.some(d => d.id === choice.id) || !['local', 'shared'].includes(choice.use) || choices.has(choice.id)) throw Error('Recovery draft unavailable');
    choices.set(choice.id, choice.use);
  }
  const lifetime = new AbortController();
  let index = 0, disposed = false, busy = false, completed = false;
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const panel = node('section', ''); panel.className = 'pairing-comparison'; container.replaceChildren(panel);
  const dispose = () => {
    if (disposed) return; disposed = true; lifetime.abort(); signal?.removeEventListener('abort', dispose);
    panel.querySelectorAll('button').forEach(button => { button.disabled = true; });
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (!disposed) { const retained = selected(); dispose(); onBack({choices: retained, reviewId: review.id}); } };
  const selected = () => differences.filter(d => choices.has(d.id)).map(d => ({id: d.id, use: choices.get(d.id)}));
  const name = difference => { const value = difference.local ?? difference.shared; return value ? value.from.name + ' → ' + value.to.name : 'Saved journey'; };
  const description = value => value === null ? 'Not saved' : !value.savedRoutes ? 'Saved places · no preferred services'
    : value.savedRoutes.length === 0 ? 'Saved places · walk or roll'
    : 'Saved places · ' + value.savedRoutes.map(r => r.mode[0].toUpperCase() + r.mode.slice(1) + ' ' + r.route).join(' → ');
  const button = (text, action) => {
    const b = node('button', text); b.type = 'button'; panel.append(b);
    b.addEventListener('click', event => { if (event.isTrusted && !disposed && !busy && !b.disabled) void action(); }); return b;
  };
  const render = (moveFocus = true) => {
    if (disposed) return;
    panel.replaceChildren(); panel.removeAttribute('aria-busy');
    const heading = node('h2', index < differences.length ? 'Choose what to keep' : 'Apply your saved-place choices?'); heading.tabIndex = -1; panel.append(heading);
    if (index < differences.length) {
      const difference = differences[index];
      panel.append(node('p', `Journey ${index + 1} of ${differences.length}`), node('h3', name(difference)));
      for (const use of ['local', 'shared']) {
        const label = use === 'local' ? 'This device' : olderCopy ? 'Older app copy' : 'Shared version';
        const detail = node('p', label + ': ' + description(difference[use])); detail.id = 'journey-recovery-choice-' + (++sequence); panel.append(detail);
        const action = button(use === 'local' ? 'Keep this device’s version' : olderCopy ? 'Use older copy’s version' : 'Use shared version', () => {
          choices.set(difference.id, use); index++; render();
        });
        action.setAttribute('aria-describedby', detail.id);
        action.setAttribute('aria-pressed', String(choices.get(difference.id) === use));
      }
      panel.append(node('p', 'Nothing is applied until you confirm all your choices.'));
    } else {
      panel.append(node('p', differences.length ? 'Review your choices, then apply them on this device. Other devices receive changes when sharing reconnects.'
        : olderCopy ? 'These saved places already agree. Continue to acknowledge the older copy’s edits.' : 'Your retained saved places agree with the shared version. Continue to finish recovery on this device.'));
      if (differences.length) {
        const details = node('details', ''), summary = node('summary', 'Review all choices'), list = node('ul', '');
        for (const difference of differences) list.append(node('li', name(difference) + ': ' + description(difference[choices.get(difference.id)])));
        details.append(summary, list); panel.append(details);
      }
      const status = node('p', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true'); panel.append(status);
      let allowed = true;
      try { review.resolve(selected()); }
      catch (error) { allowed = false; status.textContent = error instanceof JourneyCapacityError
        ? 'These choices exceed the sharing limit. Go Back to change a choice. Your existing data is still kept.'
        : 'These choices need to be reviewed again. Your existing data is still kept.'; }
      const apply = button('Apply choices on this device', async () => {
        busy = true; apply.disabled = true; panel.setAttribute('aria-busy', 'true'); status.textContent = 'Checking and saving your choices…';
        try {
          const result = await onConfirm({reviewId: review.id, choices: selected(), signal: lifetime.signal});
          if (disposed) return;
          if (result?.status !== 'journey-recovery-applied-locally' || result.reviewId !== review.id) throw Error('Unconfirmed recovery');
          completed = true; panel.replaceChildren(); panel.removeAttribute('aria-busy');
          const done = node('h2', 'Saved-place choices applied here'); done.tabIndex = -1;
          panel.append(done, node('p', 'This confirms this device only. Check your other devices after they reconnect.'));
          busy = false; button('Back', leave); done.focus();
        } catch {
          if (!disposed) { status.textContent = 'Your choices could not be confirmed. Return to recovery to check the saved result before trying again.'; apply.disabled = true; }
        } finally { busy = false; if (!disposed) panel.removeAttribute('aria-busy'); }
      });
      apply.className = 'pairing-primary'; apply.disabled = !allowed;
    }
    button('Back', () => { if (index > 0) { index--; render(); } else leave(); });
    // Leaving remains available while a writer runs, but does not promise to undo
    // a committed write. The owning flow must recover its retained result.
    const cancel = node('button', 'Leave review'); cancel.type = 'button'; panel.append(cancel);
    cancel.addEventListener('click', event => { if (event.isTrusted) leave(); });
    if (moveFocus) heading.focus();
  };
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); } });
  signal?.addEventListener('abort', dispose, {once: true});
  if (signal?.aborted) dispose(); else render(focus);
  return Object.freeze({dispose, get choices() { return structuredClone(selected()); }, get completed() { return completed; }});
}
