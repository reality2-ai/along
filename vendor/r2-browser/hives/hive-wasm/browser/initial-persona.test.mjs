import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR to the compiled hive-wasm package');
const sources = new Map(await Promise.all(['hive_wasm.js', 'hive_wasm_bg.wasm'].map(async name => ['/' + name, await readFile(join(process.env.R2_WASM_DIR, name))])));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); res.end(sources.get(req.url)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Initial persona test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const check = (v, why) => { if (!v) throw new Error(why); };
    const rejected = async fn => { try { await fn(); return false; } catch { return true; } };
    const initial = await wasm.BrowserInitialPersona.generate();
    const group = initial.group();
    const record = initial.take_member_record();
    check(Object.keys(record).sort().join(',') === 'certificate,custody,format,group,privateKey,subject', 'only member custody and public evidence leave handle');
    check(record.format === 1 && record.custody === 'browser-nonextractable-unqualified', 'custody is explicitly unqualified');
    check(record.group.every((v, i) => v === group[i]), 'record group matches generated group');
    check(wasm.tg_certificate_authentic(record.certificate, record.subject, group), 'actual signed self certificate');
    check(record.certificate.slice(64, 72).every(v => v === 0), 'initial epoch');
    check(!record.privateKey.extractable, 'member key is nonextractable');
    check(await rejected(() => crypto.subtle.exportKey('pkcs8', record.privateKey)), 'no private export');
    check(await rejected(() => initial.take_member_record()), 'record transfers once');
    const other = await wasm.BrowserInitialPersona.generate();
    const second = other.take_member_record();
    check(!second.group.every((v, i) => v === group[i]), 'fresh group entropy');
    check(!second.subject.every((v, i) => v === record.subject[i]), 'fresh member entropy');
    check(!wasm.tg_certificate_authentic(record.certificate, record.subject, second.group), 'foreign group refuses');
    other.close(); other.free();
    initial.close();
    check(await rejected(() => initial.group()), 'closed issuer handle refuses');
    check(await rejected(() => initial.take_member_record()), 'closed handle cannot transfer');
    initial.free();
    // Closing the volatile issuer cannot erase member custody already transferred.
    const message = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign('Ed25519', record.privateKey, message);
    const publicKey = await crypto.subtle.importKey('raw', record.subject, 'Ed25519', false, ['verify']);
    check(await crypto.subtle.verify('Ed25519', publicKey, signature, message), 'transferred member remains usable');
    return true;
  });
  assert.equal(result, true);
  console.log('PASS: fresh group/member generation, authentic initial certificate, private export refusal, one-shot member transfer and volatile issuer closure. No persistence or first-use authorization claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
