import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR to the compiled hive-wasm package');
const sources = new Map(await Promise.all(['hive_wasm.js', 'hive_wasm_bg.wasm'].map(async name => ['/' + name, await readFile(join(process.env.R2_WASM_DIR, name))])));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); res.end(sources.get(req.url)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Candidate mint test</title>'); }
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
    const originalGenerate = crypto.subtle.generateKey.bind(crypto.subtle);
    let privateKey, requestedExtractable;
    crypto.subtle.generateKey = async (...args) => {
      requestedExtractable = args[1]; const pair = await originalGenerate(...args); privateKey = pair.privateKey; return pair;
    };
    const candidate = await wasm.BrowserCandidateKey.generate();
    check(requestedExtractable === false && privateKey.extractable === false, 'nonextractable browser generation');
    check(await rejected(() => crypto.subtle.exportKey('pkcs8', privateKey)), 'private export must refuse');
    crypto.subtle.generateKey = originalGenerate;
    const publicBytes = candidate.public_key();
    const publicKey = await crypto.subtle.importKey('raw', publicBytes, 'Ed25519', false, ['verify']);
    const message = new Uint8Array([1, 2, 3, 4]);
    const pendingSignature = candidate.sign(message); message.fill(99);
    const signature = await pendingSignature;
    check(await crypto.subtle.verify('Ed25519', publicKey, signature, new Uint8Array([1, 2, 3, 4])), 'actual signature binds copied bytes');
    const other = await wasm.BrowserCandidateKey.generate();
    check(!other.public_key().every((v, i) => v === publicBytes[i]), 'fresh candidate key');
    other.close(); other.free();
    check(await rejected(() => candidate.sign(new Uint8Array(4097))), 'bounded signing message');

    const originalSign = crypto.subtle.sign.bind(crypto.subtle);
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    crypto.subtle.sign = async (...args) => { const signature = await originalSign(...args); entered(); await delayed; return signature; };
    const late = candidate.sign(new Uint8Array([5]));
    await started; candidate.close(); release();
    check(await rejected(() => late), 'closed pending signature refuses');
    check(await rejected(() => candidate.public_key()), 'closed identity refuses');
    check(await rejected(() => candidate.sign(new Uint8Array([6]))), 'closed signing refuses');
    crypto.subtle.sign = originalSign; candidate.free();

    crypto.subtle.generateKey = () => Promise.reject(new Error('controlled unsupported browser'));
    check(await rejected(() => wasm.BrowserCandidateKey.generate()), 'unsupported crypto refuses without fallback');
    crypto.subtle.generateKey = (...args) => originalGenerate(args[0], true, args[2]);
    check(await rejected(() => wasm.BrowserCandidateKey.generate()), 'extractable private key refused');
    crypto.subtle.generateKey = originalGenerate;
    return true;
  });
  assert.equal(result, true);
  console.log('PASS: actual Web Crypto mint reaches the core proof; private export refuses; signatures bind copied input; fresh keys differ; closure rejects in-flight results; unsupported/extractable crypto refuses. Volatile key primitive only, not admission or installation.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
