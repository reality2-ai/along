import {readJourneyPermission} from './permission.mjs';
import {showJourneyPermission} from './permission-view.mjs';

// Saved local application permissions, not a live device directory or TG roster.
export function showJourneyDevices(container, {wasm, store, expectedGroup, focus = false,
  onBack = () => {}, onRemoved = () => {}}) {
  const group = expectedGroup.slice(), document = container.ownerDocument;
  let disposed = false, child, generation = 0;
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const clear = () => { generation++; child?.dispose(); child = undefined; container.replaceChildren(); return generation; };
  const current = selected => !disposed && selected === generation;
  const dispose = () => { if (!disposed) { disposed = true; clear(); } };
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  const home = async () => {
    const selected = clear(), panel = node('section', ''); panel.className = 'pairing-comparison';
    const heading = node('h2', 'Devices allowed to share saved journeys'); heading.tabIndex = -1;
    const status = node('p', 'Checking saved sharing permissions…'); status.setAttribute('role', 'status');
    const list = node('div', '');
    const back = node('button', 'Back'); back.type = 'button'; back.addEventListener('click', leave);
    panel.append(heading, status, list, back); container.append(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); } });
    if (focus) heading.focus();
    try {
      const saved = await readJourneyPermission({wasm, store, expectedGroup: group});
      if (!current(selected)) return;
      status.textContent = saved.peers.length
        ? 'Choose a device to review or stop journey sharing. These are permissions saved here, not devices currently online. You can stop sharing while the other device is offline.'
        : 'No other devices have permission here to share saved journeys. Your local saved places are kept.';
      for (const member of saved.peers) {
        const label = `Device ${member.slice(0, 8)}…${member.slice(-8)}`;
        const button = node('button', label); button.type = 'button';
        button.addEventListener('click', event => {
          if (!event.isTrusted || !current(selected)) return;
          const reviewGeneration = clear();
          child = showJourneyPermission(container, {wasm, store, expectedGroup: group,
            peer: Uint8Array.from(member.match(/../g), byte => parseInt(byte, 16)),
            deviceName: label, focus, onBack: home});
          // No certificate is supplied: this view can remove saved access, never
          // silently grant it again if permission changed after listing devices.
          void child.completed.then(() => { if (current(reviewGeneration)) onRemoved(member); }).catch(() => {});
        });
        list.append(button);
      }
    } catch {
      if (current(selected)) status.textContent = 'Saved permissions could not be read. No permission has been changed by this screen. Go Back and try again.';
    }
  };
  const ready = home();
  return Object.freeze({ready, dispose});
}
