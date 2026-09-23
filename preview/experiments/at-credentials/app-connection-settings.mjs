import {showPolicyConnection} from './policy-connection-view.mjs';
import {createScopedSessionClient} from './scoped-session-client.mjs';
import {createSavedATClient} from './saved-client.mjs';
import {configureAppLiveConnection} from './app-live-bridge.mjs';

// Experimental app only. A connection survives closing Settings, but not pagehide
// or an explicit disconnect. This screen does not establish key sharing.
export function mountAppConnectionSettings({wasm, store, expectedGroup, role}) {
  const settings = document.querySelector('#settings');
  if (!settings) throw new Error('Settings unavailable');
  let view, session, disposed = false;
  const node = (tag, text) => { const value = document.createElement(tag); value.textContent = text; return value; };
  const open = node('button', 'Connect an existing AT-key device'); open.type = 'button'; open.className = 'secondary-button';
  const dialog = node('dialog', ''); dialog.setAttribute('aria-label', 'AT-key device connection');
  const content = node('div', ''); dialog.append(content); document.body.append(dialog);
  settings.insertBefore(open, settings.querySelector('#alerts-open'));
  const local = () => configureAppLiveConnection(role === 'owner'
    ? () => createSavedATClient({wasm, store, expectedGroup}) : undefined);
  local();
  const closeView = () => { view?.dispose(); view = undefined; };
  const back = () => { closeView(); dialog.close(); settings.showModal(); open.focus(); };
  const disconnected = () => {
    session = undefined;
    if (!disposed) { local(); if (dialog.open) home(); }
  };
  const disconnect = () => {
    const previous = session; session = undefined;
    previous?.signal.removeEventListener('abort', disconnected); previous?.close();
    if (!disposed) local();
  };
  const home = () => {
    closeView(); content.replaceChildren();
    const heading = node('h2', session ? 'Your devices are connected' : 'Connect your existing devices'); heading.tabIndex = -1;
    const status = node('p', session
      ? 'Keep the AT-key owner device open while checking live information. You can close this window and continue planning.'
      : 'Use this after both devices have been set up to share an AT key. Downloaded journey planning always works without a connection.');
    status.setAttribute('role', 'status');
    const action = node('button', session ? 'Disconnect devices' : 'Connect devices'); action.type = 'button'; action.className = 'secondary-button';
    action.addEventListener('click', event => {
      if (!event.isTrusted || disposed) return;
      if (session) { disconnect(); home(); return; }
      view = showPolicyConnection(content, {wasm, store, expectedGroup, role, focus: true, onBack: home,
        onConnected: connected => {
          if (disposed) { connected.close(); return; }
          session = connected;
          session.signal.addEventListener('abort', disconnected, {once: true});
          if (session.signal.aborted) { disconnected(); return; }
          if (role === 'recipient') configureAppLiveConnection(() => createScopedSessionClient(connected));
          home();
        }});
    });
    const done = node('button', 'Back to settings'); done.type = 'button'; done.className = 'secondary-button'; done.addEventListener('click', back);
    content.append(heading, status, action, done); heading.focus();
  };
  open.addEventListener('click', event => {
    if (!event.isTrusted || disposed) return;
    settings.close(); dialog.showModal(); home();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); back(); });
  dialog.addEventListener('close', closeView);
  return Object.freeze({dispose() {
    if (disposed) return;
    disposed = true; closeView(); disconnect(); configureAppLiveConnection(undefined); open.remove(); dialog.remove();
  }});
}
