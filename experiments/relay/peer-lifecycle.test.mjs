import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayPeerLifecycle} from './peer-lifecycle.mjs';
const pause=()=>new Promise(r=>setTimeout(r,0));
test('disconnect during async identity restoration closes late result and sends nothing',async()=>{
  let finish,closed=0,sent=0;const abort=new AbortController();
  const controller=createRelayPeerLifecycle({local:new Uint8Array(32).fill(1),peer:new Uint8Array(32).fill(2),
    openHandshake:()=>new Promise(r=>{finish=r;}),send:()=>sent++,onMessage:()=>{}});
  controller.connected();controller.disconnected();
  finish({close(){closed++;abort.abort();},signal:abort.signal});await pause();
  assert.equal(closed,1);assert.equal(sent,0);await assert.rejects(controller.send(new Uint8Array([1])));controller.close();
});
test('failed restoration does not retry or send without a new transport connection',async()=>{
  let opens=0,sent=0;const statuses=[];
  const controller=createRelayPeerLifecycle({local:new Uint8Array(32).fill(1),peer:new Uint8Array(32).fill(2),
    openHandshake:async()=>{opens++;throw Error('No permission');},send:()=>sent++,onMessage:()=>{},onStatus:s=>statuses.push(s)});
  controller.connected();await pause();assert.equal(statuses.at(-1),'peer-unavailable');
  assert.equal(opens,1);assert.equal(sent,0);controller.close();controller.connected();assert.equal(opens,1);
});
