// Along application carriage, not a declared R2 enrollment transport profile.
// The reviewed invitation channel already binds the endpoint and session. Fresh
// contributions below bind the exchange transcript; the existing X25519 ceremony
// still derives the comparison and protects membership material independently.
const PROFILE = 'along-relay-enrollment-peer-v1';
const encoder = new TextEncoder();
const fields = (value, names) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value,name));
export function createRelayEnrollmentCarriage(channel,{onClose=()=>{}}={}) {
  let closed = false, signallingListener, peerListener, peerClose;
  const close = (notify = true) => {
    if (closed) return; closed = true; unsubscribe();
    // A deliberate cancellation should reach the other screen promptly. Delivery
    // is best effort; abrupt browser loss still ends at the invitation deadline.
    if (notify && peerClose) {
      const timer = setTimeout(()=>channel.close(),2000);
      try { void Promise.resolve(channel.send(JSON.stringify({profile:PROFILE,close:true})))
        .catch(()=>{}).finally(()=>{clearTimeout(timer);channel.close();}); }
      catch { clearTimeout(timer); channel.close(); }
    } else channel.close();
    peerClose?.();
    signallingListener = peerListener = undefined;
    try { onClose(); } catch {}
  };
  const unsubscribe = channel.subscribe(text => {
    if (closed) return;
    try {
      const value = JSON.parse(text);
      if (value?.profile === PROFILE) {
        if (fields(value,['profile','close']) && value.close === true) { close(false); return; }
        if (!fields(value,['profile','body']) || typeof value.body !== 'string'
            || encoder.encode(value.body).length > 16384 || !peerListener) throw Error('Invalid enrollment carriage');
        peerListener(value.body);
      } else {
        if (!signallingListener) throw Error('Signalling unavailable');
        signallingListener(text);
      }
    } catch { close(); }
  });
  let created = false;
  const createPeerLink = ({role,onMessage,onClose}) => {
    if (closed || created || !['offer','answer'].includes(role)) throw Error('Enrollment carriage unavailable');
    created = true;
    let ended = false, local, remote, resolve, reject;
    const opened = new Promise((yes,no) => { resolve=yes; reject=no; });
    void opened.catch(()=>{});
    const stop = () => {
      if (ended) return; ended=true; clearTimeout(timer); reject(Error('Enrollment carriage ended'));
      close(); onClose();
    };
    peerClose = stop;
    const timer = setTimeout(stop,60000);
    const current = () => { if (closed || ended) throw Error('Enrollment carriage ended'); };
    const description = (value,type) => {
      if (!fields(value,['profile','type','nonce']) || value.profile !== PROFILE || value.type !== type
          || typeof value.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(value.nonce)) throw Error('Invalid enrollment contribution');
      return {profile:PROFILE,type,nonce:value.nonce};
    };
    const contribution = type => ({profile:PROFILE,type,
      nonce:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')});
    peerListener = text => { current(); if (!local || !remote) throw Error('Enrollment carriage not ready'); onMessage(text); };
    return Object.freeze({
      async offer() {
        current(); if (role !== 'offer' || local) throw Error('Enrollment offer unavailable');
        local=contribution('offer'); return {...local};
      },
      async accept(value) {
        current();
        try {
          if (remote || (role === 'offer' && !local)) throw Error('Enrollment answer unavailable');
          remote=description(value,role==='offer'?'answer':'offer');
          if (role==='answer') local=contribution('answer');
          resolve(); return role==='answer'?{...local}:null;
        } catch(error) { stop(); throw error; }
      },
      opened:()=>opened,
      send(text) {
        current();
        if (!local || !remote || typeof text !== 'string' || encoder.encode(text).length>16384) throw Error('Enrollment send unavailable');
        // Existing link sends synchronously; completion/failure remains owned by
        // this carriage. The bounded invitation channel preserves message order.
        try { void Promise.resolve(channel.send(JSON.stringify({profile:PROFILE,body:text}))).catch(stop); }
        catch(error) { stop(); throw error; }
      },
      async transcript() {
        current(); if (!local || !remote) throw Error('Enrollment transcript unavailable');
        const pair=role==='offer'?[local,remote]:[remote,local];
        const result=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(PROFILE+'\0'+JSON.stringify(pair))));
        current(); return result;
      },
      close:stop,
    });
  };
  return Object.freeze({createPeerLink,close,
    signalling:Object.freeze({send:text=>{if(closed)throw Error('Connection ended');return channel.send(text);},close,
      subscribe(fn) {if(closed||signallingListener)throw Error('Connection receiver unavailable');signallingListener=fn;
        return ()=>{if(signallingListener===fn)signallingListener=undefined;};}}),
  });
}
