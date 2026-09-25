// Local test infrastructure only: a TLS WebSocket stand-in for the current hive
// binding. Not a deployable server and not the deployed hive implementation.
import {createServer} from 'node:https';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {wsServer}=require('../../node_modules/playwright-core/lib/utilsBundle.js');
export async function createLocalTestRelay(handler){
  const directory=await mkdtemp(join(tmpdir(),'along-enrolled-relay-'));let server,sockets;
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key'),'-out',join(directory,'cert'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
    server=createServer({key:await readFile(join(directory,'key')),cert:await readFile(join(directory,'cert'))},handler);
    // Local stand-in for the current hive binding (r2.extended.v1): binary
    // extended frames only, relay mutation, duplicate suppression, the shared
    // 200-byte replication limit and two-second development HEARTBEATs.
    sockets=new wsServer({server,path:'/r2',maxPayload:65535,handleProtocols:protocols=>protocols.has('r2.extended.v1')?'r2.extended.v1':false});
    let connections=0,frames=0,limited=0,plaintextObserved=false;const seen=new Map(),rates=new Map(),hiveEntry=Buffer.from('0e6c3b8c7e57a11e','hex');
    const heartbeat=process.env.R2_HIVE_UPSTREAM?undefined:setInterval(()=>{
      const body=Buffer.from('01047e57a11e0204000000010301 01'.replace(/ /g,''),'hex'),frame=Buffer.alloc(31+body.length);
      frame[0]=0x2c;frame[1]=0x10;frame.writeUInt32BE(Math.random()*2**32>>>0,2);frame.writeUInt32BE(body.length,10);frame[22]=1;hiveEntry.copy(frame,23);body.copy(frame,31);
      for(const s of sockets.clients)if(s.readyState===1)s.send(frame,{binary:true});
    },2000);
    // R2_HIVE_UPSTREAM pipes each connection to an actual hive (for example the
    // deployed wss://…/r2), so the unchanged browser checks exercise its relay;
    // drop() then closes that client's upstream connection.
    const upstream=process.env.R2_HIVE_UPSTREAM;
    sockets.on('connection',socket=>{
      if(socket.protocol!=='r2.extended.v1'){socket.close(1002,'Subprotocol required');return;}
      connections++;
      if(upstream){
        const remote=new WebSocket(upstream,'r2.extended.v1');remote.binaryType='arraybuffer';const early=[];
        remote.onopen=()=>{if(remote.protocol!=='r2.extended.v1'){socket.close(1002,'Upstream protocol');return;}for(const x of early.splice(0))remote.send(x);};
        remote.onmessage=({data})=>{if(socket.readyState===1)socket.send(Buffer.from(data),{binary:true});};
        remote.onclose=remote.onerror=()=>{if(socket.readyState<=1)socket.close(1012,'Upstream closed');};
        socket.on('message',(data,binary)=>{
          if(!binary||!data.length){socket.close(1003,'Binary frames only');return;}
          const x=Buffer.from(data);frames++;
          if(/Relay origin|Relay destination|Offline origin|Offline destination/.test(x.toString('utf8')))plaintextObserved=true;
          if(x.length>=31&&(x[0]&4)&&x[22]>=1)socket.hiveHalf??=x.subarray(27,31).toString('hex');
          if(remote.readyState===1)remote.send(x);else if(remote.readyState===0&&early.length<64)early.push(x);
        });
        socket.on('close',()=>{try{remote.close();}catch{}});
        return;
      }
      socket.on('message',(data,binary)=>{
        if(!binary||!data.length){socket.close(1003,'Binary frames only');return;}
        const x=Buffer.from(data);frames++;
        if(/Relay origin|Relay destination|Offline origin|Offline destination/.test(x.toString('utf8')))plaintextObserved=true;
        if(x.length<31||(x[0]>>6)!==0||!(x[0]&4))return;
        const count=x[22],length=x.readUInt32BE(10),hop=x[1]>>4,budget=x[1]&15,at=23+8*count;
        if(count<1||count>=8||x.length<at||x.length-at<length)return;
        socket.hiveHalf??=x.subarray(27,31).toString('hex');
        const now=Date.now(),key=x.subarray(23,31).toString('hex')+':'+x.readUInt32BE(2);
        for(const [k,t] of seen)if(now-t>30000)seen.delete(k);
        if(seen.has(key)||hop<2||(budget>>1)===0||length>200)return;seen.set(key,now);
        // Per-origin replication limit as deployed: 64 frames per 10-second window.
        const origin=x.subarray(23,31).toString('hex'),rate=rates.get(origin);
        if(!rate||now-rate.start>=10000)rates.set(origin,{start:now,count:1});else if(++rate.count>64){limited++;return;}
        const out=Buffer.alloc(x.length+8);x.copy(out,0,0,at);out[1]=((hop-1)<<4)|(budget>>1);out[22]=count+1;hiveEntry.copy(out,at);x.copy(out,at+8,at);
        for(const other of sockets.clients)if(other!==socket&&other.readyState===1)other.send(out,{binary:true});
      });
    });
    return {server,stats:()=>({connections,frames,limited,plaintextObserved}),drop(member){let count=0;const half=createHash('sha256').update(Buffer.from(member,'hex')).digest().subarray(0,4).toString('hex');for(const socket of sockets.clients)if(socket.hiveHalf===half){socket.close(1012,'Test reconnect');count++;}if(!count)throw Error('No connected relay member');},
      async close(){clearInterval(heartbeat);for(const socket of sockets.clients)socket.terminate();await new Promise(r=>sockets.close(r));await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}};
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
