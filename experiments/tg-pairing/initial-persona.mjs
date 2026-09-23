// Explicit local first-use operation only. Never call on a failed ordinary
// restore, from a network message, or as an automatic reset.
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const refuse = () => new Error('Local initialization unavailable');

export async function initializeLocalPersona({wasm, store, signal}) {
  let initial, closed = false;
  const close = () => {
    closed = true; signal?.removeEventListener('abort', close);
    if (initial) { const owned = initial; initial = undefined; try { owned.close(); } finally { owned.free(); } }
  };
  const current = () => { if (closed || signal?.aborted) throw refuse(); };
  signal?.addEventListener('abort', close, {once: true});
  try {
    current();
    const persona = await store.read('candidate-persona', 'active');
    const bootstrap = await store.read('persona-bootstrap', 'initial');
    current();
    // Tombstones and partial/damaged prior state require a separate local
    // recovery path; absence does not prove this browser was never wiped.
    if (persona || bootstrap) throw refuse();
    initial = await wasm.BrowserInitialPersona.generate(); current();
    const record = initial.take_member_record();
    const group = hex(record.group), member = hex(record.subject);
    const result = await store.compareAndSwapMany([
      {scope: 'candidate-persona', key: 'active', expectedRevision: 0,
        value: {format: 1, origin: 'initial', claim: 'open', record, epoch: 0n}},
      {scope: 'persona-bootstrap', key: 'initial', expectedRevision: 0,
        value: {format: 1, group: record.group, subject: record.subject}},
      {scope: 'membership', key: group, expectedRevision: 0,
        value: {format: 1, group: record.group, subject: record.subject,
          certificate: record.certificate, current: 0n, depth: 0n, revocations: []}},
    ], {signal});
    if (!result.applied) throw refuse();
    // Commit is the fact, even when cancellation closes volatile custody during
    // completion delivery. Never replace that outcome with a late refusal.
    return Object.freeze({status: 'created-local', provenance: 'created-this-session',
      priorStorage: 'absent-first-use-or-cleared', group, member, claim: 'open',
      revision: result.revisions[0], issuerAvailable: () => !closed, close});
  } catch (error) { close(); throw error; }
}
