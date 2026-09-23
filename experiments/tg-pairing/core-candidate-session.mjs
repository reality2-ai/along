// Experimental orchestration. The supplied authorization and platform facts
// must be established by the runtime. A prepared persona is not an installation.
import {createEnrollmentSession} from './enrollment-session.mjs';
import {invitationStatement} from './invitation.mjs';
import {enrollmentPayloads} from './enrollment-payloads.mjs';
import {installationReceipt} from './installation-receipt.mjs';

export async function createCoreCandidateSession({wasm, invitation, authorized, platform, readClaimState, store, signal}) {
  const expected = structuredClone(invitation);
  let core, session, key, cancellation, started = false, ended = false;
  const close = () => {
    ended = true; signal?.removeEventListener('abort', abort);
    const heldKey = key; key = undefined;
    const heldCore = core; core = undefined;
    try { if (heldKey) { try { heldKey.close(); } finally { heldKey.free(); } } }
    finally { if (heldCore) { try { heldCore.close(); } finally { heldCore.free(); } } }
  };
  const dispose = () => {
    close();
    if (session && !cancellation) { cancellation = session.cancel(); void cancellation.catch(() => {}); }
    return cancellation || Promise.resolve();
  };
  const abort = () => { void dispose().catch(() => {}); };
  const initiating = () => { if (ended || signal?.aborted) throw new Error('Candidate setup ended'); };
  signal?.addEventListener('abort', abort, {once: true});
  try {
    initiating();
    const statement = invitationStatement(wasm, expected), checked = authorized.statement();
    if (checked.length !== statement.length || !checked.every((v, i) => v === statement[i])) throw new Error('Authorized invitation differs');
    // Refuse implicit conversions of absent platform facts to production/custody.
    if (!platform || !['candidateDevelopment', 'provisionerDevelopment', 'provisionerHoldsCustody'].every(name => typeof platform[name] === 'boolean')
        || typeof platform.epoch !== 'bigint' || platform.epoch < 0n || platform.epoch > 0xffffffffffffffffn
        || typeof readClaimState !== 'function') throw new Error('Platform facts unavailable');
    const facts = {...platform};
    const readState = async () => {
      const value = await readClaimState();
      // Validate before wasm-bindgen transfers an owned key/token: a JS argument
      // conversion error must not strand a Rust object behind a consumed handle.
      if (!['open', 'owner'].includes(value)) throw new Error('Claim state unavailable');
      return value;
    };
    const state = await readState(); initiating();
    const token = authorized; authorized = undefined; // discover consumes the binding even on refusal
    core = wasm.BrowserCandidateCeremony.discover(token, state, facts.candidateDevelopment,
      facts.provisionerDevelopment, facts.provisionerHoldsCustody, facts.epoch);
    const liveCore = () => { if (!core) throw new Error('Core candidate session ended'); return core; };
    const driver = Object.freeze({
      statement: () => statement.slice(),
      candidate_commits: bytes => liveCore().candidate_commits(bytes),
      exchanged: (provisioner, candidate) => liveCore().exchanged(provisioner, candidate),
      confirm: matched => liveCore().confirm(matched),
      close,
    });
    session = await createEnrollmentSession({wasm, invitation: expected, role: 'candidate', store, candidateCeremony: driver});
    initiating();
    session.signal.addEventListener('abort', close, {once: true});
    if (session.signal.aborted) { close(); throw new Error('Candidate session ended'); }
    const payloads = enrollmentPayloads({wasm, invitation: expected, epoch: facts.epoch, role: 'candidate', session});
    const current = () => {
      if (session.signal.aborted || session.state() !== 'comparison-confirmed') throw new Error('Candidate enrollment is not confirmed');
      return liveCore();
    };
    const guarded = async action => {
      try { current(); const value = await action(); current(); return value; }
      catch (error) { await dispose(); throw error; }
    };
    return Object.freeze({
      offer: session.offer, accept: session.accept, comparison: session.comparison,
      decide: session.decide, confirmed: session.confirmed, state: session.state,
      signal: session.signal, invitationState: session.invitationState,
      sendClaim: () => guarded(async () => {
        if (started) throw new Error('Candidate claim already started');
        started = true;
        key = await wasm.BrowserCandidateKey.generate(); current();
        const state = await readState(); const ceremony = current();
        const minted = key; key = undefined; // request owns the key on success and failure
        const publicKey = ceremony.request(minted, state);
        await payloads.sendClaim(publicKey);
      }),
      prepare: () => guarded(async () => {
        const bundle = await payloads.bundle(); current();
        const state = await readState(); const ceremony = current();
        const prepared = ceremony.prepare_install(bundle.certificate, state);
        try { return Object.freeze({group: prepared.group(), member: prepared.member()}); }
        finally { prepared.free(); }
      }),
      installLocal: async () => {
        try {
          current();
          const bundle = await payloads.bundle(); current();
          const stored = await store.read('candidate-persona', 'active');
          const ceremony = current();
          if (!stored || stored.value?.format !== 1 || !['open', 'owner'].includes(stored.value.claim)) throw new Error('Stored claim state unavailable');
          const prepared = ceremony.prepare_install(bundle.certificate, stored.value.claim);
          // Transfer only candidate member custody. The browser record explicitly
          // has no hardware-sealing qualification; no group traffic keys persist.
          const record = prepared.into_browser_record();
          current();
          // New membership only: never overwrite an existing group's epoch or
          // revocations. Enrollment admits the current epoch, with no grace.
          const membership = {format: 1, group: record.group, subject: record.subject,
            certificate: record.certificate, current: bundle.epoch, depth: 0n, revocations: []};
          const receiptBytes = await installationReceipt(wasm, expected, record.subject, record.certificate);
          current();
          const membershipKey = Array.from(record.group, b => b.toString(16).padStart(2, '0')).join('');
          const receipt = await session.consume([{scope: 'candidate-persona', key: 'active', expectedRevision: stored.revision,
            value: {format: 1, claim: 'owner', record, epoch: bundle.epoch,
              invitation: {group: expected.group, code: expected.code}}},
            {scope: 'membership', key: membershipKey, expectedRevision: 0, value: membership}]);
          // Do not apply the ordinary post-await cancellation guard here. A
          // transaction that already committed must still report that fact.
          return Object.freeze({status: 'installed-local', revision: receipt.revisions[0], peerAcknowledged: false, receipt: receiptBytes});
        } catch (error) { await dispose(); throw error; }
      },
      dispose,
    });
  } catch (error) { authorized?.free(); await dispose(); throw error; }
}
