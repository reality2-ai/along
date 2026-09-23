// Experimental adapter to the real browser enrollment session. Not in Along's
// public build. Confirmation still does not establish membership or AT access.
import {showComparison} from './comparison.mjs';
const mounted = new WeakMap();
export function showEnrollmentComparison(container, {session, focus = false}) {
  mounted.get(container)?.();
  const lifetime = new AbortController();
  let view, disposed = false, cancellation;
  const waiting = container.ownerDocument.createElement('p');
  waiting.setAttribute('role', 'status'); waiting.textContent = 'Connecting to your other device…';
  container.replaceChildren(waiting);
  const ended = () => {
    lifetime.abort();
    if (!view && !disposed) waiting.textContent = 'This connection has ended. Start a new invitation to try again.';
  };
  session.signal.addEventListener('abort', ended, {once: true});
  const dispose = () => {
    if (disposed) return cancellation;
    disposed = true; lifetime.abort(); view?.dispose();
    session.signal.removeEventListener('abort', ended);
    if (mounted.get(container) === dispose) mounted.delete(container);
    cancellation = session.cancel(); void cancellation.catch(() => {});
    return cancellation;
  };
  mounted.set(container, dispose);
  const ready = (async () => {
    try {
      const code = await session.comparison();
      if (disposed || session.signal.aborted) throw new Error('Enrollment view ended');
      view = showComparison(container, {code, focus, signal: lifetime.signal,
        onDecision: (matched, signal) => session.decide(matched, signal)});
    } catch (error) {
      ended(); await dispose(); throw error;
    }
  })();
  void ready.catch(() => {});
  if (session.signal.aborted) ended();
  return Object.freeze({ready, dispose});
}
