// Along enrollment signalling over an already-established invitation channel.
// This is not a trust gate: callers retain invitation proof verification, code
// comparison, durable enrollment and application consent. No credential payloads.
const LIMIT = 65536;
export function createAutomaticSignalling({role, channel, answerProof, verifyProof, createSession,
  onSession = () => {}, onError = () => {}, discardProof = () => {}, signal}) {
  if (!['candidate', 'provisioner'].includes(role) || !channel || typeof channel.send !== 'function'
      || typeof channel.subscribe !== 'function' || typeof channel.close !== 'function'
      || typeof createSession !== 'function'
      || typeof (role === 'candidate' ? verifyProof : answerProof) !== 'function') throw Error('Signalling configuration unavailable');
  let phase = role === 'candidate' ? 'idle' : 'challenge', closed = false, session;
  let queue = Promise.resolve(), unsubscribe = () => {};
  const current = () => { if (closed || signal?.aborted) throw Error('Connection ended'); };
  const close = () => {
    if (closed) return;
    closed = true; phase = 'closed'; unsubscribe(); signal?.removeEventListener('abort', close);
    channel.close();
    if (session) { const owned = session; session = undefined; void Promise.resolve().then(() => owned.cancel()).catch(() => {}); }
  };
  const fail = error => { if (closed) return; close(); try { onError(error); } catch {} };
  const send = async (kind, body) => {
    current();
    const text = JSON.stringify({profile:'along-enrollment-signalling-v1',kind,body});
    if (new TextEncoder().encode(text).length > LIMIT) throw Error('Connection message too large');
    await channel.send(text); current();
  };
  const establish = async proof => {
    const created = await createSession(proof);
    if (closed || signal?.aborted) { await created.cancel(); throw Error('Connection ended'); }
    session = created;
  };
  const receive = async text => {
    current();
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMIT) throw Error('Invalid connection message');
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'body,kind,profile'
        || value.profile !== 'along-enrollment-signalling-v1') throw Error('Invalid connection message');
    if (role === 'provisioner' && phase === 'challenge' && value.kind === 'challenge' && typeof value.body === 'string') {
      phase = 'verifying';
      const response = await answerProof(value.body); current();
      await establish(); current(); phase = 'offer';
      await send('proof', response);
    } else if (role === 'candidate' && phase === 'proof' && value.kind === 'proof' && typeof value.body === 'string') {
      phase = 'verifying';
      const verified = await verifyProof(value.body);
      // Until createSession is invoked, the verified capability belongs here.
      // Cancellation may occur while verification is pending.
      if (closed || signal?.aborted) { await discardProof(verified); current(); }
      await establish(verified); current();
      const offer = await session.offer(); current(); phase = 'answer';
      await send('offer', offer);
    } else if (role === 'provisioner' && phase === 'offer' && value.kind === 'offer') {
      phase = 'accepting';
      const answer = await session.accept(value.body); current(); phase = 'ready';
      await send('answer', answer); current(); await onSession(session);
    } else if (role === 'candidate' && phase === 'answer' && value.kind === 'answer') {
      phase = 'accepting'; await session.accept(value.body); current(); phase = 'ready'; await onSession(session);
    } else throw Error('Unexpected connection message');
  };
  unsubscribe = channel.subscribe(text => { queue = queue.then(() => receive(text)).catch(fail); });
  signal?.addEventListener('abort', close, {once:true});
  if (signal?.aborted) close();
  return Object.freeze({
    async start(challenge) {
      try {
        current();
        if (role !== 'candidate' || phase !== 'idle' || typeof challenge !== 'string') throw Error('Connection already started');
        phase = 'proof'; await send('challenge', challenge);
      } catch (error) { fail(error); throw error; }
    },
    get phase() { return phase; },
    close,
  });
}
