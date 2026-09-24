// Persistence bookkeeping for an already-authorized enrollment ceremony.
// Does NOT authenticate an invitation, establish validity, witness consent, or
// authorize installation. The ceremony controller must establish those facts.
const bytes = (value, length) => value instanceof Uint8Array && value.length === length;
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const scope = 'enrollment-invitations';
export async function reserveInvitation(store, group, code) {
  if (!bytes(group, 32) || !bytes(code, 16)) throw new TypeError('Invalid invitation identity');
  const key = hex(group) + ':' + hex(code);
  // Never reopen a reservation after process loss: its outcome may be unknown.
  // The durable record prevents another process/tab from reusing the same code.
  const created = await store.compareAndSwap(scope, key, 0, {format: 1, state: 'reserved'});
  if (!created.applied) throw new Error('Invitation has already been reserved');
  let state = 'reserved';
  const begin = () => {
    if (state !== 'reserved') throw new Error('Invitation is unavailable');
    state = 'pending';
  };
  const commit = async (terminal, changes, options) => {
    begin();
    try {
      const result = await store.compareAndSwapMany([
        ...changes,
        {scope, key, expectedRevision: created.revision, value: {format: 1, state: terminal}},
      ], options);
      if (!result.applied) throw new Error('Invitation install state changed');
      state = terminal;
      // Receipt only after the storage transaction's completion event. A late
      // abort signal cannot turn a committed transaction into a cancellation.
      return Object.freeze({state, revisions: Object.freeze(result.revisions.slice(0, -1))});
    } catch (error) {
      // No retry after an ambiguous failure. A fresh authorized ceremony must
      // use a new code; the old durable reservation remains non-reopenable.
      state = 'unavailable'; throw error;
    }
  };
  return Object.freeze({
    state: () => state,
    void: () => commit('void', []),
    consumeWith: (changes, options) => {
      if (!Array.isArray(changes) || !changes.length || changes.length > 31
          || changes.some(change => !change || change.scope === scope)) throw new TypeError('Invalid installation write set');
      return commit('consumed', changes, options);
    },
  });
}
