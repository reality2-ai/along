import {readIssuedMembers} from './software-persona.mjs';
import {showEpochRecoveryFlow} from './epoch-recovery-flow.mjs';
import {showMemberRemoval} from './member-removal-view.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {openMembership} from './membership.mjs';
import {readRecoveryReceipt} from './epoch-recovery-receipt.mjs';
import {restoreIssuedMembers} from './legacy-members.mjs';

let nextDescription = 0;
export function showMemberDevices(container, {wasm, store, expectedGroup, databaseName, purpose = 'review', focus = false, onBack = () => {}}) {
  if (!['review', 'update'].includes(purpose)) throw Error('Device list purpose unavailable');
  const updating = purpose === 'update';
  const group = expectedGroup.slice(), document = container.ownerDocument;
  let child, disposed = false, generation = 0, reading;
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const clear = () => { generation++; reading?.abort(); child?.dispose(); child = undefined; container.replaceChildren(); return generation; };
  const current = selected => !disposed && generation === selected;
  const dispose = () => { if (!disposed) { disposed = true; clear(); } };
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  const home = async () => {
    const selected = clear(), panel = node('section', ''); panel.className = 'pairing-comparison';
    reading = new AbortController();
    const heading = node('h2', updating ? 'Choose a device to update' : 'Devices issued membership here'); heading.tabIndex = -1;
    const status = node('p', 'Checking saved device certificates…'); status.setAttribute('role', 'status');
    const explanation = node('p', updating ? 'Choose your other device, then open Receive a group key update there. A saved certificate does not mean it is online or finished joining.' : 'Choose a device to review its group removal. A saved certificate does not mean the device finished joining or is online. Completed older enrollments are recovered from saved receipts; interrupted older enrollments may still be missing.');
    const list = node('div', '');
    const back = node('button', 'Back'); back.type = 'button'; back.addEventListener('click', leave);
    panel.append(heading, explanation, status, list, back); container.append(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); } });
    if (focus) heading.focus();
    let membership;
    try {
      if (databaseName) await restoreIssuedMembers({wasm, store, expectedGroup: group, databaseName, signal: reading.signal});
      const members = await readIssuedMembers({wasm, store, expectedGroup: group});
      const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
      if (identity?.origin !== 'initial') throw Error('Group authority unavailable');
      membership = openMembership(store, wasm, group, Uint8Array.from(identity.member.match(/../g), b => parseInt(b, 16)));
      if (!current(selected)) return;
      if (updating && identity.epoch === 0n) { status.textContent = 'Update group keys on this device first, then return to send them to another device.'; return; }
      status.textContent = updating && members.length ? 'Select the device that needs new keys or confirmation of its saved keys.' : members.length ? 'Select a device to see its full identity and saved removal status.' : 'No issued device certificates are saved in this list.';
      for (const entry of members) {
        const member = Array.from(entry.subject, b => b.toString(16).padStart(2, '0')).join('');
        const label = `Device ${member.slice(0, 8)}…${member.slice(-8)}`;
        const button = node('button', label); button.type = 'button';
        button.addEventListener('click', event => {
          if (!event.isTrusted || !current(selected) || button.disabled) return;
          if (updating) {
            clear(); child = showEpochRecoveryFlow(container, {wasm, store, expectedGroup: group, role: 'owner', peer: entry.subject, focus, onBack: home});
            return;
          }
          clear(); child = showMemberRemoval(container, {wasm, store, expectedGroup: group,
            subject: entry.subject, certificate: entry.certificate, deviceName: label, focus, onBack: home});
        });
        let confirmation = '';
        if (updating) button.disabled = true;
        try {
          const standing = await membership.peerStatus(entry.certificate, entry.subject);
          if (standing === 'revoked') confirmation = 'Removal saved here.';
          else if (!['current', 'stale'].includes(standing)) throw Error('Device standing unavailable');
          else if (identity.epoch > 0n) {
            if (updating) button.disabled = false;
            const receipt = await readRecoveryReceipt({wasm, store, group, subject: entry.subject, epoch: identity.epoch, signal: reading.signal});
            confirmation = receipt ? `Confirmed installation of key version ${receipt.epoch}. This is a saved receipt, not online status.`
              : `No installation confirmation saved for key version ${identity.epoch}.`;
          }
        } catch { confirmation = 'Key-update confirmation could not be verified. No saved data was changed.'; }
        if (!current(selected)) return;
        const row = node('div', ''); row.append(button);
        if (confirmation) {
          const description = node('p', confirmation); description.id = `along-device-confirmation-${++nextDescription}`;
          button.setAttribute('aria-describedby', description.id); row.append(description);
        }
        list.append(row);
      }
    } catch { if (current(selected)) status.textContent = 'The saved device list could not be read. Nothing has been replaced. Go Back to continue planning.'; }
    finally { membership?.close(); }
  };
  const ready = home();
  return Object.freeze({ready, dispose});
}
