// Ordinary-member comparison, confirmation and protected carriage. No install.
import {createPeerLink} from './peer-link.mjs';
import {createEnrollmentExchange} from './enrollment-exchange.mjs';
import {invitationStatement} from './invitation.mjs';
const bytes = value => {
  if (!Array.isArray(value) || value.length !== 32 || !value.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error('Invalid exchange frame');
  return new Uint8Array(value);
};
const fields = (value, names) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export function createEnrollmentLink({wasm, invitation, role, candidateCeremony}) {
  if (!['candidate', 'provisioner'].includes(role) || invitation?.role !== 'member') throw new Error('Only ordinary-member comparison is supported');
  const expected = structuredClone(invitation); const statement = invitationStatement(wasm, expected);
  if (candidateCeremony) {
    const authorized = candidateCeremony.statement();
    if (role !== 'candidate' || !(authorized instanceof Uint8Array) || authorized.length !== statement.length
        || !authorized.every((value, index) => value === statement[index])) {
      candidateCeremony.close(); throw new Error('Core ceremony invitation mismatch');
    }
  }
  let closed = false, exchange, link, initialized, timer, comparison;
  const lifetime = new AbortController();
  const started = performance.now();
  let localDecision = false, remoteDecision = false, coreConfirmed = false, resolveConfirmed, rejectConfirmed;
  let sentClaim = false, sentBundle = false, claim, bundle, resolveClaim, rejectClaim, resolveBundle, rejectBundle;
  const claimResult = new Promise((yes, no) => { resolveClaim = yes; rejectClaim = no; });
  const bundleResult = new Promise((yes, no) => { resolveBundle = yes; rejectBundle = no; });
  void claimResult.catch(() => {}); void bundleResult.catch(() => {});
  const receipts = Object.fromEntries(['installed', 'acknowledged'].map(kind => {
    const entry = {sent: false};
    entry.promise = new Promise((yes, no) => { entry.resolve = yes; entry.reject = no; });
    void entry.promise.catch(() => {}); return [kind, entry];
  }));
  const confirmed = new Promise((yes, no) => { resolveConfirmed = yes; rejectConfirmed = no; });
  void confirmed.catch(() => {});
  let resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  void result.catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); candidateCeremony?.close(); exchange?.close(); link?.close(); comparison?.fill(0);
    lifetime.abort(); rejectConfirmed(new Error('Enrollment confirmation unavailable'));
    claim?.fill(0); bundle?.fill(0);
    for (const entry of Object.values(receipts)) { entry.value?.fill(0); entry.reject(new Error('Receipt unavailable')); }
    rejectClaim(new Error('Enrollment claim unavailable')); rejectBundle(new Error('Enrollment bundle unavailable'));
    reject(new Error('Enrollment comparison unavailable'));
  };
  const current = () => {
    const elapsed = performance.now() - started;
    if (!closed && (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 60000)) close();
    return !closed;
  };
  const requireCurrent = () => { if (!current()) throw new Error('Enrollment link closed or expired'); };
  const requireDecisions = () => { requireCurrent(); if (!localDecision || !remoteDecision) throw new Error('Comparison not confirmed'); };
  const requireConfirmed = () => { requireDecisions(); if (!coreConfirmed) throw new Error('Core confirmation unavailable'); };
  const payload = value => {
    if (!Array.isArray(value) || value.length < 29 || value.length > 2076
        || !value.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error('Invalid protected payload');
    return new Uint8Array(value);
  };
  const send = value => { requireCurrent(); link.send(JSON.stringify(value)); };
  const finish = () => {
    requireCurrent();
    comparison = exchange.verificationString(); resolve();
  };
  const finishConfirmation = () => {
    requireDecisions();
    if (!coreConfirmed) { candidateCeremony?.confirm(true); coreConfirmed = true; }
    resolveConfirmed();
  };
  const receive = async text => {
    await initialized;
    requireCurrent();
    const frame = JSON.parse(text);
    if (comparison) {
      if (fields(frame, ['type']) && frame.type === 'confirmed' && !remoteDecision) {
        remoteDecision = true; if (localDecision) finishConfirmation();
      } else {
        requireConfirmed();
        if (!fields(frame, ['type', 'value'])) throw new Error('Unexpected protected message');
        if (frame.type === 'claim' && role === 'provisioner' && !claim) {
          const value = await exchange.open('claim', payload(frame.value));
          try { requireConfirmed(); claim = value; resolveClaim(); } catch (error) { value.fill(0); throw error; }
        } else if (frame.type === 'bundle' && role === 'candidate' && sentClaim && !bundle) {
          const value = await exchange.open('bundle', payload(frame.value));
          try { requireConfirmed(); bundle = value; resolveBundle(); } catch (error) { value.fill(0); throw error; }
        } else if ((frame.type === 'installed' && role === 'provisioner' && sentBundle)
            || (frame.type === 'acknowledged' && role === 'candidate' && receipts.installed.sent)) {
          const entry = receipts[frame.type];
          if (entry.value) throw new Error('Duplicate receipt');
          const value = await exchange.open(frame.type, payload(frame.value));
          try { requireConfirmed(); entry.value = value; entry.resolve(); }
          catch (error) { value.fill(0); throw error; }
        } else throw new Error('Unexpected protected message');
      }
    } else if (role === 'provisioner' && frame.type === 'commit' && fields(frame, ['type', 'value'])) {
      send({type: 'contribution', value: [...exchange.acceptCommit(bytes(frame.value))]});
    } else if (role === 'candidate' && frame.type === 'contribution' && fields(frame, ['type', 'value'])) {
      const reveal = await exchange.reveal(bytes(frame.value));
      send({type: 'reveal', publicKey: [...reveal.publicKey], salt: [...reveal.salt]}); finish();
    } else if (role === 'provisioner' && frame.type === 'reveal' && fields(frame, ['type', 'publicKey', 'salt'])) {
      await exchange.acceptReveal({publicKey: bytes(frame.publicKey), salt: bytes(frame.salt)}); finish();
    } else throw new Error('Unexpected enrollment frame');
  };
  let queue = Promise.resolve();
  link = createPeerLink({role: role === 'candidate' ? 'offer' : 'answer', onClose: close,
    onMessage: text => { queue = queue.then(() => receive(text)).catch(close); }});
  timer = setTimeout(close, 60000);
  initialized = (async () => {
    await link.opened();
    exchange = await createEnrollmentExchange(wasm, expected, role, await link.transcript(), candidateCeremony);
    if (closed) { exchange.close(); throw new Error('Enrollment link closed'); }
    if (role === 'candidate') send({type: 'commit', value: [...await exchange.commit()]});
  })();
  void initialized.catch(close);
  const sendReceipt = async (kind, value) => {
    try {
      requireConfirmed();
      const ready = kind === 'installed' ? role === 'candidate' && bundle
        : role === 'provisioner' && receipts.installed.value;
      const entry = receipts[kind];
      if (!ready || entry.sent) throw new Error('Receipt ordering unavailable');
      entry.sent = true;
      const sealed = await exchange.seal(kind, value); requireConfirmed();
      send({type: kind, value: [...sealed]});
    } catch (error) { close(); throw error; }
  };
  const receipt = async kind => {
    requireConfirmed();
    if ((kind === 'installed') !== (role === 'provisioner')) throw new Error('Wrong receipt role');
    await receipts[kind].promise; requireConfirmed(); return receipts[kind].value.slice();
  };
  return Object.freeze({
    offer: async () => { requireCurrent(); const value = await link.offer(); requireCurrent(); return value; },
    accept: async value => { requireCurrent(); const answer = await link.accept(value); requireCurrent(); return answer; },
    comparison: async () => { requireCurrent(); await result; requireCurrent(); return comparison.slice(); },
    decide: matched => {
      if (!current() || !comparison || localDecision || typeof matched !== 'boolean') { close(); throw new Error('Comparison decision unavailable'); }
      if (!matched) { close(); return; }
      localDecision = true;
      try { send({type: 'confirmed'}); if (remoteDecision) finishConfirmation(); }
      catch (error) { close(); throw error; }
    },
    confirmed: async () => { requireCurrent(); await confirmed; requireCurrent(); },
    sendClaim: async value => {
      try {
        requireConfirmed();
        if (role !== 'candidate' || sentClaim) throw new Error('Claim already sent or wrong role');
        sentClaim = true; const sealed = await exchange.seal('claim', value); requireConfirmed();
        send({type: 'claim', value: [...sealed]});
      } catch (error) { close(); throw error; }
    },
    claim: async () => {
      requireConfirmed(); if (role !== 'provisioner') throw new Error('Wrong enrollment role');
      await claimResult; requireConfirmed(); return claim.slice();
    },
    sendBundle: async value => {
      try {
        requireConfirmed();
        if (role !== 'provisioner' || !claim || sentBundle) throw new Error('Claim required or bundle already sent');
        sentBundle = true; const sealed = await exchange.seal('bundle', value); requireConfirmed();
        send({type: 'bundle', value: [...sealed]});
      } catch (error) { close(); throw error; }
    },
    bundle: async () => {
      requireConfirmed(); if (role !== 'candidate' || !sentClaim) throw new Error('Claim required');
      await bundleResult; requireConfirmed(); return bundle.slice();
    },
    sendInstalled: value => sendReceipt('installed', value), installed: () => receipt('installed'),
    sendAcknowledged: value => sendReceipt('acknowledged', value), acknowledged: () => receipt('acknowledged'),
    signal: lifetime.signal,
    state: () => !current() ? 'closed' : localDecision && remoteDecision && coreConfirmed ? 'comparison-confirmed'
      : localDecision ? 'waiting-for-peer-confirmation' : comparison ? 'comparison-ready' : 'exchanging',
    close,
  });
}
