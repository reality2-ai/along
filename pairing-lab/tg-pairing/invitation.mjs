// Canonical L5B statement only; not authorization, validity or custody proof.
export function invitationStatement(wasm, {group, issuer, role, code, validity}) {
  if (!(group instanceof Uint8Array) || group.length !== 32
      || !(issuer instanceof Uint8Array) || issuer.length !== 32
      || !(code instanceof Uint8Array) || code.length !== 16
      || !['member', 'key-holder'].includes(role)
      || typeof validity !== 'bigint' || validity < 0n || validity > 0xffffffffffffffffn)
    throw new TypeError('Invalid invitation fields');
  const result = wasm.tg_invitation_statement(group, issuer, role === 'member' ? 1 : 2, code, validity);
  if (!(result instanceof Uint8Array) || result.length !== 89) throw new Error('Invitation encoder refused');
  return result;
}

// The successful caller owns the returned WASM object and must free/consume it.
// Later ceremony stages still need current membership, validity and consent.
export function issueInvitationChallenge(membership, wasm, invitation) {
  const statement = invitationStatement(wasm, invitation);
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const started = performance.now();
  let cancelled = false, consumed = false, verifying = false, timer;
  let unsubscribe = () => {};
  const cancel = () => { cancelled = true; clearTimeout(timer); unsubscribe(); };
  unsubscribe = membership.subscribe(cancel);
  timer = setTimeout(cancel, 60000);
  const live = () => !cancelled && !consumed && performance.now() >= started && performance.now() - started <= 60000;
  return Object.freeze({
    statement: () => statement.slice(),
    nonce: () => nonce.slice(),
    cancel,
    verify: async (certificate, signature) => {
      if (!live() || verifying) return null;
      verifying = true;
      let authorized = null;
      try {
        authorized = await membership.authoriseInvitationEvidence(statement, certificate, nonce, signature);
        if (!authorized || !live()) return null;
        consumed = true; clearTimeout(timer); unsubscribe();
        const result = authorized; authorized = null; return result;
      } catch (error) { cancel(); throw error; }
      finally { authorized?.free(); verifying = false; }
    },
  });
}
