// Along application transport prototype, not a declared Reality2 TN bearer.
// No signalling service, STUN, TURN, media capture or credential handling.
const encoder = new TextEncoder();
const MAX_MESSAGE = 16384;
export function createPeerLink({role, onMessage, onClose = () => {}}) {
  if (!['offer', 'answer'].includes(role) || typeof onMessage !== 'function') throw new TypeError('Invalid peer link');
  const pc = new RTCPeerConnection({iceServers: []});
  const channel = pc.createDataChannel('along-peer', {negotiated: true, id: 0, ordered: true, protocol: 'along-peer-v1'});
  let closed = false, local = null, remote = null, negotiating = false;
  const close = () => {
    if (closed) return;
    closed = true; channel.close(); pc.close();
    try { onClose(); } catch {}
  };
  channel.onclose = close; channel.onerror = close;
  pc.ondatachannel = event => { event.channel.close(); close(); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) close(); };
  channel.onmessage = event => {
    if (closed) return;
    if (typeof event.data !== 'string' || encoder.encode(event.data).length > MAX_MESSAGE) { close(); return; }
    try { onMessage(event.data); } catch { close(); }
  };
  const wait = (target, event, ready, timeout = 15000) => new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); target.removeEventListener(event, check); channel.removeEventListener('close', check); error ? reject(error) : resolve(); };
    const check = () => { if (closed) finish(new Error('Peer link closed')); else if (ready()) finish(); };
    const timer = setTimeout(() => { finish(new Error('Peer link timed out')); close(); }, timeout);
    target.addEventListener(event, check); channel.addEventListener('close', check); check();
  });
  const description = (value, type) => {
    if (!value || value.type !== type || typeof value.sdp !== 'string' || encoder.encode(value.sdp).length > 65536) throw new Error('Invalid peer description');
    const media = value.sdp.split(/\r?\n/).filter(line => line.startsWith('m='));
    if (media.length !== 1 || !media[0].startsWith('m=application ')) throw new Error('Only a data channel is permitted');
    return {type, sdp: value.sdp};
  };
  const gather = async value => {
    await pc.setLocalDescription(value);
    await wait(pc, 'icegatheringstatechange', () => pc.iceGatheringState === 'complete');
    local = description(pc.localDescription, role);
    return {...local};
  };
  return Object.freeze({
    offer: async () => {
      if (role !== 'offer' || local || negotiating || closed) throw new Error('Peer link state');
      negotiating = true;
      try { return await gather(await pc.createOffer()); } catch (e) { close(); throw e; }
      finally { negotiating = false; }
    },
    accept: async value => {
      if (remote || negotiating || closed || (role === 'offer' && !local)) throw new Error('Peer link state');
      const incoming = description(value, role === 'offer' ? 'answer' : 'offer');
      negotiating = true;
      try {
        await pc.setRemoteDescription(incoming); remote = incoming;
        return role === 'answer' ? await gather(await pc.createAnswer()) : null;
      } catch (e) { close(); throw e; } finally { negotiating = false; }
    },
    opened: () => wait(channel, 'open', () => channel.readyState === 'open'),
    send: text => {
      if (closed || channel.readyState !== 'open' || typeof text !== 'string' || encoder.encode(text).length > MAX_MESSAGE
          || channel.bufferedAmount + encoder.encode(text).length > 65536) throw new Error('Peer link cannot send');
      channel.send(text);
    },
    transcript: async () => {
      if (closed || !local || !remote || channel.readyState !== 'open') throw new Error('Peer link is not established');
      const pair = role === 'offer' ? [local, remote] : [remote, local];
      return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('along-peer-transcript-v1\0' + JSON.stringify(pair))));
    },
    close,
  });
}
