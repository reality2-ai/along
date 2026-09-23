import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['delivery-ack.mjs', 'delivery-history.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
sources.set('/storage.mjs', await readFile(join(process.env.R2_BROWSER_DIR, 'storage.mjs')));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><title>Policy storage</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const store = await (await import('./storage.mjs')).openBrowserStorage('delivery-history');
    const {openDeliveryHistory} = await import('./delivery-history.mjs');
    const {signDeliveryAck} = await import('./delivery-ack.mjs');
    const pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const recipient = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), b => b.toString(16).padStart(2, '0')).join('');
    const binding = {group: '11'.repeat(32), owner: '22'.repeat(32), credential: '33'.repeat(16), recipient};
    const history = openDeliveryHistory({store, ...binding});
    const value = {...binding, nonce: '44'.repeat(16), generation: 1n, policyRevision: 2n};
    const sign = async bytes => new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, bytes));
    const check = (v, message) => { if (!v) throw new Error(message); };
    const denied = fn => fn().then(() => false, () => true);
    const ack = await signDeliveryAck(value, sign);
    check((await history.read()).status === 'none', 'no invented history');
    check(await denied(() => history.confirm(ack)), 'unsolicited acknowledgment refused');
    await history.begin(value);
    check((await history.read()).status === 'pending', 'begin is not confirmation');
    const altered = ack.slice(); altered[altered.length - 1] ^= 1;
    check(await denied(() => history.confirm(altered)), 'bad signature refused');
    const newer = {...value, nonce: '55'.repeat(16)}; await history.begin(newer);
    check(await denied(() => history.confirm(ack)), 'old request cannot confirm newer send');
    check(await denied(() => history.begin({...newer, nonce: '66'.repeat(16), policyRevision: 1n})), 'policy regression refused');
    const proof = await signDeliveryAck(newer, sign);
    const raced = await Promise.allSettled([history.confirm(proof), history.confirm(proof)]);
    check(raced.filter(result => result.status === 'fulfilled').length === 1, 'one concurrent confirmation commits');
    check((await history.read()).status === 'recipient-confirmed-saved', 'confirmed status revalidates signature');
    check(await denied(() => history.confirm(proof)), 'already consumed acknowledgment refused');
    const damaged = openDeliveryHistory({store: {...store, read: async (...args) => {
      const saved = await store.read(...args); saved.value.acknowledgment[0] ^= 1; return saved;
    }}, ...binding});
    check(await denied(() => damaged.read()), 'stored damaged acknowledgment not displayed as confirmed');
    const cancelled = new AbortController(); cancelled.abort();
    check(await denied(() => history.begin({...newer, nonce: '77'.repeat(16)}, {signal: cancelled.signal})), 'cancelled send not recorded');
    store.close();
  });
  console.log('PASS: durable pending/confirmed public delivery status, unsolicited/wrong/replayed receipts, newer-request protection, concurrent confirmation, signature revalidation and cancellation. No credential authority.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
