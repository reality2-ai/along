// Along application protocol over a newly authenticated peer session. Public
// receipts only: this cannot enroll a device or authorize application secrets.
import {verifyInstallationReceipt} from './installation-receipt.mjs';
import {certificateCodec} from './certificate.mjs';
import {openLocalPersonaSession} from './local-persona-session.mjs';
const domain = new TextEncoder().encode('along/receipt-recovery/v1\0');
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const same = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]);
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Receipt recovery unavailable');
function packet(kind, nonce, receipt) {
  const bytes = new Uint8Array(domain.length + 171);
  bytes.set(domain); bytes[domain.length] = kind;
  bytes.set(nonce, domain.length + 1); bytes.set(receipt, domain.length + 17);
  return bytes;
}
function parse(message, kind) {
  if (!fixed(message, domain.length + 171) || !same(message.slice(0, domain.length), domain)
      || message[domain.length] !== kind) throw fail();
  return {nonce: message.slice(domain.length + 1, domain.length + 17), receipt: message.slice(domain.length + 17)};
}

// Bind group/local/peer to the verified connection, never to incoming fields.
export async function answerReceiptRecovery({wasm, store, group, local, peer, connection}, message) {
  if (![group, local, peer].every(value => fixed(value, 32))) throw fail();
  const expected = {group: group.slice(), local: local.slice(), peer: peer.slice()};
  const {nonce, receipt} = parse(message, 1);
  await connection.authenticated();
  if (receipt[0] !== 1 || !same(receipt.slice(1, 33), expected.group)
      || !same(receipt.slice(33, 65), expected.local) || !same(receipt.slice(90, 122), expected.peer)) throw fail();
  const key = hex(expected.group) + ':' + hex(receipt.slice(66, 82));
  const saved = await store.read('enrollment-installations', key);
  const journal = await store.read('enrollment-invitations', key);
  if (saved?.value?.format !== 1 || !same(saved.value.receipt, receipt)
      || !same(saved.value.subject, expected.peer)
      || !certificateCodec(wasm).authentic(saved.value.certificate, expected.peer, expected.group)
      || journal?.value?.format !== 1 || journal.value.state !== 'consumed') throw fail();
  const certificateDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', saved.value.certificate));
  if (!same(receipt.slice(122), certificateDigest)) throw fail();
  const latest = await store.read('enrollment-installations', key);
  const used = await store.read('enrollment-invitations', key);
  if (latest?.revision !== saved.revision || used?.revision !== journal.revision) throw fail();
  await connection.send(packet(2, nonce, receipt));
}

export async function openReceiptRecovery({wasm, store, expectedGroup, signal}) {
  if (!fixed(expectedGroup, 32)) throw fail();
  const group = expectedGroup.slice();
  const saved = await store.read('candidate-persona', 'active');
  const value = saved?.value;
  if (signal?.aborted || value?.format !== 1 || value.claim !== 'owner'
      || !fixed(value.invitation?.issuer, 32)
      || !await verifyInstallationReceipt(wasm, value.invitation, value.record?.subject, value.record?.certificate, value.receipt)) throw fail();
  const receipt = value.receipt.slice(), nonce = crypto.getRandomValues(new Uint8Array(16));
  let session, timer, writing = false, ended = false, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
  void completed.catch(() => {});
  const finish = (error, result) => {
    if (ended) return;
    ended = true; clearTimeout(timer); session?.close();
    if (error) reject(error); else resolve(result);
  };
  const started = performance.now();
  const current = () => {
    const elapsed = performance.now() - started;
    if (ended || signal?.aborted || session?.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 60000) throw fail();
  };
  try {
    session = await openLocalPersonaSession({wasm, store, expectedGroup: group,
      peer: value.invitation.issuer, role: 'offer', signal,
      onMessage: async message => {
        try {
          current();
          const reply = parse(message, 2);
          if (writing || !same(reply.nonce, nonce) || !same(reply.receipt, receipt)) throw fail();
          writing = true;
          const result = await store.compareAndSwapMany([{scope: 'candidate-persona', key: 'active',
            expectedRevision: saved.revision, value: {...value, peerAcknowledged: true}}], {signal: session.signal});
          if (!result.applied) throw fail();
          // Actual commit wins over cancellation during completion delivery.
          finish(null, {status: 'installed-local', peerAcknowledged: true, revision: result.revisions[0]});
        } catch (error) { finish(error); }
      }});
    const aborted = () => { if (!writing) finish(fail()); };
    session.signal.addEventListener('abort', aborted, {once: true});
    if (session.signal.aborted) aborted();
    if (ended) throw fail();
    timer = setTimeout(() => { session.close(); if (!writing) finish(fail()); }, 60000);
    void (async () => { await session.authenticated(); current(); await session.send(packet(1, nonce, receipt)); })().catch(error => finish(error));
    return Object.freeze({offer: session.offer, accept: session.accept, completed,
      close: () => { session.close(); if (!writing) finish(fail()); }});
  } catch (error) { finish(error); throw error; }
}
