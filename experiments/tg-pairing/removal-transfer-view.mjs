import {showDeviceTransfer} from './transfer-view.mjs';
import {encodeRemoval, receiveRemoval} from './removal-message.mjs';

export function showRemovalTransfer(container, {wasm, store, expectedGroup, evidence, focus = false, onBack = () => {}}) {
  const group = expectedGroup.slice(), document = container.ownerDocument;
  let disposed = false, transfer;
  const dispose = () => { if (!disposed) { disposed = true; transfer?.dispose(); } };
  const leave = () => { dispose(); onBack(); };
  transfer = showDeviceTransfer(container, {
    title: evidence ? 'Share this group removal' : 'Receive a group removal', focus,
    explanation: evidence
      ? 'Copy this signed removal to each remaining device. It contains device identities, not journeys or AT keys. Copying does not confirm delivery. On the other device, choose Receive a group removal.'
      : 'Paste a signed removal from another device in your group. Along checks its group signature before saving it. This can remove this device’s group access; downloaded journey planning remains available.',
    outgoing: evidence ? encodeRemoval(group, evidence) : '', receive: !evidence,
    incomingLabel: 'Signed group removal', action: evidence ? 'Done' : 'Check and save removal', onBack: leave,
    onReceive: async (text, signal) => {
      if (evidence) { leave(); return; }
      const receipt = await receiveRemoval({wasm, store, expectedGroup: group, text, signal});
      if (disposed) return;
      transfer.dispose();
      const panel = document.createElement('section'); panel.className = 'pairing-comparison';
      const heading = document.createElement('h2'); heading.textContent = 'Group removal saved'; heading.tabIndex = -1;
      const status = document.createElement('p'); status.setAttribute('role', 'status');
      status.textContent = receipt.thisDeviceRemoved
        ? 'This device is removed from the group according to the signed update. Local journeys are kept. Previously copied data and AT keys have not been erased or replaced.'
        : 'This device has saved the signed removal and will enforce it. This does not confirm delivery to any other device or replace group keys.';
      const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back'; back.addEventListener('click', leave);
      panel.append(heading, status, back); container.replaceChildren(panel); heading.focus();
      panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
    },
  });
  return Object.freeze({dispose});
}
