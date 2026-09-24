// Node-side browser test helper. Harness supplies selected peer public IDs;
// this is network/cryptography coverage, not enrollment or consent UI coverage.
import assert from 'node:assert/strict';
export async function checkPeerNetwork({browser,url,dropPeer}) {
  const contexts=await Promise.all([0,1].map(()=>browser.newContext({ignoreHTTPSErrors:true})));
  try{
    const pages=await Promise.all(contexts.map(c=>c.newPage()));const group=[...crypto.getRandomValues(new Uint8Array(32))];
    const ids=await Promise.all(pages.map(async p=>{
      await p.goto(url);
      return p.evaluate(async()=>{
        window.key=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
        window.identity=new Uint8Array(await crypto.subtle.exportKey('raw',key.publicKey));return [...identity];
      });
    }));
    await Promise.all(pages.map((p,i)=>p.evaluate(async({group,peer,role})=>{
      const {createRelayHandshake}=await import('./handshake.mjs');
      const {createRelayTransport}=await import('./transport.mjs');const {createRelayHello}=await import('./hello.mjs');
      const root=new Uint8Array(group),remote=new Uint8Array(peer),hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
      const sign=async b=>new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,b));
      const {createRelayPeerLifecycle}=await import('./peer-lifecycle.mjs');
      window.received=[];window.failure=null;window.statuses=[];window.peerStatuses=[];window.allow=true;
      window.lifecycle=createRelayPeerLifecycle({local:identity,peer:remote,
        openHandshake:signal=>createRelayHandshake({role,group:root,epoch:0n,local:identity,peer:remote,sign,check:async()=>{if(!window.allow)throw Error('Permission removed');},signal}),
        send:frame=>{if(frame[8]===1&&!window.firstContribution)window.firstContribution=frame.slice();transport.send(frame);},onMessage:frame=>received.push([...frame]),onStatus:s=>peerStatuses.push(s)});
      window.transport=createRelayTransport({url:`wss://${location.host}/r2`,
        createHello:()=>createRelayHello({persona:{group:hex(root),member:hex(identity),sign},expectedGroup:root}),
        onStatus:s=>{statuses.push(s);if(s==='connected')lifecycle.connected();else lifecycle.disconnected();},onFrame:frame=>lifecycle.receive(frame)});
      transport.start();
    },{group,peer:ids[1-i],role:i?'answer':'offer'})));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>statuses.at(-1)==='connected')));
    try{await Promise.all(pages.map(p=>p.waitForFunction(()=>peerStatuses.includes('peer-connected')||peerStatuses.includes('peer-unavailable'),{},{timeout:10000})));}
    catch(error){console.log(await Promise.all(pages.map(p=>p.evaluate(()=>({statuses,peerStatuses,failure})))));throw error;}
    for(const p of pages)assert.equal(await p.evaluate(()=>peerStatuses.at(-1)),'peer-connected');
    await pages[0].evaluate(async()=>lifecycle.send(new Uint8Array([11,22,33])));
    await pages[1].waitForFunction(()=>received.length===1||failure);
    assert.deepEqual(await pages[1].evaluate(()=>received),[[11,22,33]]);
    await pages[0].evaluate(()=>{const fake=firstContribution.slice();fake[73]^=1;fake[138]^=1;transport.send(fake);});
    await pages[1].evaluate(async()=>lifecycle.send(new Uint8Array([44,55])));
    await pages[0].waitForFunction(()=>received.length===1||failure);
    assert.deepEqual(await pages[0].evaluate(()=>received),[[44,55]]);
    if(dropPeer){
      await dropPeer(ids[0].map(b=>b.toString(16).padStart(2,'0')).join(''));
      try{await Promise.all(pages.map(p=>p.waitForFunction(()=>peerStatuses.filter(s=>s==='peer-connected').length===2,{},{timeout:15000})));}
      catch(error){console.log(await Promise.all(pages.map(p=>p.evaluate(()=>({statuses,peerStatuses})))));throw error;}
      await pages[0].evaluate(()=>transport.send(firstContribution));
      await pages[0].evaluate(()=>lifecycle.send(new Uint8Array([66])));
      await pages[1].waitForFunction(()=>received.length===2);assert.deepEqual(await pages[1].evaluate(()=>received[1]),[66]);
    }
    assert.equal(await pages[0].evaluate(async()=>{
      window.allow=false;try{await lifecycle.send(new Uint8Array([99]));return false;}catch{return true;}
    }),true);
    assert.equal(await pages[0].evaluate(()=>peerStatuses.at(-1)),'peer-unavailable');
    await Promise.all(pages.map(p=>p.evaluate(()=>{lifecycle.close();transport.disconnect();})));
    console.log('PASS: two isolated Chromium contexts exchange signed contributions, key confirmation and encrypted bytes through local WSS forwarding; one-sided socket loss rekeys both peers; authority loss ends the session. Synthetic identities; peer selection and consent supplied by harness.');
  }finally{await Promise.all(contexts.map(c=>c.close()));}
}
