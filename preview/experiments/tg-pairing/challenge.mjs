// Verifier-owned, single-use L5 nonce exchange. This proves current possession
// relative to held membership state, not global revocation freshness or app rights.
export function issuePeerChallenge(membership, peer, statement) {
  if (!(peer instanceof Uint8Array) || peer.length !== 32 || !(statement instanceof Uint8Array)
      || statement.length > 512) throw new TypeError('Invalid peer challenge');
  const expectedPeer = peer.slice(), expectedStatement = statement.slice();
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const started = performance.now();
  let consumed = false, cancelled = false, verifying = false;
  let timer;
  const unsubscribe = membership.subscribe(() => { cancelled = true; clearTimeout(timer); unsubscribe(); });
  timer = setTimeout(() => { cancelled = true; unsubscribe(); }, 60000);
  const live = () => !consumed && !cancelled && performance.now() >= started && performance.now() - started <= 60000;
  return Object.freeze({
    nonce: () => nonce.slice(),
    statement: () => expectedStatement.slice(),
    cancel: () => { cancelled = true; clearTimeout(timer); unsubscribe(); },
    verify: async (certificate, signature) => {
      if (!live() || verifying) return false;
      verifying = true;
      try {
        const valid = await membership.verifyPeerEvidence(certificate, expectedPeer, expectedStatement, nonce, signature);
        if (!valid || !live()) return false;
        consumed = true; clearTimeout(timer); unsubscribe(); return true;
      } finally { verifying = false; }
    },
  });
}
