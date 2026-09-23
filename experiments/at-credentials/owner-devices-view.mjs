import {loadLocalATOwner} from './local-owner.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {showOwnerDeviceAccess} from './owner-access-view.mjs';

// Lists signed application grants, not all TG members or currently online peers.
export function showOwnerDevices(container, {wasm, store, expectedGroup, focus = false, onBack = () => {}}) {
  const group = expectedGroup.slice(), document = container.ownerDocument;
  const lifetime = new AbortController();
  let disposed = false, child, generation = 0;
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const clear = () => { generation++; child?.dispose(); child = undefined; container.replaceChildren(); return generation; };
  const current = selected => !disposed && selected === generation;
  const dispose = () => { if (!disposed) { disposed = true; lifetime.abort(); clear(); } };
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  const home = async () => {
    const selected = clear();
    const panel = node('section', ''); panel.className = 'pairing-comparison';
    const heading = node('h2', 'Devices with AT-key access'); heading.tabIndex = -1;
    const status = node('p', 'Checking saved permissions…'); status.setAttribute('role', 'status');
    const list = node('div', '');
    const back = node('button', 'Back'); back.type = 'button'; back.addEventListener('click', leave);
    panel.append(heading, status, list, back); container.append(panel);
    if (focus) heading.focus();
    try {
      const owner = await loadLocalATOwner({wasm, store, expectedGroup: group, signal: lifetime.signal});
      if (!owner) throw Error('Owner required');
      const saved = await openCredentialPolicyStore({store, ...owner.binding}).read({signal: lifetime.signal});
      if (saved.status !== 'policy-loaded') throw Error('Policy unavailable');
      if (!current(selected)) return;
      const devices = saved.policy.devices.filter(member => member !== owner.binding.owner);
      status.textContent = devices.length
        ? 'Choose a device to review or remove its permission. These are saved permissions, not a list of devices currently online.'
        : 'No other devices have permission to use your AT key.';
      for (const member of devices) {
        const label = `Device ${member.slice(0, 8)}…${member.slice(-8)}`;
        const button = node('button', label); button.type = 'button';
        button.addEventListener('click', event => {
          if (!event.isTrusted || !current(selected)) return;
          clear();
          child = showOwnerDeviceAccess(container, {wasm, store, expectedGroup: group,
            peer: Uint8Array.from(member.match(/../g), value => parseInt(value, 16)),
            removalOnly: true, deviceName: label, focus, onBack: home});
        });
        list.append(button);
      }
    } catch {
      if (current(selected)) status.textContent = 'Saved permissions could not be read. No access has been changed. Go Back and try again.';
    }
  };
  const ready = home();
  return Object.freeze({ready, dispose});
}
