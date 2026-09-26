import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryProtection} from './recovery-link-protection.mjs';
async function pair() {
  const a=createRecoveryProtection('offer'),b=createRecoveryProtection('answer');
  const [ap,bp]=await Promise.all([a.publicKey(),b.publicKey()]);
  const transcript=crypto.getRandomValues(new Uint8Array(32));
  await Promise.all([a.bind(bp,transcript),b.bind(ap,transcript)]);
  return {a,b,ap,bp,transcript};
}
test('inner recovery protects both directions and refuses reflected or replayed ciphertext',async()=>{
  const {a,b}=await pair();
  try {
    const ciphertext=await a.protect('synthetic new keys');
    assert.ok(!ciphertext.includes('synthetic'));
    await assert.rejects(a.open(ciphertext),'Direction-specific keys refuse reflection');
    assert.equal(await b.open(ciphertext),'synthetic new keys');
    await assert.rejects(b.open(ciphertext),'Repeated counter refused');
    assert.equal(await a.open(await b.protect('receipt')),'receipt');
    a.close();await assert.rejects(a.protect('late'));await assert.rejects(a.open('late'));
  } finally {a.close();b.close();}
});
test('public transcript and invitation possession do not supply the inner private key',async()=>{
  const {a,b,ap,transcript}=await pair(),observer=createRecoveryProtection('answer');
  try {
    await observer.publicKey();await observer.bind(ap,transcript);
    const ciphertext=await a.protect('synthetic new keys');
    await assert.rejects(observer.open(ciphertext));
    assert.equal(await b.open(ciphertext),'synthetic new keys');
  } finally {a.close();b.close();observer.close();}
});
test('changed transcript or tampered ciphertext cannot release recovery plaintext',async()=>{
  const a=createRecoveryProtection('offer'),b=createRecoveryProtection('answer');
  try {
    const [ap,bp]=await Promise.all([a.publicKey(),b.publicKey()]),salt=new Uint8Array(32);
    await a.bind(bp,salt);salt[0]=1;await b.bind(ap,salt);
    await assert.rejects(b.open(await a.protect('synthetic')));
  } finally {a.close();b.close();}
  const second=await pair();
  try {
    const frame=JSON.parse(await second.a.protect('synthetic'));
    const bytes=atob(frame.ciphertext);frame.ciphertext=btoa(String.fromCharCode(bytes.charCodeAt(0)^1)+bytes.slice(1));
    await assert.rejects(second.b.open(JSON.stringify(frame)));
  } finally {second.a.close();second.b.close();}
});
