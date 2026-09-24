import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR to the compiled hive-wasm package');
const sources = new Map(await Promise.all(['hive_wasm.js', 'hive_wasm_bg.wasm'].map(async name => ['/' + name, await readFile(join(process.env.R2_WASM_DIR, name))])));
for (const name of ['enrollment-exchange.mjs', 'enrollment-protection.mjs', 'invitation.mjs', 'storage.mjs', 'invitation-journal.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); res.end(sources.get(req.url)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Core ceremony bridge test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {createEnrollmentExchange} = await import('./enrollment-exchange.mjs');
    const check = (value, why) => { if (!value) throw new Error(why); };
    const refuses = async (action, reason) => {
      try { await action(); } catch (error) {
        if (reason) check(String(error).includes(reason), `Expected ${reason}, got ${error}`);
        return;
      }
      throw new Error(`Expected refusal: ${reason || 'operation'}`);
    };
    // Synthetic bootstrap only. These native keys are fixture issuers, not a
    // implemented group custodian or evidence of an initially trusted group.
    const groupPair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const issuerPair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const group = new Uint8Array(await crypto.subtle.exportKey('raw', groupPair.publicKey));
    const issuer = new Uint8Array(await crypto.subtle.exportKey('raw', issuerPair.publicKey));
    const certificate = async (subject, authority = groupPair, namedGroup = group) => {
      const message = wasm.tg_certificate_signing_bytes(subject, namedGroup, 7n);
      const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, message));
      return wasm.tg_certificate_encode(subject, namedGroup, 7n, signature);
    };
    const issuerCertificate = await certificate(issuer);
    const membership = wasm.BrowserMembership.establish(group, 7n, 0n);
    const authorised = async (role = 1) => {
      const invitation = {group, issuer, role: role === 1 ? 'member' : 'key-holder', code: crypto.getRandomValues(new Uint8Array(16)), validity: 8n};
      const statement = wasm.tg_invitation_statement(group, issuer, role, invitation.code, invitation.validity);
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const message = wasm.tg_nonce_signing_bytes(statement, nonce);
      const proof = new Uint8Array(await crypto.subtle.sign('Ed25519', issuerPair.privateKey, message));
      const token = membership.authorise_invitation(statement, issuerCertificate, nonce, proof);
      check(token, 'actual core invitation authorization');
      return {token, invitation};
    };
    const begin = async () => {
      const {token, invitation} = await authorised();
      const ceremony = wasm.BrowserCandidateCeremony.discover(token, 'open', false, false, true, 7n);
      await refuses(() => token.statement()); // consumed binding, not a reusable authorization handle
      return {ceremony, invitation};
    };
    const exchange = async (ceremony, invitation, matched = true) => {
      const transcript = crypto.getRandomValues(new Uint8Array(32));
      const candidate = await createEnrollmentExchange(wasm, invitation, 'candidate', transcript);
      const provisioner = await createEnrollmentExchange(wasm, invitation, 'provisioner', transcript);
      try {
        const commit = await candidate.commit(); ceremony.candidate_commits(commit);
        const contribution = provisioner.acceptCommit(commit);
        const reveal = await candidate.reveal(contribution);
        await provisioner.acceptReveal(reveal);
        ceremony.exchanged(contribution, reveal.publicKey);
        check(candidate.verificationString().every((v, i) => v === provisioner.verificationString()[i]), 'actual exchange comparison');
        // Explicit synthetic person decision: crypto agreement alone is not consent.
        ceremony.confirm(matched);
      } finally { candidate.close(); provisioner.close(); }
    };
    const requested = async () => {
      const state = await begin(); await exchange(state.ceremony, state.invitation);
      const key = await wasm.BrowserCandidateKey.generate();
      state.publicKey = state.ceremony.request(key, 'open');
      await refuses(() => key.public_key()); // key custody transferred into the ceremony
      return state;
    };
    {
      const {ceremony, publicKey, invitation} = await requested();
      const prepared = ceremony.prepare_install(await certificate(publicKey), 'open');
      check(prepared.member().every((v, i) => v === publicKey[i]), 'prepared member is actual requested candidate');
      check(prepared.group().every((v, i) => v === group[i]), 'prepared group is authorized invitation group');
      const record = prepared.into_browser_record();
      await refuses(() => prepared.member());
      check(record.privateKey instanceof CryptoKey && !record.privateKey.extractable, 'browser record retains nonextractable custody');
      check(record.custody === 'browser-nonextractable-unqualified', 'no invented hardware qualification');
      await refuses(() => crypto.subtle.exportKey('pkcs8', record.privateKey));
      const {openBrowserStorage} = await import('./storage.mjs');
      const {reserveInvitation} = await import('./invitation-journal.mjs');
      const store = await openBrowserStorage('prepared-persona-test');
      await store.compareAndSwap('persona', 'active', 0, {claim: 'open'});
      const reservation = await reserveInvitation(store, group, invitation.code);
      const receipt = await reservation.consumeWith([
        {scope: 'persona', key: 'active', expectedRevision: 1, value: {claim: 'owner', record}},
      ]);
      check(receipt.state === 'consumed' && receipt.revisions[0] === 2, 'atomic receipt names installed record');
      store.close();
      await refuses(async () => ceremony.prepare_install(await certificate(publicKey), 'open'));
      ceremony.close(); ceremony.close(); ceremony.free();
    }
    for (const [state, ownDev, peerDev, custody, epoch, role, reason] of [
      ['owner', false, false, true, 7n, 1, 'NotOpen'],
      ['closed', false, false, true, 7n, 1, 'unavailable'],
      ['unrecognised', false, false, true, 7n, 1, 'unavailable'],
      ['open', true, false, true, 7n, 1, 'BuildModeMismatch'],
      ['open', false, false, false, 7n, 1, 'ProvisionerHoldsNoCustody'],
      ['open', false, false, true, 9n, 1, 'InvitationExpired'],
      ['open', false, false, true, 7n, 2, 'unavailable'],
    ]) {
      const {token} = await authorised(role);
      await refuses(() => wasm.BrowserCandidateCeremony.discover(token, state, ownDev, peerDev, custody, epoch), reason);
    }
    for (const failure of ['early-request', 'decline', 'request-owner', 'closed-key', 'short-commit', 'degenerate']) {
      const {ceremony, invitation} = await begin();
      try {
        if (failure === 'short-commit') await refuses(() => ceremony.candidate_commits(new Uint8Array(31)));
        else if (failure === 'degenerate') {
          ceremony.candidate_commits(new Uint8Array(32).fill(2));
          await refuses(() => ceremony.exchanged(new Uint8Array(32), new Uint8Array(32).fill(3)), 'DegenerateContribution');
        } else if (failure === 'decline') await refuses(() => exchange(ceremony, invitation, false), 'Aborted');
        else {
          if (failure !== 'early-request') await exchange(ceremony, invitation);
          const key = await wasm.BrowserCandidateKey.generate();
          if (failure === 'closed-key') key.close();
          await refuses(() => ceremony.request(key, failure === 'request-owner' ? 'owner' : 'open'));
        }
        await refuses(() => ceremony.confirm(true), 'unavailable');
      } finally { ceremony.close(); ceremony.free(); }
    }
    for (const failure of ['subject', 'group', 'forged', 'owner', 'closed', 'unknown', 'malformed', 'cancelled']) {
      const {ceremony, publicKey} = await requested();
      let bytes = await certificate(failure === 'subject' ? issuer : publicKey);
      if (failure === 'group') bytes = await certificate(publicKey, issuerPair, issuer);
      if (failure === 'forged') bytes[72] ^= 1;
      if (failure === 'malformed') bytes = bytes.slice(1);
      if (failure === 'cancelled') ceremony.close();
      const state = ['owner', 'closed', 'unknown'].includes(failure) ? failure : 'open';
      await refuses(() => ceremony.prepare_install(bytes, state));
      await refuses(() => ceremony.prepare_install(bytes, 'open'), 'unavailable');
      ceremony.close(); ceremony.free();
    }
    membership.free(); return true;
  });
  assert.equal(result, true);
  await page.reload();
  assert.equal(await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await openBrowserStorage('prepared-persona-test');
    const stored = await store.read('persona', 'active');
    if (stored?.revision !== 2 || stored.value.claim !== 'owner') throw new Error('Incomplete persisted persona');
    const {record} = stored.value;
    if (!wasm.tg_certificate_authentic(record.certificate, record.subject, record.group)) throw new Error('Stored certificate mismatch');
    if (!(record.privateKey instanceof CryptoKey) || record.privateKey.extractable) throw new Error('Stored custody lost');
    const publicKey = await crypto.subtle.importKey('raw', record.subject, 'Ed25519', false, ['verify']);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign('Ed25519', record.privateKey, challenge);
    if (!await crypto.subtle.verify('Ed25519', publicKey, signature, challenge)) throw new Error('Restored key does not match requested member');
    store.close(); return true;
  }), true);

  console.log('PASS: core-prepared candidate custody and certificate persist with claim and invitation consumption in one transaction; after document reload, restored nonextractable custody signs for the requested member. Core refusal checks remain passing. Synthetic initial trust/consent; no hardware seal, group-key storage or complete enrollment claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
