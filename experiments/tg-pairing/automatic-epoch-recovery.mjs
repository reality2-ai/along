// Along recovery signalling over an explicitly approved, protected invitation
// channel. No enrollment, permission changes, AT key or journey payloads here.
import {readRecoveryInvitation, connectionBytes, RECOVERY_EXCHANGE_MS} from './connection-invitation.mjs';
import {createRelayRecoveryCarriage} from './relay-enrollment-peer.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {exportRemovalSet, receiveRemovalSet} from './removal-set.mjs';
import {openEpochRecoverySession} from './epoch-recovery-session.mjs';
const PROFILE = 'along-epoch-recovery-signalling-v1';
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fields = (v, names) => v && !Array.isArray(v) && typeof v === 'object'
  && Object.keys(v).length === names.length && names.every(k=>Object.hasOwn(v,k));
export async function createAutomaticEpochRecovery({wasm, store, invitation, role, channel, signal,
  onReady = () => {}, onError = () => {}}) {
  const selected = readRecoveryInvitation(invitation), group = connectionBytes(selected.group);
  if (!['owner','recipient'].includes(role)) throw Error('Recovery role unavailable');
  const lifetime = new AbortController(), startedAt = performance.now(), endsAt = Date.now() + RECOVERY_EXCHANGE_MS;
  let closed = false, carriage, session, unsubscribe, phase = 'opening', chunks = '', chunksSeen = 0, certificate;
  let queue = Promise.resolve(), started = false, deadline;
  const current = () => { if (closed || signal?.aborted || Date.now() >= endsAt || performance.now()-startedAt >= RECOVERY_EXCHANGE_MS) throw Error('Recovery ended'); };
  const close = () => {
    if (closed) return; closed = true; phase = 'closed'; clearTimeout(deadline); lifetime.abort(); unsubscribe?.();
    session?.close(); carriage ? carriage.close() : channel.close();
    signal?.removeEventListener('abort',close); chunks = ''; certificate = undefined;
  };
  const fail = error => { if (closed) return; close(); try { onError(error); } catch {} };
  signal?.addEventListener('abort',close,{once:true});
  deadline = setTimeout(()=>fail(Error('Recovery connection expired')),RECOVERY_EXCHANGE_MS);
  const send = (kind,body) => { current(); return carriage.signalling.send(JSON.stringify({profile:PROFILE,kind,body})); };
  const sendRemovals = async () => {
    const text = await exportRemovalSet({wasm,store,expectedGroup:group}); current();
    // The complete snapshot is verified atomically by receiveRemovalSet. Bounded
    // chunks keep each protected message below the unchanged 16 KiB ceiling.
    for (let at = 0; at < text.length; at += 8000) { await send('removals',text.slice(at,at+8000)); current(); }
  };
  const applyRemovals = async () => {
    await receiveRemovalSet({wasm,store,expectedGroup:group,text:chunks,signal:lifetime.signal});
    current(); chunks = ''; chunksSeen = 0;
  };
  const establish = async () => {
    const created = await openEpochRecoverySession({wasm,store,expectedGroup:group,role,
      peer:connectionBytes(role === 'owner' ? selected.member : selected.owner),
      certificate:role === 'owner' ? connectionBytes(certificate) : undefined,
      signal:lifetime.signal,createPeerLink:carriage.createPeerLink});
    if (closed || signal?.aborted) { created.close(); current(); }
    session = created;
    session.signal.addEventListener('abort',()=>fail(Error('Recovery connection ended')),{once:true});
    current();
  };
  const ready = async () => {
    const context = await session.authenticated(); current();
    await onReady({session,context});
  };
  const receive = async text => {
    current();
    if (typeof text !== 'string' || text.length > 12000) throw Error('Recovery message unavailable');
    const value = JSON.parse(text);
    if (!fields(value,['profile','kind','body']) || value.profile !== PROFILE) throw Error('Different recovery exchange');
    if (role === 'owner' && phase === 'hello' && value.kind === 'hello') {
      const body = value.body;
      if (!fields(body,['group','owner','member','certificate']) || body.group !== selected.group
          || body.owner !== selected.owner || body.member !== selected.member
          || typeof body.certificate !== 'string' || !/^[0-9a-f]{272}$/.test(body.certificate)) throw Error('Different recovery device');
      certificate = body.certificate; phase = 'removals';
    } else if (phase === 'removals' && value.kind === 'removals') {
      if (typeof value.body !== 'string' || !value.body.length || value.body.length > 8000
          || ++chunksSeen > 5 || chunks.length + value.body.length > 40000) throw Error('Recovery removals too large');
      chunks += value.body;
    } else if (phase === 'removals' && value.kind === 'removals-complete' && value.body === null) {
      phase = 'establishing'; await applyRemovals(); current();
      if (role === 'owner') {
        // Start the identity-handshake clock after the paced public metadata
        // transfer; no replacement keys can be sent before authentication.
        await sendRemovals(); await establish(); current(); phase = 'offer'; await send('removals-complete',null);
      } else {
        await establish(); current();
        const offer = await session.offer(); current(); phase = 'answer'; await send('offer',offer);
      }
    } else if (role === 'owner' && phase === 'offer' && value.kind === 'offer') {
      phase = 'authenticating'; const answer = await session.accept(value.body); current();
      await send('answer',answer); void ready().catch(fail);
    } else if (role === 'recipient' && phase === 'answer' && value.kind === 'answer') {
      phase = 'authenticating'; await session.accept(value.body); void ready().catch(fail);
    } else throw Error('Unexpected recovery message');
  };
  try {
    current();
    const local = await loadLocalPersona({wasm,store,expectedGroup:group}); current();
    if (local?.origin !== (role === 'owner' ? 'initial' : 'enrolled')
        || local.member !== selected[role === 'owner' ? 'owner' : 'member']
        || role === 'owner' && local.epoch === 0n) throw Error('Different saved recovery identity');
    const saved = await store.read('candidate-persona','active'); current();
    if (role === 'recipient' && hex(saved.value.invitation.issuer) !== selected.owner) throw Error('Different saved issuer');
    const localCertificate = hex(saved.value.record.certificate);
    carriage = createRelayRecoveryCarriage(channel,{onClose:()=>fail(Error('Recovery connection ended'))});
    unsubscribe = carriage.signalling.subscribe(text=>{queue=queue.then(()=>receive(text)).catch(fail);});
    phase = role === 'owner' ? 'hello' : 'idle';
    return Object.freeze({close,
      async start() {
        try {
          current(); if (started) throw Error('Recovery already started'); started = true;
          if (role === 'owner') return;
          phase = 'removals';
          await send('hello',{group:selected.group,owner:selected.owner,member:selected.member,certificate:localCertificate});
          await sendRemovals(); await send('removals-complete',null);
        } catch (error) { fail(error); throw error; }
      },
    });
  } catch (error) { close(); throw error; }
}
