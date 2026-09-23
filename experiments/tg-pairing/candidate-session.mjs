// Owns candidate key custody for one confirmed experimental peer session.
// This still does not authorize membership installation or AT credentials.
import {enrollmentPayloads} from './enrollment-payloads.mjs';

export async function createCandidateEnrollment({wasm, invitation, epoch, session}) {
  let key, cancellation;
  const closeKey = () => {
    const held = key; key = undefined;
    if (held) { try { held.close(); } finally { held.free(); } }
  };
  const dispose = () => {
    closeKey(); session.signal.removeEventListener('abort', closeKey);
    if (!cancellation) { cancellation = session.cancel(); void cancellation.catch(() => {}); }
    return cancellation;
  };
  const current = () => {
    if (session.signal.aborted || session.state() !== 'comparison-confirmed') throw new Error('Candidate enrollment ended');
  };
  session.signal.addEventListener('abort', closeKey, {once: true});
  try {
    current();
    const payloads = enrollmentPayloads({wasm, invitation, epoch, role: 'candidate', session});
    key = await wasm.BrowserCandidateKey.generate();
    current();
    const guarded = async action => {
      try { current(); const value = await action(); current(); return value; }
      catch (error) { await dispose(); throw error; }
    };
    return Object.freeze({
      sendClaim: () => guarded(() => payloads.sendClaim(key.public_key())),
      bundle: () => guarded(() => payloads.bundle()),
      dispose,
    });
  } catch (error) { await dispose(); throw error; }
}
