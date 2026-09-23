// Along application profile over the experimental R2 session. Not an admission
// authority: the core ceremony, current membership and custody must still gate
// installation and issuance. The asset host serves R2 helpers alongside this file.
import {encodeClaim, decodeClaim, encodeBundle, decodeBundle} from './enrollment-profile.mjs';

export function enrollmentPayloads({wasm, invitation, role, epoch, session}) {
  if (!['candidate', 'provisioner'].includes(role)) throw new TypeError('Invalid payload role');
  const expected = structuredClone(invitation);
  let claim, claimed = false, bundled = false, retained;
  const current = () => {
    if (session.signal.aborted || session.state() !== 'comparison-confirmed') throw new Error('Enrollment is no longer confirmed');
  };
  const clear = () => { retained?.destroy(); retained = undefined; claim?.fill(0); };
  session.signal.addEventListener('abort', clear, {once: true});
  if (session.signal.aborted) clear();
  const guarded = async action => {
    try { current(); const result = await action(); current(); return result; }
    catch (error) { clear(); await session.cancel(); throw error; }
  };
  return Object.freeze({
    sendClaim: subject => guarded(async () => {
      if (role !== 'candidate' || claimed) throw new Error('Claim unavailable');
      claimed = true; claim = encodeClaim(wasm, expected, subject);
      await session.sendClaim(claim);
    }),
    claim: () => guarded(async () => {
      if (role !== 'provisioner' || claimed) throw new Error('Claim unavailable');
      claimed = true; const received = await session.claim();
      try {
        current(); const subject = decodeClaim(wasm, expected, received);
        claim = received.slice(); return subject;
      } finally { received.fill(0); }
    }),
    sendBundle: fields => guarded(async () => {
      if (role !== 'provisioner' || !claim || bundled || fields.epoch !== epoch) throw new Error('Bundle unavailable');
      bundled = true; const bytes = encodeBundle(wasm, expected, claim, fields);
      try { await session.sendBundle(bytes); } finally { bytes.fill(0); }
    }),
    bundle: () => guarded(async () => {
      if (role !== 'candidate' || !claim || bundled) throw new Error('Bundle unavailable');
      bundled = true; const bytes = await session.bundle();
      try {
        current(); retained = decodeBundle(wasm, expected, claim, epoch, bytes);
        return retained;
      } finally { bytes.fill(0); }
    }),
  });
}
