import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayEnrollmentCarriage} from './relay-enrollment-peer.mjs';
function setup() {
  const listeners=[], closed=[false,false], carried=[];
  const channels=[0,1].map(i=>({
    subscribe(fn){listeners[i]=fn;return ()=>{listeners[i]=undefined;};},
    async send(text){if(closed[i])throw Error('closed');carried.push(text);listeners[1-i]?.(text);},
    close(){closed[i]=true;},
  }));
  const carriage=channels.map(createRelayEnrollmentCarriage);
  return {carriage,closed,carried,inject:(i,text)=>listeners[i]?.(text)};
}
test('relay exchange binds both fresh contributions and separates signalling from peer data',async()=>{
  const {carriage,carried}=setup(), received=[[],[]], signalling=[[],[]];
  try {
    carriage.forEach((c,i)=>c.signalling.subscribe(text=>signalling[i].push(text)));
    await carriage[0].signalling.send(JSON.stringify({profile:'along-enrollment-signalling-v1',kind:'challenge'}));
    const links=carriage.map((c,i)=>c.createPeerLink({role:i?'answer':'offer',onMessage:text=>received[i].push(text),onClose(){}}));
    const offer=await links[0].offer(), answer=await links[1].accept(offer);await links[0].accept(answer);
    await Promise.all(links.map(l=>l.opened()));
    assert.notEqual(offer.nonce,answer.nonce);
    const [a,b]=await Promise.all(links.map(l=>l.transcript()));assert.deepEqual(a,b);
    links[0].send('protected claim');links[1].send('protected bundle');
    assert.deepEqual(received,[['protected bundle'],['protected claim']]);
    assert.equal(signalling[0].length,0);assert.equal(signalling[1].length,1);
    assert.equal(carried.length,3);
    await assert.rejects(links[0].accept(answer));
  } finally {carriage.forEach(c=>c.close());}
});
test('altered transcript contribution produces a different channel binding',async()=>{
  const {carriage}=setup();
  try {
    const links=carriage.map((c,i)=>c.createPeerLink({role:i?'answer':'offer',onMessage(){},onClose(){}}));
    const offer=await links[0].offer();const answer=await links[1].accept({...offer,nonce:'ab'.repeat(32)});
    await links[0].accept(answer);
    assert.notDeepEqual(await links[0].transcript(),await links[1].transcript());
  } finally {carriage.forEach(c=>c.close());}
});
test('unexpected early peer data closes the channel before a session exists',()=>{
  const {carriage,closed,inject}=setup();
  try {
    inject(0,JSON.stringify({profile:'along-relay-enrollment-peer-v1',body:'unsolicited'}));
    assert.equal(closed[0],true);
    assert.throws(()=>carriage[0].createPeerLink({role:'offer',onMessage(){},onClose(){}}));
  } finally {carriage.forEach(c=>c.close());}
});
test('malformed contributions and cancellation reject pending opening',async()=>{
  for(const malformed of [null,{profile:'along-relay-enrollment-peer-v1',type:'offer',nonce:'00'},
    {profile:'along-relay-enrollment-peer-v1',type:'offer',nonce:'00'.repeat(32),extra:true}]){
    const {carriage,closed}=setup();
    try {
      const link=carriage[1].createPeerLink({role:'answer',onMessage(){},onClose(){}});
      await assert.rejects(link.accept(malformed));await assert.rejects(link.opened());assert.equal(closed[1],true);
    }finally{carriage.forEach(c=>c.close());}
  }
  const {carriage}=setup();
  const link=carriage[0].createPeerLink({role:'offer',onMessage(){},onClose(){}});
  carriage.forEach(c=>c.close());await assert.rejects(link.opened());assert.throws(()=>link.send('late'));
});
