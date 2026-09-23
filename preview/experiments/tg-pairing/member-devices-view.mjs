import {readIssuedMembers} from './software-persona.mjs';
import {showMemberRemoval} from './member-removal-view.mjs';
import {restoreIssuedMembers} from './legacy-members.mjs';

export function showMemberDevices(container, {wasm, store, expectedGroup, databaseName, focus = false, onBack = () => {}}) {
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
    const heading = node('h2', 'Devices issued membership here'); heading.tabIndex = -1;
    const status = node('p', 'Checking saved device certificates…'); status.setAttribute('role', 'status');
    const explanation = node('p', 'Choose a device to review its group removal. A saved certificate does not mean the device finished joining or is online. Completed older enrollments are recovered from saved receipts; interrupted older enrollments may still be missing.');
    const list = node('div', '');
    const back = node('button', 'Back'); back.type = 'button'; back.addEventListener('click', leave);
    panel.append(heading, explanation, status, list, back); container.append(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); } });
    if (focus) heading.focus();
    try {
      if (databaseName) await restoreIssuedMembers({wasm, store, expectedGroup: group, databaseName, signal: reading.signal});
      const members = await readIssuedMembers({wasm, store, expectedGroup: group});
      if (!current(selected)) return;
      status.textContent = members.length ? 'Select a device to see its full identity and saved removal status.' : 'No issued device certificates are saved in this list.';
      for (const entry of members) {
        const member = Array.from(entry.subject, b => b.toString(16).padStart(2, '0')).join('');
        const label = `Device ${member.slice(0, 8)}…${member.slice(-8)}`;
        const button = node('button', label); button.type = 'button';
        button.addEventListener('click', event => {
          if (!event.isTrusted || !current(selected)) return;
          clear(); child = showMemberRemoval(container, {wasm, store, expectedGroup: group,
            subject: entry.subject, certificate: entry.certificate, deviceName: label, focus, onBack: home});
        }); list.append(button);
      }
    } catch { if (current(selected)) status.textContent = 'The saved device list could not be read. Nothing has been replaced. Go Back to continue planning.'; }
  };
  const ready = home();
  return Object.freeze({ready, dispose});
}
