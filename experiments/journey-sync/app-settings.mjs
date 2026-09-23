import {showJourneyConnection} from './connection-view.mjs';
import {openAppJourneyStore} from './app-store.mjs';
import {enableJourneyTracking, readEnvelope, changedEvent, preferenceKey} from './app-preferences.mjs';

export function mountAppJourneySettings({wasm, store, expectedGroup, member}) {
  const group = Array.from(expectedGroup, b => b.toString(16).padStart(2, '0')).join('');
  const replica = openAppJourneyStore({store, group, actor: member});
  const settings = document.querySelector('#settings');
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const open = node('button', 'Share saved journeys with my devices'); open.type = 'button'; open.className = 'secondary-button';
  settings.insertBefore(open, settings.querySelector('#alerts-open'));
  const dialog = node('dialog', ''); dialog.setAttribute('aria-label', 'Saved journey sharing');
  const content = node('section', ''); content.className = 'pairing-comparison'; dialog.append(content); document.body.append(dialog);
  const lifetime = new AbortController();
  let view, session, disposed = false, status, queue = Promise.resolve(), message = '', generation = 0, starting = false;
  const clear = () => { generation++; starting = false; view?.dispose(); view = undefined; content.replaceChildren(); };
  const report = text => { message = text; if (status?.isConnected) status.textContent = text; };
  const reconcile = (send = false) => {
    queue = queue.then(async () => {
      if (disposed || readEnvelope().sync?.group !== group) return;
      await replica.reconcile({signal: lifetime.signal});
      if (disposed) return;
      if (send && session) {
        await session.synchronize();
        report('Your other device confirmed saving this snapshot. Later changes will be sent while both devices stay connected.');
      }
    }).catch(() => { if (!disposed) report('Sharing is unavailable. Your saved places and pending changes remain on this device. Try connecting again.'); });
    return queue;
  };
  const localChange = event => { if (event.type !== 'storage' || event.key === preferenceKey) void reconcile(true); };
  window.addEventListener(changedEvent, localChange); window.addEventListener('storage', localChange);
  const disconnect = () => {
    const previous = session; session = undefined;
    previous?.signal.removeEventListener('abort', disconnected); previous?.close();
  };
  const disconnected = () => { session = undefined; message = 'Connection ended. Saved changes stay on this device until you reconnect.'; if (dialog.open) home(); };
  const back = () => { clear(); dialog.close(); settings.showModal(); open.focus(); };
  const action = (text, run) => {
    const button = node('button', text); button.type = 'button';
    button.addEventListener('click', event => { if (event.isTrusted && !disposed && !button.disabled) void run(); }); content.append(button); return button;
  };
  const connect = async role => {
    if (starting) return; starting = true;
    const selected = generation;
    try {
      enableJourneyTracking(group); await replica.reconcile({signal: lifetime.signal});
      if (disposed || !dialog.open || generation !== selected) return;
      clear();
      view = showJourneyConnection(content, {wasm, store, expectedGroup, role, focus: true, signal: lifetime.signal, onBack: home,
        onSaved: () => { void reconcile(); },
        onConnected: connected => {
          if (disposed) { connected.close(); return; }
          disconnect(); session = connected;
          session.signal.addEventListener('abort', disconnected, {once: true});
          if (session.signal.aborted) { disconnected(); return; }
          message = 'Connected. Sharing saved places and service preferences…'; home(); void reconcile(true);
        }});
    } catch { if (!disposed && generation === selected) report('Journey sharing could not start. Your saved places have been kept.'); }
    finally { if (generation === selected) starting = false; }
  };
  const home = () => {
    clear();
    const heading = node('h2', session ? 'Your journeys are connected' : 'Share your saved journeys'); heading.tabIndex = -1;
    content.append(heading, node('p', 'Share saved starting places, destinations and service preferences with an enrolled device. Learning history, current location and the journey on screen stay here. This does not require an AT key.'));
    status = node('p', message || 'Both devices must be online and open. Connection currently uses messages you transfer between them.'); status.setAttribute('role', 'status'); content.append(status);
    if (session) {
      action('Check for saved journey changes', () => reconcile(true)).className = 'pairing-primary';
      action('Disconnect journey sharing', () => { disconnect(); message = 'Disconnected. Saved changes stay here until you reconnect.'; home(); });
    } else {
      action('Start journey connection', () => connect('start')).className = 'pairing-primary';
      action('Join journey connection', () => connect('join'));
    }
    action('Back to settings', back); heading.focus();
  };
  open.addEventListener('click', event => { if (event.isTrusted && !disposed) { settings.close(); dialog.showModal(); home(); } });
  dialog.addEventListener('cancel', event => { event.preventDefault(); back(); });
  dialog.addEventListener('close', clear);
  void reconcile();
  return Object.freeze({dispose() {
    if (disposed) return; disposed = true; lifetime.abort(); clear(); disconnect();
    window.removeEventListener(changedEvent, localChange); window.removeEventListener('storage', localChange); open.remove(); dialog.remove();
  }});
}
