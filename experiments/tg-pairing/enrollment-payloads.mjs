// Along application profile over the experimental R2 session. Not an admission
// authority: the core ceremony, current membership and custody must still gate
// installation and issuance. The asset host serves R2 helpers alongside this file.
import {encodeClaim, decodeClaim, encodeBundle, decodeBundle} from './enrollment-profile.mjs';
import {verifyInstallationReceipt} from './installation-receipt.mjs';

export function enrollmentPayloads({wasm, invitation, role, epoch, session}) {
  if (!['candidate', 'provisioner'].includes(role)) throw new TypeError('Invalid payload role');
  const expected = structuredClone(invitation);
  let claim, claimed = false, bundled = false, retained, issuedCertificate, receiptStarted = false;
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
      issuedCertificate = fields.certificate.slice();
      try { await session.sendBundle(bytes); } finally { bytes.fill(0); }
    }),
    acknowledgeInstalled: () => guarded(async () => {
      if (role !== 'provisioner' || !issuedCertificate || receiptStarted) throw new Error('Receipt unavailable');
      receiptStarted = true;
      const received = await session.installed(); current();
      const subject = decodeClaim(wasm, expected, claim);
      if (!await verifyInstallationReceipt(wasm, expected, subject, issuedCertificate, received)) throw new Error('Installation receipt differs');
      current();
      const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      await session.recordPeerInstallation([{scope: 'enrollment-installations',
        key: hex(expected.group) + ':' + hex(expected.code), expectedRevision: 0,
        value: {format: 1, subject, certificate: issuedCertificate, receipt: received}}]);
      current(); await session.sendAcknowledged(received);
      // Acknowledgment sent is not evidence that the candidate received it.
      return Object.freeze({status: 'acknowledgment-sent'});
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
