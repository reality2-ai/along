import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isRemovalNotice,removalNoticePackets,readRemovalNotice} from './removal-notices.mjs';
const group=new Uint8Array(32).fill(7);
const encoded=bytes=>Buffer.from(bytes).toString('base64');
test('bounded records round-trip individually without carrying keys or adopting a group',()=>{
 const records=new Uint8Array(113*256);for(let i=0;i<records.length;i++)records[i]=i%251;
 const packets=removalNoticePackets({expectedGroup:group,text:encoded(records)});
 assert.equal(packets.length,256);
 for(let i=0;i<packets.length;i++){
  assert.equal(packets[i].length,153);assert.equal(isRemovalNotice(packets[i]),true);
  assert.equal(readRemovalNotice({expectedGroup:group,packet:packets[i]}),encoded(records.subarray(i*113,(i+1)*113)));
 }
 assert.deepEqual(removalNoticePackets({expectedGroup:group,text:''}),[]);
});
test('wrong group, framing, truncation and oversized input are refused',()=>{
 const [packet]=removalNoticePackets({expectedGroup:group,text:encoded(new Uint8Array(113))});
 assert.throws(()=>readRemovalNotice({expectedGroup:new Uint8Array(32),packet}));
 for(const changed of [packet.slice(1),new Uint8Array(154),new Uint8Array(153)])assert.throws(()=>readRemovalNotice({expectedGroup:group,packet:changed}));
 for(const text of ['?',encoded(new Uint8Array(112)),encoded(new Uint8Array(113*257))])assert.throws(()=>removalNoticePackets({expectedGroup:group,text}));
 const noncanonical=encoded(new Uint8Array(113))+'\n';
 assert.throws(()=>removalNoticePackets({expectedGroup:group,text:noncanonical}));
 assert.equal(isRemovalNotice(new Uint8Array(7)),false);
});
test('codec does not mistake decodability for signature verification',()=>{
 const [packet]=removalNoticePackets({expectedGroup:group,text:encoded(new Uint8Array(113))});
 packet[152]^=1;
 // The caller must pass this to receiveRemovalSet; the codec has no authority.
 assert.notEqual(readRemovalNotice({expectedGroup:group,packet}),encoded(new Uint8Array(113)));
});
