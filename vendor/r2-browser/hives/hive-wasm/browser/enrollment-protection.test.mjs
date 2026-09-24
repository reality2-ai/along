// Web Crypto boundary tests using real Chromium and synthetic material only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const source = await readFile(new URL('./enrollment-protection.mjs', import.meta.url));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/module.mjs' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/module.mjs' ? source : '<!doctype html><title>Enrollment protection</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const {createEnrollmentProtection: create} = await import('/module.mjs');
    const check = (value, message) => { if (!value) throw new Error(message); };
    const refused = promise => promise.then(() => false, () => true);
    const fixture = async (change = '', guard = () => {}) => {
      const material = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'HKDF', false, ['deriveKey']);
      const statement = new Uint8Array(89).fill(1), transcript = new Uint8Array(32).fill(2);
      const candidate = await create(material, statement, transcript, 'candidate', guard);
      if (change === 'invitation') statement[0] ^= 1;
      if (change === 'transcript') transcript[0] ^= 1;
      const provisioner = await create(material, statement, transcript, 'provisioner', guard);
      return {candidate, provisioner};
    };
    for (const kind of ['installed', 'acknowledged']) {
      const {candidate, provisioner} = await fixture();
      const sender = kind === 'installed' ? candidate : provisioner;
      const receiver = kind === 'installed' ? provisioner : candidate;
      const packet = await sender.seal(kind, new Uint8Array([9, 8, 7]));
      check((await receiver.open(kind, packet)).join(',') === '9,8,7', 'receipt round trip');
      check(await refused(receiver.open(kind, packet)), 'receipt replay refused');
    }
    for (const kind of ['installed', 'acknowledged']) {
      let pair = await fixture();
      const sender = kind === 'installed' ? pair.candidate : pair.provisioner;
      const wrong = kind === 'installed' ? pair.provisioner : pair.candidate;
      check(await refused(wrong.seal(kind, new Uint8Array([1]))), 'receipt wrong direction');
      pair = await fixture();
      const packet = await pair.candidate.seal('claim', new Uint8Array([1]));
      check(await refused(pair.provisioner.open('installed', packet)), 'claim cannot masquerade as installed receipt');
      pair = await fixture();
      const bundle = await pair.provisioner.seal('bundle', new Uint8Array([1]));
      check(await refused(pair.candidate.open('acknowledged', bundle)), 'bundle cannot masquerade as acknowledgment');
    }
    let pair = await fixture();
    const input = new Uint8Array(2048).fill(7);
    const sending = pair.candidate.seal('claim', input); input.fill(0);
    const packet = await sending;
    check(packet.length === 2076, 'bounded envelope size');
    const plain = await pair.provisioner.open('claim', packet);
    check(plain.length === 2048 && plain.every(b => b === 7), 'input snapshot and boundary round trip');
    check(await refused(pair.provisioner.open('claim', packet)), 'replay refused');

    for (const change of ['invitation', 'transcript']) {
      pair = await fixture(change);
      check(await refused(pair.provisioner.open('claim', await pair.candidate.seal('claim', new Uint8Array([3])))), change + ' substitution');
    }
    pair = await fixture();
    const reflected = await pair.candidate.seal('claim', new Uint8Array([3]));
    check(await refused(pair.candidate.open('bundle', reflected)), 'purpose reflection');
    pair = await fixture();
    check(await refused(pair.candidate.open('claim', new Uint8Array(29))), 'wrong direction');
    pair = await fixture();
    check(await refused(pair.candidate.seal('claim', new Uint8Array(2049))), 'oversized payload');
    pair = await fixture();
    const outcomes = await Promise.allSettled([
      pair.candidate.seal('claim', new Uint8Array([3])),
      pair.candidate.seal('claim', new Uint8Array([4])),
    ]);
    check(outcomes.every(outcome => outcome.status === 'rejected'), 'concurrent reuse invalidates pending seal');
    pair = await fixture();
    const pending = pair.candidate.seal('claim', new Uint8Array([3])); pair.candidate.close();
    check(await refused(pending), 'close during encryption');
    pair = await fixture();
    const sealed = await pair.candidate.seal('claim', new Uint8Array([3]));
    const opening = pair.provisioner.open('claim', sealed); pair.provisioner.close();
    check(await refused(opening), 'close during decryption');
    let expired = false;
    pair = await fixture('', () => { if (expired) throw new Error('Synthetic expiry'); });
    const late = pair.candidate.seal('claim', new Uint8Array([3])); expired = true;
    check(await refused(late), 'lifetime checked after asynchronous crypto');
    return true;
  });
  assert.equal(result, true);
  console.log('PASS: browser AEAD enforces context, direction, purpose, payload bounds, input snapshots, single use and cancellation/expiry across asynchronous crypto. No keys are exported or persisted.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
