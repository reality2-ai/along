// Real browser Web Crypto -> compiled Rust/WASM certificate interoperability.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR to the wasm-pack web output directory');
const sources = new Map(await Promise.all(['storage.mjs', 'identity.mjs', 'certificate.mjs', 'membership.mjs', 'challenge.mjs', 'session-statement.mjs', 'invitation.mjs', 'enrollment-exchange.mjs', 'enrollment-protection.mjs'].map(async name => ['/' + name, await readFile(new URL('./' + name, import.meta.url))])));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) {
    res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'});
    res.end(sources.get(req.url));
  } else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Certificate interoperability test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {certificateCodec} = await import('./certificate.mjs');
    const {openBrowserStorage} = await import('./storage.mjs');
    const {provisionDeviceIdentity} = await import('./identity.mjs');
    const {establishMembership, openMembership} = await import('./membership.mjs');
    const {issuePeerChallenge} = await import('./challenge.mjs');
    const codec = certificateCodec(wasm), store = await openBrowserStorage('certificate-test');
    const member = await provisionDeviceIdentity(store);
    const subject = Uint8Array.from(member.publicId.match(/../g), b => parseInt(b, 16));
    // Synthetic group authority, volatile only, never a real group's key.
    const authority = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const group = new Uint8Array(await crypto.subtle.exportKey('raw', authority.publicKey));
    const epoch = 0xffffffffffffffffn;
    const message = codec.signingBytes(subject, group, epoch);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, message));
    const certificate = codec.encode(subject, group, epoch, signature);
    const accepted = codec.authentic(certificate, subject, group);
    const independentlyVerified = await crypto.subtle.verify('Ed25519', authority.publicKey, certificate.slice(72), certificate.slice(0, 72));
    const wrongSubject = subject.slice(); wrongSubject[0] ^= 1;
    const wrongGroup = group.slice(); wrongGroup[0] ^= 1;
    const forged = certificate.slice(); forged[72] ^= 1;
    let wrongEpoch = false, boundsRefused = 0;
    try { codec.encode(subject, group, 0n, signature); } catch { wrongEpoch = true; }
    for (const invalid of [-1n, 0x10000000000000000n, 1, NaN]) {
      try { codec.signingBytes(subject, group, invalid); } catch { boundsRefused++; }
    }
    await store.compareAndSwap('certificates', 'synthetic', 0, certificate);
    const restored = (await store.read('certificates', 'synthetic')).value;
    const restoredValid = codec.authentic(restored, subject, group);
    const membership = await establishMembership(store, wasm, {group, subject, current: epoch, depth: 0n, certificate});
    const beforeRevocation = await membership.status();
    const {invitationStatement, issueInvitationChallenge} = await import('./invitation.mjs');
    const invitation = {group, issuer: subject, role: 'member', code: crypto.getRandomValues(new Uint8Array(16)), validity: epoch};
    const {createEnrollmentExchange} = await import('./enrollment-exchange.mjs');
    const exchangeTranscript = crypto.getRandomValues(new Uint8Array(32));
    const candidate = await createEnrollmentExchange(wasm, invitation, 'candidate', exchangeTranscript);
    const provisioner = await createEnrollmentExchange(wasm, invitation, 'provisioner', exchangeTranscript);
    const commitment = await candidate.commit();
    const contribution = provisioner.acceptCommit(commitment);
    const reveal = await candidate.reveal(contribution);
    await provisioner.acceptReveal(reveal);
    const comparison = candidate.verificationString();
    const exchangeMatches = comparison.length === 4 && comparison.every((byte, index) => byte === provisioner.verificationString()[index]);
    let replayRevealRefused = false;
    try { await provisioner.acceptReveal(reveal); } catch { replayRevealRefused = true; }
    candidate.close(); provisioner.close();
    let badExchanges = 0;
    for (const fault of ['early', 'commitment', 'degenerate', 'invitation', 'channel']) {
      const c = await createEnrollmentExchange(wasm, invitation, 'candidate', exchangeTranscript);
      const otherCode = invitation.code.slice(); otherCode[0] ^= 1;
      const p = await createEnrollmentExchange(wasm, fault === 'invitation' ? {...invitation, code: otherCode} : invitation, 'provisioner', fault === 'channel' ? new Uint8Array(32) : exchangeTranscript);
      try {
        if (fault === 'early') { await c.reveal(new Uint8Array(32)); continue; }
        const commit = await c.commit();
        const pub = p.acceptCommit(commit);
        const value = await c.reveal(fault === 'degenerate' ? new Uint8Array(32) : pub);
        if (fault === 'commitment') value.salt[0] ^= 1;
        await p.acceptReveal(value);
      } catch { badExchanges++; } finally { c.close(); p.close(); }
    }
    const invitationBytes = invitationStatement(wasm, invitation);
    const browserInvitation = issueInvitationChallenge(membership, wasm, invitation);
    const browserInvitationProof = await member.sign(wasm.tg_nonce_signing_bytes(browserInvitation.statement(), browserInvitation.nonce()));
    const forgedBrowserInvitation = await browserInvitation.verify(certificate, new Uint8Array(64));
    forgedBrowserInvitation?.free();
    const browserInvitations = await Promise.all([
      browserInvitation.verify(certificate, browserInvitationProof), browserInvitation.verify(certificate, browserInvitationProof),
    ]);
    const browserInvitationWinners = browserInvitations.filter(Boolean).length;
    browserInvitations.forEach(result => result?.free());
    const browserInvitationReplay = await browserInvitation.verify(certificate, browserInvitationProof);
    browserInvitationReplay?.free();
    const expiringInvitation = issueInvitationChallenge(membership, wasm, invitation);
    const expiringInvitationProof = await member.sign(wasm.tg_nonce_signing_bytes(expiringInvitation.statement(), expiringInvitation.nonce()));
    const invitationNow = performance.now.bind(performance);
    let expiredInvitation;
    try {
      performance.now = () => invitationNow() + 60001;
      expiredInvitation = await expiringInvitation.verify(certificate, expiringInvitationProof);
    } finally { delete performance.now; expiringInvitation.cancel(); }
    expiredInvitation?.free();
    const revokingInvitation = issueInvitationChallenge(membership, wasm, invitation);
    const revokingInvitationProof = await member.sign(wasm.tg_nonce_signing_bytes(revokingInvitation.statement(), revokingInvitation.nonce()));

    const invitationChallenge = issuePeerChallenge(membership, subject, invitationBytes);
    let alteredInvitations = 0;
    for (const field of ['group', 'issuer', 'role', 'code', 'validity']) {
      const altered = {...invitation};
      if (field === 'role') altered.role = 'key-holder';
      else if (field === 'validity') altered.validity = epoch - 1n;
      else { altered[field] = invitation[field].slice(); altered[field][0] ^= 1; }
      const proof = await member.sign(wasm.tg_nonce_signing_bytes(invitationStatement(wasm, altered), invitationChallenge.nonce()));
      if (!await invitationChallenge.verify(certificate, proof)) alteredInvitations++;
    }
    const invitationProof = await member.sign(wasm.tg_nonce_signing_bytes(invitationBytes, invitationChallenge.nonce()));
    const invitationAccepted = await invitationChallenge.verify(certificate, invitationProof);
    const invitationState = wasm.BrowserMembership.establish(group, epoch, 0n);
    const authorizationNonce = crypto.getRandomValues(new Uint8Array(16));
    const authorizationProof = await member.sign(wasm.tg_nonce_signing_bytes(invitationBytes, authorizationNonce));
    const authorized = invitationState.authorise_invitation(invitationBytes, certificate, authorizationNonce, authorizationProof);
    const authorizedStatement = Boolean(authorized) && authorized.statement().every((b, i) => b === invitationBytes[i]);
    authorized?.free();
    // This signature is cryptographically valid and covers exactly the offered
    // invitation, but belongs to a member other than the named issuer.
    const otherIssuer = subject.slice(); otherIssuer[0] ^= 1;
    const substitutedIssuer = invitationStatement(wasm, {...invitation, issuer: otherIssuer});
    const substitutedProof = await member.sign(wasm.tg_nonce_signing_bytes(substitutedIssuer, authorizationNonce));
    const wrongIssuerGrant = invitationState.authorise_invitation(substitutedIssuer, certificate, authorizationNonce, substitutedProof);
    const wrongIssuerRefused = !wrongIssuerGrant; wrongIssuerGrant?.free();
    const shortGrant = invitationState.authorise_invitation(invitationBytes.slice(1), certificate, authorizationNonce, authorizationProof);
    const shortInvitationRefused = !shortGrant; shortGrant?.free();
    const anotherNonce = authorizationNonce.slice(); anotherNonce[0] ^= 1;
    const nonceGrant = invitationState.authorise_invitation(invitationBytes, certificate, anotherNonce, authorizationProof);
    const invitationNonceRefused = !nonceGrant; nonceGrant?.free();
    const revokeProof = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, wasm.tg_revocation_signing_bytes(subject, epoch, 1n, 0)));
    if (!invitationState.apply_revocation(subject, epoch, 1n, 0, revokeProof)) throw new Error('Synthetic revocation failed');
    const revokedGrant = invitationState.authorise_invitation(invitationBytes, certificate, authorizationNonce, authorizationProof);
    const revokedInvitationRefused = !revokedGrant; revokedGrant?.free(); invitationState.free();
    let invalidInvitations = 0;
    for (const fields of [{validity: -1n}, {validity: 0x10000000000000000n}, {validity: 1},
      {role: 1}, {role: 'admin'}, {code: new Uint8Array(15)}]) {
      try { invitationStatement(wasm, {...invitation, ...fields}); } catch { invalidInvitations++; }
    }

    const {sessionStatement} = await import('./session-statement.mjs');
    const verifier = subject.slice(); verifier[0] ^= 1;
    const binding = {group, epoch, verifier, prover: subject, transcript: crypto.getRandomValues(new Uint8Array(32))};
    const statement = sessionStatement(binding);
    const boundChallenge = issuePeerChallenge(membership, subject, statement);
    let bindingRefusals = 0;
    for (const field of ['group', 'verifier', 'prover', 'transcript', 'epoch', 'roles']) {
      const changed = {...binding};
      if (field === 'epoch') changed.epoch = epoch - 1n;
      else if (field === 'roles') { changed.verifier = subject; changed.prover = verifier; }
      else { changed[field] = binding[field].slice(); changed[field][31] ^= 2; }
      const changedProof = await member.sign(wasm.tg_nonce_signing_bytes(sessionStatement(changed), boundChallenge.nonce()));
      if (!await boundChallenge.verify(certificate, changedProof)) bindingRefusals++;
    }
    const boundProof = await member.sign(wasm.tg_nonce_signing_bytes(statement, boundChallenge.nonce()));
    const boundAccepted = await boundChallenge.verify(certificate, boundProof);
    let invalidBindings = 0;
    for (const changed of [{epoch: -1n}, {epoch: 0x10000000000000000n}, {epoch: 1},
      {transcript: new Uint8Array(31)}, {verifier: subject}, {group: [...group]}]) {
      try { sessionStatement({...binding, ...changed}); } catch { invalidBindings++; }
    }
    const challenge = issuePeerChallenge(membership, subject, statement);
    const proof = await member.sign(wasm.tg_nonce_signing_bytes(challenge.statement(), challenge.nonce()));
    const invalidProof = await challenge.verify(certificate, new Uint8Array(64));
    const concurrentProofs = await Promise.all([challenge.verify(certificate, proof), challenge.verify(certificate, proof)]);
    const replay = await challenge.verify(certificate, proof);
    const otherChallenge = issuePeerChallenge(membership, subject, statement);
    const wrongNonce = await otherChallenge.verify(certificate, proof); otherChallenge.cancel();
    const expires = issuePeerChallenge(membership, subject, statement);
    const expiringProof = await member.sign(wasm.tg_nonce_signing_bytes(expires.statement(), expires.nonce()));
    const realNow = performance.now.bind(performance);
    performance.now = () => realNow() + 60001;
    const expired = await expires.verify(certificate, expiringProof);
    delete performance.now; expires.cancel();
    const revokedChallenge = issuePeerChallenge(membership, subject, statement);
    const revokedProof = await member.sign(wasm.tg_nonce_signing_bytes(revokedChallenge.statement(), revokedChallenge.nonce()));
    const revocationMessage = wasm.tg_revocation_signing_bytes(subject, epoch, 1n, 0);
    const revocationSignature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, revocationMessage));
    const revocation = {subject, epoch, sequence: 1n, reason: 0, signature: revocationSignature};
    let forgeryRefused = false;
    try { await membership.applyRevocation({...revocation, reason: 1}); } catch { forgeryRefused = true; }
    const afterForgery = await membership.status();
    await membership.applyRevocation(revocation);
    const afterRevocation = await membership.status();
    const revokedBrowserInvitation = await revokingInvitation.verify(certificate, revokingInvitationProof);
    revokedBrowserInvitation?.free(); revokingInvitation.cancel();

    const afterRevocationProof = await revokedChallenge.verify(certificate, revokedProof); revokedChallenge.cancel();
    const reopened = openMembership(store, wasm, group, subject);
    const afterReopen = await reopened.status();
    await reopened.applyRevocation(revocation);
    const dedupCount = (await store.read('membership', Array.from(group, b => b.toString(16).padStart(2, '0')).join(''))).value.revocations.length;
    let resetRefused = false;
    try { await establishMembership(store, wasm, {group, subject, current: epoch, depth: 0n, certificate}); } catch { resetRefused = true; }
    const anotherSubject = subject.slice(); anotherSubject[0] ^= 1;
    const anotherMessage = wasm.tg_revocation_signing_bytes(anotherSubject, epoch, 2n, 0);
    const anotherSignature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, anotherMessage));
    const put = IDBObjectStore.prototype.put;
    let failedWrite;
    try {
      IDBObjectStore.prototype.put = function() { throw new DOMException('synthetic', 'QuotaExceededError'); };
      try { await membership.applyRevocation({subject: anotherSubject, epoch, sequence: 2n, reason: 0, signature: anotherSignature}); }
      catch (e) { failedWrite = e.code; }
    } finally { IDBObjectStore.prototype.put = put; }
    const uncertainStatus = await membership.status();
    store.close();
    return {accepted, independentlyVerified, length: certificate.length, restoredValid,
      wrongSubject: codec.authentic(certificate, wrongSubject, group),
      wrongGroup: codec.authentic(certificate, subject, wrongGroup),
      forged: codec.authentic(forged, subject, group),
      truncated: codec.authentic(certificate.slice(1), subject, group),
      trailing: codec.authentic(new Uint8Array([...certificate, 0]), subject, group),
      wrongEpoch, boundsRefused, beforeRevocation, forgeryRefused, afterForgery, afterRevocation, afterReopen, dedupCount, resetRefused,
      exchangeMatches, replayRevealRefused, badExchanges, browserInvitationWinners, invitationLifecycleRefused: [forgedBrowserInvitation, browserInvitationReplay, expiredInvitation, revokedBrowserInvitation].every(result => !result), authorizedStatement, wrongIssuerRefused, shortInvitationRefused, invitationNonceRefused, revokedInvitationRefused, alteredInvitations, invitationAccepted, invalidInvitations, bindingRefusals, boundAccepted, invalidBindings, failedWrite, uncertainStatus, invalidProof, successfulProofs: concurrentProofs.filter(Boolean).length,
      replay, wrongNonce, expired, afterRevocationProof, expectedGroup: [...group], expectedSubject: [...subject]};
  });
  const {expectedGroup, expectedSubject, ...checks} = result;
  assert.deepEqual(checks, {accepted: true, independentlyVerified: true, length: 136, restoredValid: true,
    wrongSubject: false, wrongGroup: false, forged: false, truncated: false, trailing: false, wrongEpoch: true, boundsRefused: 4,
    beforeRevocation: 'current', forgeryRefused: true, afterForgery: 'current', afterRevocation: 'revoked', afterReopen: 'revoked', dedupCount: 1, resetRefused: true,
    exchangeMatches: true, replayRevealRefused: true, badExchanges: 5, browserInvitationWinners: 1, invitationLifecycleRefused: true, authorizedStatement: true, wrongIssuerRefused: true, shortInvitationRefused: true, invitationNonceRefused: true, revokedInvitationRefused: true, alteredInvitations: 5, invitationAccepted: true, invalidInvitations: 6, bindingRefusals: 6, boundAccepted: true, invalidBindings: 6, failedWrite: 'full', uncertainStatus: 'unavailable', invalidProof: false, successfulProofs: 1,
    replay: false, wrongNonce: false, expired: false, afterRevocationProof: false});
  await page.reload();
  const afterReload = await page.evaluate(async ({expectedGroup, expectedSubject}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {openMembership} = await import('./membership.mjs');
    const store = await openBrowserStorage('certificate-test');
    const membership = openMembership(store, wasm, new Uint8Array(expectedGroup), new Uint8Array(expectedSubject));
    const status = await membership.status(); store.close(); return status;
  }, {expectedGroup, expectedSubject});
  assert.equal(afterReload, 'revoked');
  const crossTab = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js');
    const {certificateCodec} = await import('./certificate.mjs');
    const {openBrowserStorage, BrowserStorageError} = await import('./storage.mjs');
    const {establishMembership, openMembership} = await import('./membership.mjs');
    const codec = certificateCodec(wasm), store = await openBrowserStorage('cross-tab');
    const signer = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const group = new Uint8Array(await crypto.subtle.exportKey('raw', signer.publicKey));
    const subject = new Uint8Array(32).fill(23);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', signer.privateKey, codec.signingBytes(subject, group, 1n)));
    const certificate = codec.encode(subject, group, 1n, signature);
    const initial = await establishMembership(store, wasm, {group, subject, current: 1n, depth: 0n, certificate}); initial.close();
    const failing = {...store, compareAndSwap: async () => { throw new BrowserStorageError('full'); }};
    window.crossMembership = openMembership(failing, wasm, group, subject);
    const message = wasm.tg_revocation_signing_bytes(subject, 1n, 1n, 0);
    const revocationSignature = new Uint8Array(await crypto.subtle.sign('Ed25519', signer.privateKey, message));
    window.testRevocation = {subject, epoch: 1n, sequence: 1n, reason: 0, signature: revocationSignature};
    return {group: [...group], subject: [...subject]};
  });
  const other = await page.context().newPage(); await other.goto(page.url());
  await other.evaluate(async ({group, subject}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {openMembership} = await import('./membership.mjs');
    const store = await openBrowserStorage('cross-tab');
    window.crossMembership = openMembership(store, wasm, new Uint8Array(group), new Uint8Array(subject));
    window.invalidations = 0;
    window.crossMembership.subscribe(() => { window.invalidations++; });
  }, crossTab);
  assert.equal(await other.evaluate(() => window.crossMembership.status()), 'current');
  const sourceFailure = await page.evaluate(async () => {
    let failure;
    try { await window.crossMembership.applyRevocation(window.testRevocation); } catch (e) { failure = e.code; }
    return {failure, status: await window.crossMembership.status()};
  });
  assert.deepEqual(sourceFailure, {failure: 'full', status: 'unavailable'});
  await other.waitForFunction(async () => window.invalidations > 0 && await window.crossMembership.status() === 'revoked');
  const closed = await other.evaluate(async () => { window.crossMembership.close(); return window.crossMembership.status(); });
  assert.equal(closed, 'unavailable');
  await other.close();
  console.log('PASS: stored browser identity, Web Crypto group signature, compiled r2-trust certificate codec, and IndexedDB certificate roundtrip interoperate; forged/wrong-context certificates and epoch wrapping are refused.');
  console.log('PASS: verified revocations persist, forged entries leave membership unchanged, duplicate subjects do not grow the set, and reestablishment cannot clear revocation.');
  console.log('PASS: revocation survives page reload; failed revocation storage makes the active handle unavailable rather than reporting a committed decision.');
  console.log('PASS: another tab verifies and persists a signed revocation even when the originating tab cannot save it; subscribers invalidate and closed handles stay unavailable.');
  console.log('PASS: real X25519 commit-before-reveal produces matching core comparison strings; premature reveal, altered commitment, degenerate contribution, substituted invitation and replay refuse.');
  console.log('PASS: browser invitation authorization admits one concurrent proof, permits retry after forgery, and rejects replay, expiry and learned revocation.');
  console.log('PASS: core invitation authorization accepts the named issuer and refuses a valid signature from a different member, wrong nonce, malformed statement and revoked issuer.');
  console.log('PASS: canonical invitation evidence binds group, issuer, role, code and validity; modified fields refuse and out-of-range browser inputs cannot wrap into valid fields.');
  console.log('PASS: actual L5 verification rejects proofs for another group, epoch, participant, participant order or channel transcript, while accepting the intended session binding.');
  console.log('PASS: actual L5 nonce evidence accepts one concurrent response, permits retry after forgery, and rejects replay, another challenge, expiry and learned revocation.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
