// Local test infrastructure only. Independent greeting verifier and opaque
// forwarding by default. R2_RELAY_BINARY opts into the actual implementation
// behind a test TLS front. Neither mode is a deployable server.
import {createServer} from 'node:https';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createPublicKey,verify} from 'node:crypto';
const require=createRequire(import.meta.url);
const {wsServer}=require('../../node_modules/playwright-core/lib/utilsBundle.js');
export async function createLocalTestRelay(handler){
  if(process.env.R2_RELAY_BINARY)return (await import('./actual-relay-test-server.mjs')).createActualRelayTestServer(handler,process.env.R2_RELAY_BINARY);
  const directory=await mkdtemp(join(tmpdir(),'along-enrolled-relay-'));let server,sockets;
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key'),'-out',join(directory,'cert'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
    server=createServer({key:await readFile(join(directory,'key')),cert:await readFile(join(directory,'cert'))},handler);
    sockets=new wsServer({server,path:'/r2',maxPayload:65536});let greetings=0,frames=0,plaintextObserved=false;
    sockets.on('connection',socket=>{
      const deadline=setTimeout(()=>socket.close(4401,'Greeting timeout'),10000);socket.on('close',()=>clearTimeout(deadline));
      socket.on('message',(data,binary)=>{
        if(!socket.member){
          try{
            if(binary)throw Error();const h=JSON.parse(data.toString());
            if(h.type!=='hello'||h.version!==1||!/^[0-9a-f]{16}$/.test(h.trust_group)||!/^[0-9a-f]{64}$/.test(h.device_id)
                ||!/^[0-9a-f]{128}$/.test(h.signature)||!Number.isSafeInteger(h.timestamp)||Math.abs(h.timestamp-Math.floor(Date.now()/1000))>60)throw Error();
            const key=createPublicKey({format:'jwk',key:{kty:'OKP',crv:'Ed25519',x:Buffer.from(h.device_id,'hex').toString('base64url')}});
            if(!verify(null,Buffer.from(`${h.trust_group}:${h.device_id}:${h.timestamp}`),key,Buffer.from(h.signature,'hex')))throw Error();
            socket.member=h.device_id;socket.group=h.trust_group;greetings++;clearTimeout(deadline);
            socket.send(JSON.stringify({type:'welcome',version:1,peers:1,buffer_oldest:0}));
          }catch{socket.close(4401,'Invalid greeting');}return;
        }
        if(binary){frames++;if(/Relay origin|Relay destination|Offline origin|Offline destination/.test(data.toString('utf8')))plaintextObserved=true;for(const other of sockets.clients)if(other!==socket&&other.group===socket.group&&other.readyState===1)other.send(data,{binary:true});}
        else{try{if(JSON.parse(data.toString()).type==='ping')socket.send('{"type":"pong"}');}catch{socket.close(4401,'Invalid control');}}
      });
    });
    return {server,stats:()=>({greetings,frames,plaintextObserved}),drop(member){let count=0;for(const socket of sockets.clients)if(socket.member===member){socket.close(1012,'Test reconnect');count++;}if(!count)throw Error('No connected relay member');},
      async close(){for(const socket of sockets.clients)socket.terminate();await new Promise(r=>sockets.close(r));await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}};
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
