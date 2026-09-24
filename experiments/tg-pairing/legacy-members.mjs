import {loadLocalPersona} from './local-persona.mjs';
import {readIssuedMembers} from './software-persona.mjs';
import {certificateCodec} from './certificate.mjs';
const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const same = (a, b) => fixed(a, b.length) && a.every((byte, index) => byte === b[index]);
const fail = () => new Error('Older device records unavailable');

// Along-specific read-only index recovery for the pinned browser storage v1.
// The runtime adapter has no enumeration API. Enumerate ONLY public receipt keys,
// never credential/persona values; all reads/writes then use the normal adapter.
async function receiptKeys(databaseName, group, signal) {
  if (typeof databaseName !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(databaseName) || signal?.aborted) throw fail();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('r2-browser:' + databaseName, 1);
    let abandoned = false;
    request.onupgradeneeded = () => { request.transaction.abort(); };
    request.onblocked = () => { abandoned = true; reject(fail()); };
    request.onerror = () => reject(fail());
    request.onsuccess = () => { if (abandoned || signal?.aborted) { request.result.close(); reject(fail()); } else resolve(request.result); };
  });
  try {
    if (db.version !== 1 || !db.objectStoreNames.contains('records')) throw fail();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly'), keys = [];
      const cancel = () => { try { tx.abort(); } catch {} };
      signal?.addEventListener('abort', cancel, {once: true});
      const finish = () => signal?.removeEventListener('abort', cancel);
      tx.oncomplete = () => { finish(); resolve(keys); };
      tx.onabort = () => { finish(); reject(fail()); }; tx.onerror = () => {};
      const request = tx.objectStore('records').openKeyCursor(IDBKeyRange.bound(
        ['enrollment-installations', group + ':'], ['enrollment-installations', group + ':\uffff']));
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        const key = cursor.key?.[1];
        if (typeof key !== 'string' || !new RegExp('^' + group + ':[0-9a-f]{32}$').test(key) || keys.length >= 256) { cancel(); return; }
        keys.push(key); cursor.continue();
      };
      if (signal?.aborted) cancel();
    });
  } finally { db.close(); }
}

export async function restoreIssuedMembers({wasm, store, databaseName, expectedGroup, signal}) {
  if (!fixed(expectedGroup, 32) || store.capabilities?.transactionChecks !== true) throw fail();
  const group = expectedGroup.slice(), groupId = hex(group);
  const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
  if (identity?.origin !== 'initial') throw fail();
  const keys = await receiptKeys(databaseName, groupId, signal);
  for (const key of keys) {
    let complete = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal?.aborted) throw fail();
      const persona = await store.read('candidate-persona', 'active');
      const installation = await store.read('enrollment-installations', key);
      const journal = await store.read('enrollment-invitations', key);
      const value = installation?.value, receipt = value?.receipt;
      if (value?.format !== 1 || journal?.value?.format !== 1 || journal.value.state !== 'consumed'
          || !fixed(value.subject, 32) || !fixed(receipt, 154) || receipt[0] !== 1 || receipt[65] !== 1
          || !same(receipt.slice(1, 33), group) || hex(receipt.slice(33, 65)) !== identity.member
          || groupId + ':' + hex(receipt.slice(66, 82)) !== key || !same(receipt.slice(90, 122), value.subject)
          || !certificateCodec(wasm).authentic(value.certificate, value.subject, group)) throw fail();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value.certificate));
      if (!same(digest, receipt.slice(122))) throw fail();
      const saved = await store.read('along-issued-members-v1', groupId);
      const members = await readIssuedMembers({wasm, store, expectedGroup: group});
      if (members.some(member => same(member.subject, value.subject))) { complete = true; break; }
      if (members.length >= 256) throw fail();
      members.push({subject: value.subject.slice(), certificate: value.certificate.slice()});
      const result = await store.compareAndSwapMany([{scope: 'along-issued-members-v1', key: groupId,
        expectedRevision: saved?.revision ?? 0, value: {format: 1, members}}], {signal, checks: [
        {scope: 'candidate-persona', key: 'active', expectedRevision: persona?.revision ?? 0},
        {scope: 'enrollment-installations', key, expectedRevision: installation.revision},
        {scope: 'enrollment-invitations', key, expectedRevision: journal.revision},
      ]});
      if (result.applied) { complete = true; break; }
    }
    if (!complete) throw fail();
  }
}
