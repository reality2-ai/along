// Node-side browser test helper. Harness supplies selected peer public IDs;
// this is network/cryptography coverage, not enrollment or consent UI coverage.
import assert from 'node:assert/strict';
export async function checkPeerNetwork({browser,url}) {
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
      window.handshake=await createRelayHandshake({role,group:root,epoch:0n,local:identity,peer:remote,sign,check:async()=>{}});
      const {createRelayPeerExchange}=await import('./peer-exchange.mjs');
      window.received=[];window.failure=null;window.statuses=[];
      window.exchange=await createRelayPeerExchange({handshake,local:identity,peer:remote,
        send:frame=>transport.send(frame),onMessage:frame=>received.push([...frame]),onReady:()=>{window.peerReady=true;}});
      exchange.ready.catch(error=>{window.failure=error.message;});
      window.transport=createRelayTransport({url:`wss://${location.host}/r2`,
        createHello:()=>createRelayHello({persona:{group:hex(root),member:hex(identity),sign},expectedGroup:root}),
        onStatus:s=>{statuses.push(s);if(s==='connected')exchange.start();},onFrame:frame=>exchange.receive(frame)});
      transport.start();
    },{group,peer:ids[1-i],role:i?'answer':'offer'})));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>statuses.at(-1)==='connected')));
    try{await Promise.all(pages.map(p=>p.waitForFunction(()=>window.peerReady||failure,{},{timeout:10000})));}
    catch(error){console.log(await Promise.all(pages.map(p=>p.evaluate(()=>({statuses,failure})))));throw error;}
    for(const p of pages)assert.equal(await p.evaluate(()=>failure),null);
    await pages[0].evaluate(async()=>exchange.send(new Uint8Array([11,22,33])));
    await pages[1].waitForFunction(()=>received.length===1||failure);
    assert.deepEqual(await pages[1].evaluate(()=>received),[[11,22,33]]);
    await pages[1].evaluate(async()=>exchange.send(new Uint8Array([44,55])));
    await pages[0].waitForFunction(()=>received.length===1||failure);
    assert.deepEqual(await pages[0].evaluate(()=>received),[[44,55]]);
    await Promise.all(pages.map(p=>p.evaluate(()=>{exchange.close();transport.disconnect();})));
    console.log('PASS: two isolated Chromium contexts exchange signed contributions, key confirmation and encrypted bytes through local WSS forwarding. Synthetic identities; peer selection and consent supplied by harness.');
  }finally{await Promise.all(contexts.map(c=>c.close()));}
}
