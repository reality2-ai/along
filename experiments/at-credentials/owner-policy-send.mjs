import {loadLocalATOwner} from './local-owner.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {encodePolicyUpdate} from './policy-update-message.mjs';
const fail = () => new Error('AT policy delivery unavailable');
// Trusted controller supplies a session authenticated to the selected TG member.
// Public policy is sent even when the recipient's AT grant has been removed.
export async function sendOwnerPolicy({wasm, store, expectedGroup, connection}) {
  try {
    if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32 || !connection?.signal) throw fail();
    const group = expectedGroup.slice(), signal = connection.signal;
    const current = () => { if (signal.aborted) throw fail(); };
    current(); await connection.authenticated(); current();
    const owner = await loadLocalATOwner({wasm, store, expectedGroup: group, signal});
    if (!owner) throw fail();
    const {binding} = owner;
    const anchor = await store.read('along-at-owners', binding.group);
    const loaded = await openCredentialPolicyStore({store, ...binding}).read({signal});
    if (loaded.status !== 'policy-loaded') throw fail();
    const scope = 'along-at-policy:' + binding.owner, key = binding.group + ':' + binding.credential;
    const saved = await store.read(scope, key);
    if (saved?.revision !== loaded.storageRevision) throw fail();
    const packet = encodePolicyUpdate(saved.value.bytes, saved.value.signature);
    await connection.authenticated(); current();
    if (!anchor || (await store.read('along-at-owners', binding.group))?.revision !== anchor.revision
        || (await store.read(scope, key))?.revision !== saved.revision) throw fail();
    current(); await connection.send(packet);
    return Object.freeze({status: 'policy-sent-unconfirmed', revision: loaded.policy.revision});
  } catch { throw fail(); }
}
