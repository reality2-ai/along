// Requires a locally built real r2-relay; never substitutes the forwarding fixture.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createActualRelayTestServer} from './actual-relay-test-server.mjs';
const require=createRequire(import.meta.url);
const {ws:WebSocket}=require('../../node_modules/playwright-core/lib/utilsBundle.js');
if(!process.env.R2_RELAY_BINARY)throw Error('Set R2_RELAY_BINARY to the built real relay');
const relay=await createActualRelayTestServer((req,res)=>res.end('test'),process.env.R2_RELAY_BINARY);
try{
  await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));
  const socket=new WebSocket(`wss://127.0.0.1:${relay.server.address().port}/r2`,{rejectUnauthorized:false});
  const result=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{socket.terminate();reject(Error('Invalid greeting was not rejected'));},10000);
    socket.on('error',reject);
    socket.on('open',()=>socket.send(JSON.stringify({type:'hello',version:1,trust_group:'12'.repeat(8),device_id:'34'.repeat(32),timestamp:Math.floor(Date.now()/1000),signature:'00'.repeat(64)})));
    socket.on('message',()=>{clearTimeout(timeout);socket.terminate();reject(Error('Unexpected relay response to invalid signature'));});
    socket.on('close',(code)=>{clearTimeout(timeout);resolve(code);});
  });
  assert.equal(result,4401);assert.equal(relay.stats().greetings,0);
  assert.equal((await relay.actualStats()).connections_total,0);
  console.log('PASS: actual R2 relay rejects invalid signed greeting with 4401; no welcome or accepted connection.');
}finally{await relay.close();}
