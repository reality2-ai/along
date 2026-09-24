import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, verify, createPublicKey} from 'node:crypto';
import {createRelayHello} from './hello.mjs';
const hex = b => Buffer.from(b).toString('hex');
async function fixture() {
  const key=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
  const group=crypto.getRandomValues(new Uint8Array(32));
  return {group,persona:{group:hex(group),member:hex(await crypto.subtle.exportKey('raw',key.publicKey)),
    sign:async bytes=>new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,bytes))}};
}
test('greeting matches independently verified relay v1 signature and routing hash',async()=>{
  const {group,persona}=await fixture(); const h=JSON.parse(await createRelayHello({persona,expectedGroup:group,timestamp:1234567}));
  assert.equal(h.trust_group,createHash('sha256').update(group).digest('hex').slice(0,16));
  assert.equal(h.version,1); assert.equal(h.type,'hello'); assert.equal(h.device_id,persona.member);
  const publicKey=createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:Buffer.from(h.device_id,'hex').toString('base64url')},format:'jwk'});
  assert.equal(verify(null,Buffer.from(`${h.trust_group}:${h.device_id}:${h.timestamp}`),publicKey,Buffer.from(h.signature,'hex')),true);
  assert.equal(verify(null,Buffer.from(`${h.trust_group}:${h.device_id}:1234568`),publicKey,Buffer.from(h.signature,'hex')),false);
});
test('wrong group, invalid signature, and cancellation refuse',async()=>{
  const {group,persona}=await fixture();
  await assert.rejects(createRelayHello({persona,expectedGroup:new Uint8Array(32)}));
  await assert.rejects(createRelayHello({persona:{...persona,sign:async()=>new Uint8Array(64)},expectedGroup:group}));
  const cancel=new AbortController();
  await assert.rejects(createRelayHello({persona:{...persona,sign:async b=>{const s=await persona.sign(b);cancel.abort();return s;}},expectedGroup:group,signal:cancel.signal}));
});
