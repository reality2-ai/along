// Along application carriage, not a declared R2 enrollment transport profile.
// The reviewed invitation channel already binds the endpoint and session. Fresh
// contributions below bind the exchange transcript; the existing X25519 ceremony
// still derives the comparison and protects membership material independently.
import {createRecoveryProtection} from './recovery-link-protection.mjs';
const ENROLLMENT = 'along-relay-enrollment-peer-v1';
const RECOVERY = 'along-relay-epoch-recovery-peer-v1';
const encoder = new TextEncoder();
const fields = (value, names) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value,name));
export const createRelayEnrollmentCarriage = (channel, options) => createCarriage(ENROLLMENT, channel, options);
// Only use this over the protected recovery invitation channel. The transcript
// domain differs from enrollment; recovery still verifies both saved identities.
export const createRelayRecoveryCarriage = (channel, options) => createCarriage(RECOVERY, channel, options);
function createCarriage(PROFILE, channel,{onClose=()=>{}}={}) {
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
        if (value?.profile === ENROLLMENT || value?.profile === RECOVERY) throw Error('Different carriage purpose');
        if (!signallingListener) throw Error('Signalling unavailable');
        signallingListener(text);
      }
    } catch { close(); }
  });
  let created = false;
  const createPeerLink = ({role,onMessage,onClose}) => {
    if (closed || created || !['offer','answer'].includes(role)) throw Error('Enrollment carriage unavailable');
    created = true;
    let ended = false, local, remote, resolve, reject, offered = false;
    const protection=PROFILE===RECOVERY?createRecoveryProtection(role):undefined;
    let sending=Promise.resolve(),receiving=Promise.resolve();
    const opened = new Promise((yes,no) => { resolve=yes; reject=no; });
    void opened.catch(()=>{});
    const stop = () => {
      if (ended) return; ended=true; clearTimeout(timer); reject(Error('Enrollment carriage ended'));
      protection?.close(); close(); onClose();
    };
    peerClose = stop;
    const timer = setTimeout(stop,60000);
    const current = () => { if (closed || ended) throw Error('Enrollment carriage ended'); };
    const description = (value,type) => {
      if (!fields(value,protection?['profile','type','nonce','publicKey']:['profile','type','nonce']) || value.profile !== PROFILE || value.type !== type
          || typeof value.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(value.nonce)) throw Error('Invalid enrollment contribution');
      if(protection && (typeof value.publicKey!=='string' || !/^04[0-9a-f]{128}$/.test(value.publicKey)))throw Error('Invalid recovery public key');
      return {profile:PROFILE,type,nonce:value.nonce,...(protection?{publicKey:value.publicKey}:{})};
    };
    const contribution = async type => ({profile:PROFILE,type,
      nonce:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),...(protection?{publicKey:await protection.publicKey()}:{})});
    const transcript = async () => {
      current(); if (!local || !remote) throw Error('Enrollment transcript unavailable');
      const pair=role==='offer'?[local,remote]:[remote,local];
      const result=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(PROFILE+'\0'+JSON.stringify(pair))));
      current(); return result;
    };
    peerListener = text => {
      current(); if (!local || !remote) throw Error('Enrollment carriage not ready');
      if(protection)receiving=receiving.then(async()=>{await opened;current();const clear=await protection.open(text);current();onMessage(clear);}).catch(stop);
      else onMessage(text);
    };
    return Object.freeze({
      async offer() {
        current(); if (role !== 'offer' || offered) throw Error('Enrollment offer unavailable');
        offered=true;
        try {local=await contribution('offer'); current(); return {...local};}
        catch(error){stop();throw error;}
      },
      async accept(value) {
        current();
        try {
          if (remote || (role === 'offer' && !local)) throw Error('Enrollment answer unavailable');
          remote=description(value,role==='offer'?'answer':'offer');
          if (role==='answer') local=await contribution('answer');
          if(protection)await protection.bind(remote.publicKey,await transcript());
          current();
          resolve(); return role==='answer'?{...local}:null;
        } catch(error) { stop(); throw error; }
      },
      opened:()=>opened,
      send(text) {
        current();
        if (!local || !remote || typeof text !== 'string' || encoder.encode(text).length>16384) throw Error('Enrollment send unavailable');
        // Existing link sends synchronously; completion/failure remains owned by
        // this carriage. The bounded invitation channel preserves message order.
        try {
          if(protection)sending=sending.then(async()=>{
            const body=await protection.protect(text);current();await channel.send(JSON.stringify({profile:PROFILE,body}));
          }).catch(stop);
          else void Promise.resolve(channel.send(JSON.stringify({profile:PROFILE,body:text}))).catch(stop);
        }
        catch(error) { stop(); throw error; }
      },
      transcript,
      close:stop,
    });
  };
  return Object.freeze({createPeerLink,close,
    signalling:Object.freeze({send:text=>{if(closed)throw Error('Connection ended');return channel.send(text);},close,
      subscribe(fn) {if(closed||signallingListener)throw Error('Connection receiver unavailable');signallingListener=fn;
        return ()=>{if(signallingListener===fn)signallingListener=undefined;};}}),
  });
}
