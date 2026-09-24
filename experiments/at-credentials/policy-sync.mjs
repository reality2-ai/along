import {sendOwnerPolicy} from './owner-policy-send.mjs';
import {applyRemoteATPolicy, decodePolicyUpdate} from './policy-update.mjs';
const requestDomain = new TextEncoder().encode('along/at-check/v1\0');
const responseDomain = new TextEncoder().encode('along/at-checked/v1\0');
const fail = () => new Error('AT access check unavailable');
const starts = (packet, domain) => packet instanceof Uint8Array && packet.length <= 2048
  && packet.length >= domain.length + 16 && domain.every((v, i) => packet[i] === v);
export const isPolicyCheckRequest = packet => starts(packet, requestDomain);
export const isPolicyCheckResponse = packet => starts(packet, responseDomain);
export async function answerPolicyCheck({wasm, store, expectedGroup, connection, packet}) {
  if (!isPolicyCheckRequest(packet) || packet.length !== requestDomain.length + 16) throw fail();
  const nonce = packet.slice(requestDomain.length);
  return sendOwnerPolicy({wasm, store, expectedGroup, connection: {
    signal: connection.signal, authenticated: () => connection.authenticated(),
    send: async policy => {
      const reply = new Uint8Array(responseDomain.length + 16 + policy.length);
      if (reply.length > 2048) throw fail();
      reply.set(responseDomain); reply.set(nonce, responseDomain.length);
      reply.set(policy, responseDomain.length + 16); await connection.send(reply);
    },
  }});
}
// One check per client/session at a time. Each request is bound to a fresh nonce;
// a reply is consumed once and is never a persisted authorization lease.
export function createPolicySync({wasm, store, expectedGroup, peer, connection, timeoutMs = 5000}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || !(peer instanceof Uint8Array) || peer.length !== 32 || !connection?.signal
      || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw fail();
  const group = expectedGroup.slice(), owner = peer.slice();
  let pending, closed = false;
  function close() { closed = true; pending?.stop(); }
  connection.signal.addEventListener('abort', close, {once: true});
  return Object.freeze({
    check: ({signal} = {}) => {
      if (closed || connection.signal.aborted || signal?.aborted || pending) return Promise.reject(fail());
      const controller = new AbortController();
      const lifetime = AbortSignal.any([controller.signal, connection.signal, ...(signal ? [signal] : [])]);
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      return new Promise((resolve, reject) => {
        let timer;
        const finish = (error, result) => {
          if (pending !== item) return;
          pending = undefined; clearTimeout(timer); lifetime.removeEventListener('abort', item.stop);
          if (error) reject(fail()); else resolve(result);
        };
        const item = {nonce, lifetime, receiving: false, stop: () => { controller.abort(); finish(true); }, finish};
        pending = item; lifetime.addEventListener('abort', item.stop, {once: true});
        timer = setTimeout(item.stop, timeoutMs);
        void (async () => {
          try {
            await connection.authenticated();
            if (lifetime.aborted || pending !== item) throw fail();
            const request = new Uint8Array(requestDomain.length + 16);
            request.set(requestDomain); request.set(nonce, requestDomain.length);
            await connection.send(request);
          } catch { finish(true); }
        })();
      });
    },
    receive: async packet => {
      const item = pending;
      if (!item || item.receiving || item.lifetime.aborted || !isPolicyCheckResponse(packet)
          || !item.nonce.every((v, i) => packet[responseDomain.length + i] === v)) throw fail();
      const snapshot = packet.slice(responseDomain.length + 16); item.receiving = true;
      try {
        const result = await applyRemoteATPolicy({wasm, store, expectedGroup: group, peer: owner, connection,
          signal: item.lifetime, acceptUnchanged: true, ...decodePolicyUpdate(snapshot)});
        if (pending !== item || item.lifetime.aborted) throw fail();
        item.finish(false, result); return result;
      } catch { item.finish(true); throw fail(); }
    },
    close() { close(); connection.signal.removeEventListener('abort', close); },
  });
}
