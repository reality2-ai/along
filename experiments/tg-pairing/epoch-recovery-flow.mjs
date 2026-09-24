import {showDeviceTransfer} from './transfer-view.mjs';
import {showEpochRecoveryReview} from './epoch-recovery-view.mjs';
import {openEpochRecoverySession} from './epoch-recovery-session.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {exportRemovalSet, receiveRemovalSet} from './removal-set.mjs';
const profile = 'along-epoch-recovery-v1';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), b => parseInt(b, 16));
const validHex = (text, n) => typeof text === 'string' && new RegExp(`^[0-9a-f]{${n * 2}}$`).test(text);
function decode(text, kind, keys) {
  if (typeof text !== 'string' || text.length > 65536) throw Error('Recovery message unavailable');
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || value.profile !== profile || value.kind !== kind
      || Object.keys(value).sort().join(',') !== ['profile', 'kind', ...keys].sort().join(',')) throw Error('Recovery message unavailable');
  return value;
}
const mounted = new WeakMap();
export function showEpochRecoveryFlow(container, {wasm, store, expectedGroup, role, peer, focus = false, onBack = () => {}}) {
  if (!['owner', 'recipient'].includes(role) || !(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || role === 'owner' && (!(peer instanceof Uint8Array) || peer.length !== 32)) throw Error('Recovery context unavailable');
  mounted.get(container)?.();
  const group = expectedGroup.slice(), selectedPeer = peer?.slice(), document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, finished = false, session, review, transfer, nonce, identity, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); void completed.catch(() => {});
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const current = () => { if (disposed || lifetime.signal.aborted) throw Error('Recovery ended'); };
  const stop = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); session?.close(); review?.dispose(); transfer?.dispose(); reject(Error('Recovery closed'));
    if (mounted.get(container) === stop) mounted.delete(container);
  };
  mounted.set(container, stop);
  const leave = () => { stop(); onBack(); };
  const screen = () => { current(); transfer?.dispose(); transfer = undefined; const root = node('div', ''); container.replaceChildren(root); return root; };
  const message = (title, text, action, run) => {
    const root = screen(), panel = node('section', ''); panel.className = 'pairing-comparison';
    const heading = node('h2', title); heading.tabIndex = -1;
    const status = node('p', text); status.setAttribute('role', 'status');
    panel.append(heading, status);
    if (action) {
      const button = node('button', action); button.type = 'button'; button.className = 'pairing-primary';
      button.addEventListener('click', async event => {
        if (!event.isTrusted || disposed || finished || button.disabled) return;
        button.disabled = true;
        try { await run(); } catch { fail(); }
      }); panel.append(button);
    }
    const back = node('button', 'Back'); back.type = 'button'; back.addEventListener('click', leave); panel.append(back); root.append(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); } });
    if (focus) heading.focus();
  };
  const fail = () => {
    if (disposed || finished) return;
    finished = true;
    message('Device update is not confirmed', 'Keep your saved data. Go Back and start a new exchange with both devices ready. Some keys may already have been saved; reconnecting checks the saved version. Downloaded journeys remain available.');
    reject(Error('Recovery unconfirmed')); lifetime.abort(); session?.close();
  };
  const exchange = options => {
    transfer = showDeviceTransfer(screen(), {...options, signal: lifetime.signal, focus, onBack: leave,
      onReceive: async text => { try { current(); await options.onReceive(text); } catch (error) { fail(); throw error; } }});
  };
  const adopt = created => {
    if (disposed) { created.close(); throw Error('Recovery ended'); }
    session = created;
    // The recipient review owns its local-success/failure wording after mount.
    session.signal.addEventListener('abort', () => { if (!review) fail(); }, {once: true});
    current(); if (session.signal.aborted) throw Error('Recovery ended');
  };
  const ready = (async () => {
    try {
      message('Checking your group', 'This exchange updates group communication keys only. It does not share journeys or an AT API key.');
      identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
      if (identity?.origin !== (role === 'owner' ? 'initial' : 'enrolled')) throw Error('Recovery role unavailable');
      if (role === 'owner') {
        if (identity.epoch === 0n) throw Error('No key update prepared');
        nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
        const removals = await exportRemovalSet({wasm, store, expectedGroup: group}); current();
        exchange({title: 'Connect the device to update', explanation: 'On your other device choose Receive a group key update. Transfer this message, then paste its request here. Messages include device identities, signed removals and network connection details, but no secret keys. Keep both screens open.',
          outgoing: JSON.stringify({profile, kind: 'start', group: hex(group), owner: identity.member, nonce, removals}), incomingLabel: 'Update request from your other device', action: 'Prepare update reply',
          onReceive: async text => {
            const request = decode(text, 'request', ['group', 'owner', 'member', 'certificate', 'nonce', 'removals', 'offer']);
            if (request.group !== hex(group) || request.owner !== identity.member || request.member !== hex(selectedPeer)
                || request.nonce !== nonce || !validHex(request.certificate, 136)) throw Error('Different recovery device');
            await receiveRemovalSet({wasm, store, expectedGroup: group, text: request.removals, signal: lifetime.signal}); current();
            adopt(await openEpochRecoverySession({wasm, store, expectedGroup: group, role, peer: selectedPeer, certificate: unhex(request.certificate), signal: lifetime.signal}));
            const answer = await session.accept(request.offer); current();
            exchange({title: 'Send the key-update reply', explanation: 'Transfer this reply to your other device. It must verify this connection and accept the update before you can send keys.',
              outgoing: JSON.stringify({profile, kind: 'reply', nonce, answer}), receive: false, action: 'Wait for the other device',
              onReceive: async () => message('Waiting for your other device', 'Paste the reply there, then review and accept the update.')});
            void (async () => {
              const context = await session.authenticated(); await session.accepted(); current();
              message('Your other device is ready', `It accepted a connection for key version ${context.to}. Continue to send the update or check its saved installation.`, 'Send update or check confirmation', async () => {
                const result = await session.recover(); current(); finished = true;
                message('Other device confirmed its keys', `Its signed installation confirmation for key version ${result.epoch} is saved here.`); resolve(result);
              });
            })().catch(fail);
          }});
      } else {
        const saved = await store.read('candidate-persona', 'active'); current();
        const owner = hex(saved.value.invitation.issuer);
        exchange({title: 'Receive a group key update', explanation: 'On the device that invited this one, select this device for a key update. Paste its starting message here. Along checks signed removals before connecting. You will review the update before accepting keys.', outgoing: '', incomingLabel: 'Starting message from your other device', action: 'Create update request',
          onReceive: async text => {
            const start = decode(text, 'start', ['group', 'owner', 'nonce', 'removals']);
            if (start.group !== hex(group) || start.owner !== owner || !validHex(start.nonce, 16)) throw Error('Different saved issuer');
            nonce = start.nonce;
            await receiveRemovalSet({wasm, store, expectedGroup: group, text: start.removals, signal: lifetime.signal}); current();
            const removals = await exportRemovalSet({wasm, store, expectedGroup: group}); current();
            adopt(await openEpochRecoverySession({wasm, store, expectedGroup: group, role, peer: unhex(owner), signal: lifetime.signal}));
            const offer = await session.offer(); current();
            const local = await store.read('candidate-persona', 'active'); current();
            exchange({title: 'Send your update request', explanation: 'Transfer this request to your other device, then paste its reply here. Connection details can include network addresses. Keep both devices ready; the connection exchange lasts one minute.',
              outgoing: JSON.stringify({profile, kind: 'request', group: hex(group), owner, member: identity.member, certificate: hex(local.value.record.certificate), nonce, removals, offer}), incomingLabel: 'Key-update reply from your other device', action: 'Review group key update',
              onReceive: async replyText => {
                const reply = decode(replyText, 'reply', ['nonce', 'answer']);
                if (reply.nonce !== nonce) throw Error('Different exchange');
                await session.accept(reply.answer); current();
                review = showEpochRecoveryReview(screen(), {session, focus, onBack: leave});
                void review.completed.then(result => { if (!disposed) { finished = true; resolve(result); } }, error => { if (!disposed) reject(error); });
              }});
          }});
      }
    } catch { fail(); }
  })();
  return Object.freeze({ready, completed, dispose: stop});
}
