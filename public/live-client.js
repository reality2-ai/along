// Optional transport-feed reader. No location/history arguments or persistence.
const kinds={predictions:'predictions',alerts:'alerts',vehicles:'vehicles'};
const unavailable=reason=>({available:false,reason});
export function createLiveClient({baseURL='',pageURL=globalThis.location?.href,
  fetcher=globalThis.fetch,online=()=>globalThis.navigator?.onLine!==false,
  now=()=>Date.now()/1000,timeoutMs=5000}={}) {
  let base=null,generation=0;
  const pending=new Map(),cache=new Map();
  if(baseURL){
    const url=new URL(baseURL,pageURL);
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:' && !(local && url.protocol==='http:')) ||
       url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/'))
      throw new Error('Live proxy must be an HTTPS base URL without credentials or query parameters.');
    base=url;
  }
  function fresh(data){
    return data?.available===true && typeof data.updated==='number' &&
      Number.isSafeInteger(data.updated) && data.updated>0 && Math.abs(now()-data.updated)<=180;
  }
  function cancel(){
    generation++;
    for(const {controller} of pending.values())controller.abort();
    pending.clear();cache.clear();
  }
  async function read(kind,{requested=false}={}){
    if(!Object.hasOwn(kinds,kind))throw new Error('Unknown live feed.');
    // No network access, even to discover configuration, without explicit intent.
    if(!requested)return unavailable('not-requested');
    if(!base)return unavailable('not-configured');
    if(!online()){cancel();return unavailable('offline');}
    const saved=cache.get(kind);
    if(saved && now()>=saved.at && now()-saved.at<60 && fresh(saved.data))return saved.data;
    if(pending.has(kind))return pending.get(kind).promise;
    const controller=new AbortController(),sequence=generation;
    const promise=(async()=>{
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetcher(new URL(kinds[kind],base),{
          credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',
          redirect:'error',headers:{Accept:'application/json'},signal:controller.signal
        });
        if(!response.ok)return unavailable('unavailable');
        const data=await response.json();
        if(sequence!==generation || !online())return unavailable('cancelled');
        if(!fresh(data))return unavailable(data?.available?'stale':'unavailable');
        if(!Array.isArray(kind==='alerts'?data.alerts:data.entities))return unavailable('invalid');
        cache.set(kind,{at:now(),data});
        return data;
      }catch{return unavailable(controller.signal.aborted?'cancelled':'unavailable');}
      finally{clearTimeout(timer);}
    })();
    pending.set(kind,{controller,promise});
    promise.then(()=>{if(pending.get(kind)?.controller===controller)pending.delete(kind);});
    return promise;
  }
  return {configured:!!base,read,cancel};
}
