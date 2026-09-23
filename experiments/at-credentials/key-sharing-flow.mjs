// Explicit first-use sharing between already enrolled group members. Signaling
// carries public descriptors only; the key is delivered on authenticated WebRTC.
import {showDeviceTransfer} from '../tg-pairing/transfer-view.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openLocalPersonaSession} from '../tg-pairing/local-persona-session.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {loadATBinding} from './local-owner.mjs';
import {showOwnerDeviceAccess} from './owner-access-view.mjs';
import {showRemoteOwnerConsent} from './remote-owner-view.mjs';
import {openLocalATVault} from './local-vault.mjs';
import {sendOwnerCredential} from './owner-delivery.mjs';
import {openDeliveryHistory} from './delivery-history.mjs';
import {applyRemoteATPolicy} from './policy-update.mjs';
const profile = 'along-at-sharing-v1';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = text => { if (typeof text !== 'string' || !/^[0-9a-f]{64}$/.test(text)) throw Error('Invalid identity'); return Uint8Array.from(text.match(/../g), x => parseInt(x, 16)); };
const bytes = (value, length) => { if (!Array.isArray(value) || value.length !== length || value.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw Error('Invalid bytes'); return Uint8Array.from(value); };
export function showKeySharingFlow(container, {wasm, store, expectedGroup, role, focus = false, onBack = () => {}}) {
  if (!['owner', 'recipient'].includes(role) || !(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw Error('Sharing context unavailable');
  const group = expectedGroup.slice(), lifetime = new AbortController(), document = container.ownerDocument;
  let disposed = false, failed = false, completed = false, child, session, request, binding, peer, certificate, phase, sendResult, sending;
  const current = () => { if (disposed || failed || lifetime.signal.aborted) throw Error('Sharing ended'); };
  const dispose = () => { if (disposed) return; disposed = true; child?.dispose(); lifetime.abort(); request?.close(); session?.close(); };
  const back = () => { dispose(); onBack(); };
  const screen = () => { current(); child?.dispose(); child = undefined; const node = document.createElement('div'); container.replaceChildren(node); return node; };
  const message = (title, text, action, handler) => {
    const node = screen(), panel = document.createElement('section'); panel.className = 'pairing-comparison';
    const heading = document.createElement('h2'); heading.textContent = title; heading.tabIndex = -1;
    const status = document.createElement('p'); status.textContent = text; status.setAttribute('role', 'status'); panel.append(heading, status);
    if (action) { const button = document.createElement('button'); button.type = 'button'; button.className = 'pairing-primary'; button.textContent = action;
      button.addEventListener('click', async event => { if (!event.isTrusted || disposed || failed || button.disabled) return; button.disabled = true; try { await handler(); } catch { fail(); } }); panel.append(button); }
    const leave = document.createElement('button'); leave.type = 'button'; leave.textContent = 'Back'; leave.addEventListener('click', back); panel.append(leave); node.append(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); back(); } });
    if (focus) heading.focus();
  };
  const fail = () => {
    if (disposed || failed || completed) return;
    message('Sharing is not confirmed', 'Keep your saved device data. Permission or a key may already have been saved. Check AT-key settings before retrying. Downloaded journeys still work.');
    failed = true; lifetime.abort(); child?.dispose(); request?.close(); session?.close();
  };
  const transfer = options => { child = showDeviceTransfer(screen(), {...options, focus, signal: lifetime.signal, onBack: back,
    onReceive: async text => { try { current(); await options.onReceive(text); } catch (error) { fail(); throw error; } }}); };
  const peerProof = async (identity, proof) => {
    const own = await store.read('candidate-persona', 'active'); current();
    const membership = openMembership(store, wasm, group, own.value.record.subject);
    try { if (await membership.peerStatus(proof, identity) !== 'current') throw Error('Member unavailable'); } finally { membership.close(); }
    current();
  };
  const ready = (async () => {
    try {
      message('Checking saved devices', 'Both devices must already belong to the same group. Sharing an AT key is optional.');
      const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
      if (!identity) throw Error('Identity unavailable');
      const own = (await store.read('candidate-persona', 'active')).value.record; current();
      const saved = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime.signal}); current();
      const open = async (connectionRole, onMessage) => {
        session = await openLocalPersonaSession({wasm, store, expectedGroup: group, peer, role: connectionRole,
          signal: lifetime.signal, onMessage: async packet => { try { current(); await onMessage(packet); } catch { fail(); } }});
        if (disposed || failed) { session.close(); current(); }
        session.signal.addEventListener('abort', fail, {once: true});
      };
      if (role === 'owner') {
        if (!saved || saved.role !== 'owner') throw Error('Save your own key first');
        binding = saved.binding;
        phase = 'connecting';
        transfer({title: 'Share your AT key', outgoing: JSON.stringify({profile, ...binding, certificate: [...own.certificate]}),
          explanation: 'On your other enrolled device, choose Receive a shared AT key. Transfer this public message, then paste its reply here. Your key is not in this message. Connection messages may include network addresses.',
          incomingLabel: 'Sharing connection request', action: 'Connect for key sharing', onReceive: async text => {
            const incoming = JSON.parse(text);
            if (incoming.profile !== profile || incoming.group !== binding.group || incoming.owner !== binding.owner || incoming.credential !== binding.credential) throw Error('Different sharing request');
            peer = unhex(incoming.member); certificate = bytes(incoming.certificate, 136); await peerProof(peer, certificate);
            await open('answer', async packet => {
              if (phase === 'await-request') {
                phase = 'sending';
                sending = sendOwnerCredential({wasm, store, expectedGroup: group, peer, peerCertificate: certificate, nonce: packet, connection: session});
                sendResult = await sending; current(); phase = 'await-ack';
              } else if (phase === 'sending' || phase === 'await-ack') {
                if (sending) await sending; current();
                if (!sendResult) throw Error('No delivery');
                const receipt = await openDeliveryHistory({store, ...binding, recipient: hex(peer)}).confirm(packet, {signal: session.signal}); current();
                if (receipt.status !== 'recipient-confirmed-saved') throw Error('No confirmation');
                completed = true; phase = 'complete';
                message('Other device saved the key', 'Your other device confirmed encrypted storage. Reconnect from Along Settings when it needs to check live information.');
              } else throw Error('Unexpected sharing message');
            });
            const reply = await session.accept(incoming.offer); current();
            transfer({title: 'Send the sharing reply', outgoing: JSON.stringify(reply), receive: false,
              explanation: 'Transfer this reply to your other device. Both devices then review AT-key access.', action: 'Wait for other device',
              onReceive: async () => { message('Connecting devices', 'Waiting for the other device…'); }});
            void (async () => {
              try {
                await session.authenticated(); current();
                const policyModule = await import('./policy.mjs'); current();
                const readPolicy = async () => {
                  const signed = await store.read('along-at-policy:' + binding.owner, binding.group + ':' + binding.credential); current();
                  const parsed = await policyModule.verifyCredentialPolicy(signed.value.bytes, signed.value.signature, {...binding, afterRevision: 0n, minimumGeneration: 1n}); current();
                  return {signed, parsed};
                };
                const continueSharing = async () => {
                  // Re-read after the user's review; an access change during
                  // review cannot be overwritten or turned into a new grant.
                  const {signed, parsed} = await readPolicy();
                  if (!parsed.devices.includes(hex(peer))) throw Error('Permission changed');
                  phase = 'await-request';
                  await session.send(new TextEncoder().encode(JSON.stringify({type: 'sharing-policy', bytes: [...signed.value.bytes], signature: [...signed.value.signature]}))); current();
                  if (phase === 'await-request') message('Waiting for your other device', 'Access permission is saved here. Your other device must accept the key before it is sent.');
                };
                const {parsed} = await readPolicy();
                if (parsed.devices.includes(hex(peer))) {
                  message('Continue sharing with this device?', 'This connected device already has your permission. Continuing keeps that permission and waits for its consent before sending the key. Device identity: ' + hex(peer),
                    'Continue sharing my key', continueSharing);
                } else {
                  const access = showOwnerDeviceAccess(screen(), {wasm, store, expectedGroup: group, peer, certificate, deviceName: 'Connected group device', focus, onBack: back}); child = access;
                  await access.ready;
                  await access.completed; current();
                  await continueSharing();
                }
              } catch { fail(); }
            })();
          }});
      } else {
        if (saved && saved.role !== 'recipient') throw Error('An owner cannot be replaced by sharing');
        phase = 'descriptor';
        transfer({title: 'Receive a shared AT key', outgoing: '', explanation: 'Paste the public sharing message from your enrolled AT-key device. You will review the device and consent before receiving a key.',
          incomingLabel: 'AT-key sharing message', action: 'Review sharing device', onReceive: async text => {
            const descriptor = JSON.parse(text);
            if (descriptor.profile !== profile || descriptor.group !== hex(group) || typeof descriptor.credential !== 'string' || !/^[0-9a-f]{32}$/.test(descriptor.credential)) throw Error('Invalid sharing descriptor');
            binding = Object.freeze({group: descriptor.group, owner: descriptor.owner, credential: descriptor.credential});
            if (saved && ['group', 'owner', 'credential'].some(key => binding[key] !== saved.binding[key])) throw Error('Different saved sharing device');
            peer = unhex(binding.owner); certificate = bytes(descriptor.certificate, 136); await peerProof(peer, certificate);
            message('Use this sharing device?', 'Check that this is the group device you intend to use. Device identity: ' + binding.owner,
              'Connect to this sharing device', async () => {
                phase = 'await-policy';
                await open('offer', async packet => {
                  if (phase === 'await-policy') {
                    if (packet.length > 10000) throw Error('Policy too large');
                    const policy = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(packet));
                    if (policy.type !== 'sharing-policy' || !Array.isArray(policy.bytes) || policy.bytes.length > 2048) throw Error('Invalid policy');
                    phase = 'consent';
                    const receiveKey = async () => {
                      const latest = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime.signal}); current();
                      if (!latest || latest.role !== 'recipient' || ['group', 'owner', 'credential'].some(key => latest.binding[key] !== binding[key])) throw Error('Sharing choice changed');
                      const vault = openLocalATVault({wasm, store, ...binding});
                      const state = await vault.inspect({signal: lifetime.signal}); current();
                      if (!['missing', 'replacement-needed'].includes(state.status)) throw Error('Key delivery not needed');
                      request = await vault.prepareDelivery({ownerCertificate: certificate, signal: lifetime.signal}); current();
                      phase = 'await-key'; message('Receiving the shared key', 'Your choice is saved. Waiting for encrypted delivery…');
                      await session.send(request.nonce);
                    };
                    if (saved) {
                      await applyRemoteATPolicy({wasm, store, expectedGroup: group, peer, connection: session,
                        policyBytes: bytes(policy.bytes, policy.bytes.length), policySignature: bytes(policy.signature, 64),
                        acceptUnchanged: true, signal: lifetime.signal}); current();
                      const state = await openLocalATVault({wasm, store, ...binding}).inspect({signal: lifetime.signal}); current();
                      if (state.status === 'saved-unverified') {
                        message('A shared key is already saved', 'Your existing key has been kept. Use Along Settings to reconnect for live information. Confirmation of an earlier delivery needs its own recovery check.');
                      } else if (['missing', 'replacement-needed'].includes(state.status)) {
                        message('Continue receiving your shared key?', 'This is the sharing device you previously accepted. Keep that choice and request the key over this new connection.', 'Receive the shared key', receiveKey);
                      } else throw Error('Saved access unavailable');
                    } else {
                      const consent = showRemoteOwnerConsent(screen(), {wasm, store, expected: binding, ownerCertificate: certificate,
                        policyBytes: bytes(policy.bytes, policy.bytes.length), policySignature: bytes(policy.signature, 64), connection: session, focus, onBack: back}); child = consent;
                      // Do not hold the message dispatcher while waiting for a human.
                      void (async () => { try { await consent.completed; current(); await receiveKey(); } catch { fail(); } })();
                    }
                  } else if (phase === 'await-key') {
                    phase = 'saving';
                    const receipt = await request.install(packet); current();
                    if (receipt.status !== 'credential-saved') throw Error('Not saved');
                    await session.send(await request.acknowledgment({signal: session.signal})); current();
                    completed = true; phase = 'complete';
                    message('Shared AT key saved', 'The key is stored encrypted on this device. Reconnect from Along Settings when you want live information. Downloaded journeys still work offline.');
                  } else throw Error('Unexpected sharing message');
                });
                const offer = await session.offer(); current();
                transfer({title: 'Connect for key sharing', outgoing: JSON.stringify({profile, ...binding, member: identity.member, certificate: [...own.certificate], offer}),
                  explanation: 'Transfer this message to your AT-key device and paste its reply here. This exchange lasts one minute. Connection details may include network addresses.',
                  incomingLabel: 'Sharing connection reply', action: 'Check sharing connection', onReceive: async text => {
                    await session.accept(JSON.parse(text)); current();
                    message('Waiting for access permission', 'Your other device must explicitly allow AT-key access.');
                  }});
              });
          }});
      }
    } catch { fail(); }
  })();
  return Object.freeze({ready, dispose});
}
