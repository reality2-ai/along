import {showLocalSetup} from '../tg-pairing/setup-view.mjs';
import {showPairingFlow} from '../tg-pairing/pairing-flow.mjs';
import {showRecoveryFlow} from '../tg-pairing/recovery-flow.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {loadATBinding} from './local-owner.mjs';
import {showATSettings} from './settings-view.mjs';
import {showKeySharingFlow} from './key-sharing-flow.mjs';
import {showOwnerDevices} from './owner-devices-view.mjs';
import {showMemberDevices} from '../tg-pairing/member-devices-view.mjs';
import {showRemovalTransfer} from '../tg-pairing/removal-transfer-view.mjs';

// Lazy, explicit setup inside the journey app. This owns its storage handle;
// onChanged may borrow it until disposal. No automatic identity or key creation.
export function mountAppDeviceSettings({onChanged}) {
  const settings = document.querySelector('#settings');
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const open = node('button', 'Device and AT-key setup'); open.type = 'button'; open.className = 'secondary-button';
  settings.insertBefore(open, settings.querySelector('#alerts-open'));
  const dialog = node('dialog', ''); dialog.setAttribute('aria-label', 'Device and AT-key setup');
  const content = node('div', ''); dialog.append(content); document.body.append(dialog);
  let store, wasm, child, disposed = false, generation = 0;
  const clear = () => { generation++; child?.dispose(); child = undefined; content.replaceChildren(); return generation; };
  const active = value => !disposed && dialog.open && value === generation;
  const back = () => {
    clear(); dialog.close(); settings.showModal(); open.focus();
    // A quick return while the overview is loading must still discover a key
    // just saved by a child view. This never holds the journey screen open.
    if (store && wasm) void (async () => {
      try {
        const saved = await store.read('candidate-persona', 'active');
        const group = saved?.value?.record?.group;
        if (!group || disposed || dialog.open) return;
        const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
        const binding = await loadATBinding({wasm, store, expectedGroup: group});
        if (!disposed && !dialog.open && identity) onChanged({wasm, store, group, binding, member: identity.member});
      } catch { /* Saved state is retained; planning remains available. */ }
    })();
  };
  const frame = (title, text) => {
    const panel = node('section', ''); panel.className = 'pairing-comparison';
    const heading = node('h2', title); heading.tabIndex = -1;
    const status = node('p', text); status.setAttribute('role', 'status'); panel.append(heading, status); content.append(panel); heading.focus();
    return {panel, heading, status};
  };
  const action = (panel, title, run, primary = false) => {
    const button = node('button', title); button.type = 'button'; if (primary) button.className = 'pairing-primary';
    const selected = generation;
    button.addEventListener('click', event => { if (event.isTrusted && active(selected)) void run(); }); panel.append(button);
  };
  const home = async () => {
    const selected = clear();
    const {panel, heading, status} = frame('Your devices and AT key', 'Checking this browser’s saved setup…');
    const returnButton = node('button', 'Back to settings'); returnButton.type = 'button';
    returnButton.addEventListener('click', back); panel.append(returnButton);
    try {
      if (!store) {
        const storage = await import('../tg-pairing/storage.mjs'); if (!active(selected)) return;
        const opened = await storage.openBrowserStorage('along-pairing-lab-v1');
        if (!active(selected)) { opened.close(); return; } store = opened;
      }
      if (!wasm) {
        const runtime = await import('../tg-pairing/hive_wasm.js'); if (!active(selected)) return;
        await runtime.default(); if (!active(selected)) return; wasm = runtime;
      }
      const saved = await store.read('candidate-persona', 'active'); if (!active(selected)) return;
      if (!saved) {
        heading.textContent = 'Set up this device';
        status.textContent = 'Device connection and live information are optional. Scheduled journey planning works without setup.';
        action(panel, 'Set up my device', () => {
          clear(); child = showLocalSetup(content, {wasm, store, focus: true, onBack: home});
          const setup = child;
          void setup.completed.then(() => { if (!disposed && child === setup) return home(); }).catch(() => {});
        }, true);
      } else {
        const group = saved.value.record.group;
        action(panel, 'Receive a group removal', () => {
          clear(); child = showRemovalTransfer(content, {wasm, store, expectedGroup: group, focus: true, onBack: home});
        });
        const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); if (!active(selected)) return;
        if (!identity) throw Error('Saved identity unavailable');
        const binding = await loadATBinding({wasm, store, expectedGroup: group}); if (!active(selected)) return;
        onChanged({wasm, store, group, binding, member: identity.member});
        status.textContent = binding?.role === 'recipient'
          ? 'This device has a saved sharing choice. Use the connection option in Settings when you want live information.'
          : 'Your device identity is saved. Choose only the optional setup you need.';
        const show = (view, options = {}) => { clear(); child = view(content, {wasm, store, expectedGroup: group, focus: true, onBack: home, ...options}); };
        action(panel, binding ? 'Manage my AT key' : 'Use my own AT key', () => show(showATSettings), true);
        action(panel, binding?.role === 'owner' ? 'Share my AT key' : 'Receive a shared AT key', () => show(showKeySharingFlow, {role: binding?.role === 'owner' ? 'owner' : 'recipient'}));
        if (binding?.role === 'owner') action(panel, 'Manage AT access on other devices', () => show(showOwnerDevices));
        const details = node('details', ''); details.append(node('summary', 'Connect or recover another device'));
        if (identity.origin === 'initial' || !identity.peerAcknowledged) panel.append(details);
        if (identity.origin === 'initial') {
          action(details, 'Invite my other device', () => show(showPairingFlow, {role: 'provisioner'}));
          action(details, 'Review group devices', () => show(showMemberDevices, {databaseName: 'along-pairing-lab-v1'}));
          action(details, 'Join my other device', () => show(showPairingFlow, {role: 'candidate'}));
          action(details, 'Confirm an interrupted connection', () => show(showRecoveryFlow, {role: 'provisioner'}));
        } else if (!identity.peerAcknowledged) action(details, 'Recover installation confirmation', () => show(showRecoveryFlow, {role: 'candidate'}));
      }
      // Put the return action after the current task's choices.
      panel.append(returnButton);
    } catch {
      if (active(selected)) status.textContent = 'Device setup could not be read. Your saved data has been kept. Return to Settings and continue with downloaded journeys.';
    }
  };
  open.addEventListener('click', event => {
    if (!event.isTrusted || disposed) return;
    settings.close(); dialog.showModal(); void home();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); back(); });
  dialog.addEventListener('close', () => { if (!dialog.open) clear(); });
  return Object.freeze({dispose() {
    if (disposed) return; disposed = true; clear(); store?.close(); open.remove(); dialog.remove();
  }});
}
