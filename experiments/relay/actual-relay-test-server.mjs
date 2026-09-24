// Test-only TLS front for an actual r2-relay binary. It never authenticates,
// welcomes, broadcasts or answers pings itself: all protocol work is upstream.
import {createServer} from 'node:https';
import {createServer as createPortReservation} from 'node:net';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url);
const {ws:WebSocket,wsServer}=require('../../node_modules/playwright-core/lib/utilsBundle.js');
export async function createActualRelayTestServer(handler,binary){
  const directory=await mkdtemp(join(tmpdir(),'along-actual-r2-'));
  let process,server,sockets,exitPromise;const upstreams=new Set();let greetings=0,frames=0,plaintextObserved=false;
  async function close(){
    for(const socket of sockets?.clients||[])socket.terminate();
    for(const upstream of upstreams)upstream.terminate();
    if(sockets)await new Promise(r=>sockets.close(r));
    if(server?.listening)await new Promise(r=>server.close(r));
    if(process&&process.exitCode===null)process.kill('SIGTERM');
    if(exitPromise)await exitPromise;
    await rm(directory,{recursive:true,force:true});
  }
  try{
    const reservation=createPortReservation();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
    const port=reservation.address().port;await new Promise(r=>reservation.close(r));
    process=spawn(binary,['--bind','127.0.0.1','--port',String(port)],{stdio:['ignore','ignore','ignore']});
    let launchError;process.on('error',error=>{launchError=error;});
    exitPromise=new Promise(r=>{process.once('exit',r);process.once('error',r);});
    let ready=false;
    for(let i=0;i<100;i++){
      if(launchError)throw launchError;
      if(process.exitCode!==null)throw Error('Actual r2-relay exited before readiness');
      try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(500)});ready=response.ok&&(await response.text())==='r2-relay ok';}catch{}
      if(ready)break;await delay(50);
    }
    if(!ready)throw Error('Actual r2-relay health timeout');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key'),'-out',join(directory,'cert'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
    server=createServer({key:await readFile(join(directory,'key')),cert:await readFile(join(directory,'cert'))},handler);
    sockets=new wsServer({server,path:'/r2',maxPayload:65536});
    sockets.on('connection',socket=>{
      const upstream=new WebSocket(`ws://127.0.0.1:${port}/r2`);upstreams.add(upstream);const queue=[];
      upstream.on('open',()=>{for(const [data,binary] of queue)upstream.send(data,{binary});queue.length=0;});
      socket.on('message',(data,binary)=>{
        if(binary){frames++;if(/Relay origin|Relay destination|Offline origin|Offline destination/.test(data.toString('utf8')))plaintextObserved=true;}
        else try{const message=JSON.parse(data.toString());if(message.type==='hello')socket.member=message.device_id;}catch{}
        if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary});
        else if(upstream.readyState===WebSocket.CONNECTING&&queue.length<32)queue.push([data,binary]);
        else socket.terminate();
      });
      upstream.on('message',(data,binary)=>{
        if(!binary)try{if(JSON.parse(data.toString()).type==='welcome')greetings++;}catch{}
        if(socket.readyState===WebSocket.OPEN)socket.send(data,{binary});
      });
      upstream.on('error',()=>socket.terminate());
      socket.on('error',()=>upstream.terminate());
      upstream.on('close',(code,reason)=>{upstreams.delete(upstream);if(socket.readyState===WebSocket.OPEN){if(code===1006)socket.terminate();else if(code===1005)socket.close();else socket.close(code,reason);}});
      socket.on('close',()=>upstream.terminate());
    });
    return {server,stats:()=>({greetings,frames,plaintextObserved}),
      async actualStats(){const response=await fetch(`http://127.0.0.1:${port}/stats`);if(!response.ok)throw Error('Actual relay statistics unavailable');return response.json();},
      drop(member){let count=0;for(const socket of sockets.clients)if(socket.member===member){socket.close(1012,'Test reconnect');count++;}if(!count)throw Error('No connected relay member');},close};
  }catch(error){await close();throw error;}
}
