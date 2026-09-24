// Read-only boot evidence. This does not mint a persona, reset a device or
// establish that an OPEN record contains a valid group-of-one identity.
export async function inspectStoredClaim(store) {
  let saved;
  try { saved = await store.read('candidate-persona', 'active'); }
  catch { return Object.freeze({status: 'unreadable'}); }
  if (!saved || saved.value === null) return Object.freeze({status: 'missing'});
  const value = saved.value;
  if (value?.format !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 1)
    return Object.freeze({status: 'invalid'});
  if (!Object.hasOwn(value, 'claim')) return Object.freeze({status: 'missing'});
  if (value.claim !== 'open' && value.claim !== 'owner') return Object.freeze({status: 'invalid'});
  return Object.freeze({status: 'recorded', claim: value.claim, revision: saved.revision});
}

export async function readStoredClaim(store) {
  const evidence = await inspectStoredClaim(store);
  if (evidence.status !== 'recorded') {
    const error = new Error('Device claim state is ' + evidence.status);
    error.code = 'claim-' + evidence.status;
    throw error;
  }
  return evidence.claim;
}
