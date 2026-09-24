// Experimental orchestration. The supplied authorization and platform facts
// must be established by the runtime. A prepared persona is not an installation.
import {createEnrollmentSession} from './enrollment-session.mjs';
import {invitationStatement} from './invitation.mjs';
import {enrollmentPayloads} from './enrollment-payloads.mjs';
import {installationReceipt} from './installation-receipt.mjs';
import {readStoredClaim} from './stored-claim.mjs';

export async function createCoreCandidateSession({wasm, invitation, authorized, platform, readClaimState, store, signal, softwareCustody = false}) {
  const expected = structuredClone(invitation);
  let core, session, key, cancellation, installed, acknowledgmentStarted = false, started = false, ended = false;
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
    if (typeof softwareCustody !== 'boolean') throw new Error('Custody profile required');
    if (readClaimState === undefined) readClaimState = () => readStoredClaim(store);
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
          // Member custody remains unqualified. Only the explicitly selected
          // Along software profile also persists encrypted traffic material.
          const record = prepared.into_browser_record();
          current();
          // New membership only: never overwrite an existing group's epoch or
          // revocations. Enrollment admits the current epoch, with no grace.
          const membership = {format: 1, group: record.group, subject: record.subject,
            certificate: record.certificate, current: bundle.epoch, depth: 0n, revocations: []};
          const receiptBytes = await installationReceipt(wasm, expected, record.subject, record.certificate);
          current();
          const membershipKey = Array.from(record.group, b => b.toString(16).padStart(2, '0')).join('');
          const traffic = softwareCustody ? await (await import('./software-traffic.mjs')).prepareSoftwareTraffic({group: record.group, subject: record.subject,
            epoch: bundle.epoch, payloadKey: bundle.payloadKey, integrityKey: bundle.integrityKey, signal: session.signal}) : null;
          current();
          const receipt = await session.consume([{scope: 'candidate-persona', key: 'active', expectedRevision: stored.revision,
            value: {format: 1, claim: 'owner', record, epoch: bundle.epoch, peerAcknowledged: false,
              invitation: structuredClone(expected), receipt: receiptBytes}},
            {scope: 'membership', key: membershipKey, expectedRevision: 0, value: membership}, ...(traffic ? [traffic] : [])]);
          bundle.destroy();
          // Do not apply the ordinary post-await cancellation guard here. A
          // transaction that already committed must still report that fact.
          installed = {revision: receipt.revisions[0], receipt: receiptBytes.slice()};
          return Object.freeze({status: 'installed-local', revision: installed.revision, peerAcknowledged: false, receipt: receiptBytes});
        } catch (error) { await dispose(); throw error; }
      },
      acknowledgeInstallation: async () => {
        try {
          current();
          if (!installed || acknowledgmentStarted) throw new Error('Installation receipt unavailable');
          acknowledgmentStarted = true;
          await session.sendInstalled(installed.receipt);
          const acknowledged = await session.acknowledged(); current();
          if (acknowledged.length !== installed.receipt.length
              || !acknowledged.every((v, i) => v === installed.receipt[i])) throw new Error('Acknowledgment differs');
          const saved = await store.read('candidate-persona', 'active'); current();
          if (saved?.revision !== installed.revision) throw new Error('Installed persona changed');
          const result = await store.compareAndSwapMany([{scope: 'candidate-persona', key: 'active', expectedRevision: installed.revision,
            value: {...saved.value, peerAcknowledged: true}}], {signal: session.signal});
          if (!result.applied) throw new Error('Installed persona changed');
          // As with installation, cancellation cannot undo a completed save.
          return Object.freeze({status: 'installed-local', revision: result.revisions[0], peerAcknowledged: true});
        } catch (error) { await dispose(); throw error; }
      },
      dispose,
    });
  } catch (error) { authorized?.free(); await dispose(); throw error; }
}
