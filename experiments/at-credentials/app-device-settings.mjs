import {showAutomaticPairing} from '../tg-pairing/automatic-pairing-view.mjs';
import {showConnectedSharing} from '../tg-pairing/connected-sharing-view.mjs';
import {readRelayConfiguration} from '../relay/configuration.mjs';
import {showLocalSetup} from '../tg-pairing/setup-view.mjs';
import {showPairingFlow} from '../tg-pairing/pairing-flow.mjs';
import {showRecoveryFlow} from '../tg-pairing/recovery-flow.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {loadATBinding, loadATConnectionBinding} from './local-owner.mjs';
import {showATSettings} from './settings-view.mjs';
import {showKeySharingFlow} from './key-sharing-flow.mjs';
import {showOwnerDevices} from './owner-devices-view.mjs';
import {showEpochRotation} from '../tg-pairing/epoch-rotation-view.mjs';
import {showEpochRecoveryFlow} from '../tg-pairing/epoch-recovery-flow.mjs';
import {showMemberDevices} from '../tg-pairing/member-devices-view.mjs';
import {showRemovalTransfer} from '../tg-pairing/removal-transfer-view.mjs';

// Lazy, explicit setup inside the journey app. This owns its storage handle;
// onChanged may borrow it until disposal. No automatic identity or key creation.
export function mountAppDeviceSettings({onChanged,connectionInvitation}) {
  const settings = document.querySelector('#settings');
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const open = node('button', 'My devices'); open.type = 'button'; open.className = 'secondary-button';
  settings.insertBefore(open, settings.querySelector('#alerts-open'));
  const dialog = node('dialog', ''); dialog.setAttribute('aria-label', 'My devices');
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
  const announce = async () => {
    const saved = await store.read('candidate-persona','active');
    const group = saved?.value?.record?.group;
    if (!group || disposed) return;
    const identity = await loadLocalPersona({wasm,store,expectedGroup:group});
    let binding;
    try { binding = await loadATConnectionBinding({wasm,store,expectedGroup:group}); } catch {}
    if (!disposed && identity) onChanged({wasm,store,group,binding,member:identity.member});
  };
  const guided = options => {
    clear();let sharing;
    const pairing = showAutomaticPairing(content,{wasm,store,focus:true,onBack:home,...options,
      onConnected:announce,
      onShare:result=>{
        // Keep enrollment alive while the last acknowledgment reaches the peer.
        sharing=showConnectedSharing(content,{wasm,store,expectedGroup:result.group,peer:result.peer,
          relay:result.relay,focus:true,onBack:home,onChanged:announce});
      }});
    child={dispose(){sharing?.dispose();pairing.dispose();}};
  };
  const home = async () => {
    const selected = clear();
    const {panel, heading, status} = frame('My devices', 'Checking this browser’s saved setup…');
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
      if (connectionInvitation) {
        const incoming=connectionInvitation;connectionInvitation=undefined;
        if(incoming.invalid){status.textContent='The invitation expired or could not be read. Ask your other device for a new invitation.';return;}
        guided({role:'candidate',connectionText:incoming.invitation});return;
      }
      if (!saved) {
        heading.textContent = 'Set up this device';
        status.textContent = 'Device connection and live information are optional. Scheduled journey planning works without setup.';
        action(panel,'Connect to my other device',()=>guided({role:'candidate'}),true);
        action(panel, 'Set up my device', () => {
          clear(); child = showLocalSetup(content, {wasm, store, focus: true, onBack: home});
          const setup = child;
          void setup.completed.then(() => { if (!disposed && child === setup) return home(); }).catch(() => {});
        }, true);
      } else {
        const group = saved.value.record.group;
        const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); if (!active(selected)) return;
        if (!identity) throw Error('Saved identity unavailable');
        let binding, bindingAvailable = true;
        try { binding = await loadATBinding({wasm, store, expectedGroup: group}); }
        catch {
          bindingAvailable = false;
          try { binding = await loadATConnectionBinding({wasm, store, expectedGroup: group}); } catch { /* Keep unreadable state. */ }
        }
        if (!active(selected)) return;
        onChanged({wasm, store, group, binding, member: identity.member});
        status.textContent = !bindingAvailable
          ? 'Your saved AT setup could not be verified. It has been kept. Group connection and recovery options remain available below.'
          : binding?.role === 'recipient'
          ? 'This device has a saved sharing choice. Use the connection option in Settings when you want live information.'
          : 'Your device identity is saved. Choose only the optional setup you need.';
        const show = (view, options = {}) => {
          clear(); child = view(content, {wasm, store, expectedGroup: group, focus: true, onBack: home, ...options});
          if (view === showEpochRecoveryFlow && options.role === 'recipient') {
            // Renew evidence for an existing AT owner only. Group-key recovery
            // does not create an AT binding or change its policy/credential.
            void child.completed.then(async installed => {
              if (disposed) return;
              const {renewATOwnerCertificate} = await import('./owner-certificate.mjs');
              if (disposed) return;
              await renewATOwnerCertificate({wasm, store, expectedGroup: group, certificate: installed.ownerCertificate});
              const restored = await loadATBinding({wasm, store, expectedGroup: group});
              const local = await loadLocalPersona({wasm, store, expectedGroup: group});
              if (!disposed && local) onChanged({wasm, store, group, binding: restored, member: local.member});
            }).catch(() => { /* Group installation remains saved; unreadable AT state is preserved. */ });
          }
        };
        if(identity.origin==='initial'){
          let relay='';
          try{const configured=await readRelayConfiguration({store,expectedGroup:group,member:identity.member});if(configured.enabled)relay=configured.url;}catch{}
          if(!active(selected))return;
          action(panel,'Connect another device',()=>guided({role:'provisioner',expectedGroup:group,relay}),true);
        }
        if (bindingAvailable) {
          action(panel, binding ? 'Manage my AT key' : 'Use my own AT key', () => show(showATSettings), true);
          action(panel, binding?.role === 'owner' ? 'Share my AT key' : 'Receive a shared AT key', () => show(showKeySharingFlow, {role: binding?.role === 'owner' ? 'owner' : 'recipient'}));
          if (binding?.role === 'owner') action(panel, 'Manage AT access on other devices', () => show(showOwnerDevices));
        }
        const details = node('details', ''); details.append(node('summary', 'Advanced device options'));
        panel.append(details);
        action(details,'Receive a group removal',()=>show(showRemovalTransfer));
        if (identity.origin === 'initial') {
          action(details, 'Invite my other device', () => show(showPairingFlow, {role: 'provisioner'}));
          action(details, 'Update group keys on this device', () => show(showEpochRotation));
          if (identity.epoch > 0n) action(details, 'Send a group key update', () => show(showMemberDevices, {databaseName: 'along-pairing-lab-v1', purpose: 'update'}));
          action(details, 'Review group devices', () => show(showMemberDevices, {databaseName: 'along-pairing-lab-v1'}));
          action(details, 'Join my other device', () => show(showPairingFlow, {role: 'candidate'}));
          action(details, 'Confirm an interrupted connection', () => show(showRecoveryFlow, {role: 'provisioner'}));
        } else {
          action(details, 'Receive a group key update', () => show(showEpochRecoveryFlow, {role: 'recipient'}));
          if (!identity.peerAcknowledged) action(details, 'Recover installation confirmation', () => show(showRecoveryFlow, {role: 'candidate'}));
        }
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
  const openInvitation=value=>{if(disposed)return;connectionInvitation=value;if(settings.open)settings.close();if(!dialog.open)dialog.showModal();void home();};
  if(connectionInvitation)openInvitation(connectionInvitation);
  dialog.addEventListener('cancel', event => { event.preventDefault(); back(); });
  dialog.addEventListener('close', () => { if (!dialog.open) clear(); });
  return Object.freeze({openInvitation,dispose() {
    if (disposed) return; disposed = true; clear(); store?.close(); open.remove(); dialog.remove();
  }});
}
