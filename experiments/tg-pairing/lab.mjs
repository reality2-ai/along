// Standalone development entry point. Its separate database is not isolation from
// scripts on the same origin. It is not loaded by the public journey app.
import * as wasm from './hive_wasm.js';
import {openBrowserStorage} from './storage.mjs';
import {showLocalSetup} from './setup-view.mjs';
import {showPairingFlow} from './pairing-flow.mjs';
import {showRecoveryFlow} from './recovery-flow.mjs';
import {showATSettings} from '../at-credentials/settings-view.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {loadSoftwareIssuer} from './software-persona.mjs';
import {LAB_DATABASE, showLabReset} from './lab-reset.mjs';
const container = document.querySelector('#lab');
let store, view, generation = 0, closed = false;
const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const clear = () => { generation++; view?.dispose(); view = undefined; container.replaceChildren(); return generation; };
const reset = () => {
  const selected = clear();
  view = showLabReset(container, {store, focus: true, onBack: showHome, onRemoved: async () => {
    try {
      const opened = await openBrowserStorage(LAB_DATABASE);
      if (closed || selected !== generation) { opened.close(); return; }
      store = opened; await showHome();
    } catch { if (!closed && selected === generation) container.replaceChildren(element('p', 'The lab could not reopen storage. Reload this page to try again.')); }
  }});
};
const showHome = async () => {
  const selected = clear();
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const heading = element('h2', 'Connect your devices'); heading.tabIndex = -1;
  const status = element('p', 'Checking saved device data…'); status.setAttribute('role', 'status'); panel.append(heading, status); container.append(panel); heading.focus();
  const action = (name, callback, primary = false) => {
    const button = element('button', name); button.type = 'button'; if (primary) button.className = 'pairing-primary';
    button.addEventListener('click', event => { if (event.isTrusted && !closed && selected === generation) callback(); }); panel.append(button);
  };
  try {
    const saved = await store.read('candidate-persona', 'active');
    const bootstrap = await store.read('persona-bootstrap', 'initial');
    if (closed || selected !== generation) return;
    if (!saved && !bootstrap) {
      status.textContent = 'No device identity was found. This may be first use or cleared browser data.';
      action('Set up this test device', () => {
        clear(); const setup = showLocalSetup(container, {wasm, store, focus: true, onBack: showHome}); view = setup;
        void setup.completed.then(() => { if (view === setup && !closed) return showHome(); }).catch(() => {});
      }, true);
      return;
    }
    status.textContent = 'Saved device data exists. Restore it to check its membership and available actions. Nothing will be replaced.';
    action('Restore saved test device', async () => {
      let restoringGeneration = selected;
      try {
        // This lab explicitly trusts this origin's locally persisted group choice,
        // then verifies record/certificate/journal consistency. It is not a trust
        // root obtained from a network message or protection from storage rollback.
        const group = saved?.value?.record?.group;
        if (!(group instanceof Uint8Array) || group.length !== 32) throw new Error('Saved group unavailable');
        const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
        if (!identity) throw new Error('Saved identity unavailable');
        if (closed || selected !== generation) return;
        const next = clear(), body = element('section', ''); restoringGeneration = next; body.className = 'pairing-comparison';
        const title = element('h2', 'Choose the next step'); title.tabIndex = -1;
        const info = element('p', identity.origin === 'initial'
          ? 'This browser has its own device group. Invite your other device, or join the group it has created.'
          : identity.peerAcknowledged ? 'This device has joined a group and received installation confirmation.'
          : 'This device has joined a group locally. Confirmation from the other device is still unverified. Keep this data for recovery.');
        body.append(title, info); container.append(body); title.focus();
        const button = (name, fn) => { const b = element('button', name); b.type = 'button'; b.addEventListener('click', event => { if (event.isTrusted && !closed && next === generation) fn(); }); body.append(b); };
        const pair = role => { clear(); view = showPairingFlow(container, {wasm, store, role, expectedGroup: group, focus: true, onBack: showHome}); };
        if (identity.origin === 'initial') {
          const issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group}); issuer.close();
          if (closed || next !== generation) return;
          button('Invite my other device', () => pair('provisioner'));
          button('Join my other device', () => pair('candidate'));
        }
        const recover = role => { clear(); view = showRecoveryFlow(container, {wasm, store, role, expectedGroup: group, focus: true, onBack: showHome}); };
        if (identity.origin === 'enrolled' && !identity.peerAcknowledged) button('Recover installation confirmation', () => recover('candidate'));
        if (identity.origin === 'initial') button('Confirm an interrupted connection', () => recover('provisioner'));
        button('Test optional AT-key storage', () => { clear(); view = showATSettings(container, {wasm, store, expectedGroup: group, focus: true, onBack: showHome}); });
        button('Back', showHome);
      } catch {
        if (!closed && generation === restoringGeneration) { clear(); const note = element('p', 'Saved device data could not be restored. It has not been replaced. Recovery needs separate development. Use the lab’s remove option only if you intend to lose this test identity.'); note.setAttribute('role', 'status'); container.append(note); const back = element('button', 'Back'); back.type = 'button'; back.addEventListener('click', showHome); container.append(back); }
      }
    }, true);
    action('Remove this test device data…', reset);
  } catch { if (!closed && selected === generation) status.textContent = 'Device storage could not be read. Nothing has been replaced.'; }
};
try {
  if (!isSecureContext) throw new Error('Secure origin required');
  await wasm.default(); store = await openBrowserStorage(LAB_DATABASE); await showHome();
} catch { container.replaceChildren(element('p', 'This test could not start. Use HTTPS or localhost with browser storage enabled.')); }
window.addEventListener('pagehide', () => { closed = true; clear(); store?.close(); });
