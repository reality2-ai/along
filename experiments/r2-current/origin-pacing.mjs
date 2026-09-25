// Relay admission belongs to an origin, not a WebSocket lifetime. Persist only
// recent send timestamps, using atomic revisions so tabs share the same budget.
// This is disposable local timing metadata, never a credential or authority.
const scope = 'along-relay-pacing-v1';
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export async function createOriginPacer({store,endpoint,origin,now=()=>Date.now(),window}) {
  if(typeof store?.read!=='function'||typeof store?.compareAndSwapMany!=='function'
      ||!(origin instanceof Uint8Array)||origin.length!==8
      ||!Number.isSafeInteger(window?.frames)||window.frames<1||window.frames>64
      ||!Number.isSafeInteger(window.ms)||window.ms<1)throw Error('Relay pacing unavailable');
  const key=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([endpoint,hex(origin)])))));
  const valid=value=>value?.format===1&&value.frames===window.frames&&value.ms===window.ms
    &&Number.isSafeInteger(value.last)&&value.last>=0&&Array.isArray(value.recent)&&value.recent.length<=window.frames
    &&value.recent.every((t,i)=>Number.isSafeInteger(t)&&t>=0&&t<=value.last&&(i===0||t>=value.recent[i-1]));
  return Object.freeze({
    async reserve() {
      for(let attempt=0;attempt<4;attempt++) {
        const saved=await store.read(scope,key),value=saved?.value;
        // Sample after the asynchronous read: another tab may have committed
        // while that read was queued; an older sample is not clock rollback.
        const time=now();if(!Number.isSafeInteger(time)||time<0)throw Error('Relay clock unavailable');
        const consistent=valid(value)&&time>=value.last,t=time;
        // Corruption/profile change cannot erase recent debt and permit a burst.
        const recent=consistent?value.recent.filter(v=>t-v<window.ms):saved?Array(window.frames).fill(t):[];
        if(consistent&&recent.length>=window.frames)return Math.max(1,recent[0]+window.ms-time);
        const admitted=recent.length<window.frames;
        if(admitted)recent.push(t);
        const result=await store.compareAndSwapMany([{scope,key,expectedRevision:saved?.revision??0,
          value:{format:1,frames:window.frames,ms:window.ms,last:t,recent}}]);
        if(result.applied)return admitted?0:window.ms;
      }
      return 25; // Another tab won; yield and reread without granting a token.
    },
  });
}
