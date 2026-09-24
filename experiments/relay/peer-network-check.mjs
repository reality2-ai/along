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
      window.contribution=await handshake.contribution();window.received=[];window.seen=[];window.failure=null;window.statuses=[];
      let queue=Promise.resolve();
      window.sendFrame=(kind,payload)=>{const packet=new Uint8Array(payload.length+1);packet[0]=kind;packet.set(payload,1);transport.send(packet);};
      window.transport=createRelayTransport({url:`wss://${location.host}/r2`,
        createHello:()=>createRelayHello({persona:{group:hex(root),member:hex(identity),sign},expectedGroup:root}),
        onStatus:s=>statuses.push(s),onFrame:frame=>{
          seen.push(frame[0]);
          queue=queue.then(async()=>{
            if(frame[0]===1)sendFrame(2,await handshake.accept(frame.subarray(1)));
            else if(frame[0]===2)window.channel=await handshake.confirm(frame.subarray(1));
            else if(frame[0]===3)received.push([...await channel.open(frame.subarray(1))]);
            else throw Error('Unexpected test message');
          }).catch(e=>{failure=e.message;handshake.close();transport.disconnect();});
        }});transport.start();
    },{group,peer:ids[1-i],role:i?'answer':'offer'})));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>statuses.at(-1)==='connected')));
    await Promise.all(pages.map(p=>p.evaluate(()=>sendFrame(1,contribution))));
    try{await Promise.all(pages.map(p=>p.waitForFunction(()=>window.channel||failure,{},{timeout:10000})));}
    catch(error){console.log(await Promise.all(pages.map(p=>p.evaluate(()=>({statuses,seen,failure})))));throw error;}
    for(const p of pages)assert.equal(await p.evaluate(()=>failure),null);
    await pages[0].evaluate(async()=>sendFrame(3,await channel.seal(new Uint8Array([11,22,33]))));
    await pages[1].waitForFunction(()=>received.length===1||failure);
    assert.deepEqual(await pages[1].evaluate(()=>received),[[11,22,33]]);
    await pages[1].evaluate(async()=>sendFrame(3,await channel.seal(new Uint8Array([44,55]))));
    await pages[0].waitForFunction(()=>received.length===1||failure);
    assert.deepEqual(await pages[0].evaluate(()=>received),[[44,55]]);
    await Promise.all(pages.map(p=>p.evaluate(()=>{handshake.close();transport.disconnect();})));
    console.log('PASS: two isolated Chromium contexts exchange signed contributions, key confirmation and encrypted bytes through local WSS forwarding. Synthetic identities; peer selection and consent supplied by harness.');
  }finally{await Promise.all(contexts.map(c=>c.close()));}
}
