import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['qr-transfer.mjs', 'vendor/qrcode.mjs', 'transfer-view.mjs', 'comparison.css']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local setup</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Connect your devices</h1><div id="setup"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const directory = await mkdtemp(join(tmpdir(), 'along-qr-'));
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 700, height: 900}});
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.module = await import('./qr-transfer.mjs');
    document.querySelector('#setup').innerHTML = '<div id="qr"></div><label>Device reply<textarea maxlength="2048"></textarea></label><div id="scan"></div>';
  });
  const sample = JSON.stringify({profile: 'along-browser-proof-v1', descriptor: 'University of Auckland — Tāmaki Makaurau', certificate: 'ab'.repeat(136), proof: 'cd'.repeat(64)});
  await page.evaluate(text => module.renderTransferQr(document.querySelector('#qr'), text), sample);
  const file = join(directory, 'code.png'); await page.locator('#qr svg').screenshot({path: file});
  const decoded = execFileSync(process.env.QR_PYTHON || 'python3', ['-c',
    'import sys,zxingcpp; from PIL import Image; r=zxingcpp.read_barcode(Image.open(sys.argv[1])); assert r; print(r.text,end="")', file], {encoding: 'utf8'});
  assert.equal(decoded, sample);
  assert.equal(await page.evaluate(() => { try { module.renderTransferQr(document.querySelector('#qr'), 'x'.repeat(1801)); return false; } catch { return true; } }), true);
  await page.evaluate(() => {
    window.stops = 0; window.requests = 0; window.changes = 0;
    document.querySelector('textarea').addEventListener('input', () => changes++);
    HTMLMediaElement.prototype.play = async () => {};
    window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } async detect() { return [{format: 'qr_code', rawValue: 'scanned public reply'}]; } };
    window.makeStream = () => { const stream = new MediaStream(); Object.defineProperty(stream, 'getTracks', {value: () => [{stop: () => stops++}]}); return stream; };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable: true, writable: true, value: async options => { requests++; window.options = options; return makeStream(); }});
  });
  await page.evaluate(() => module.scanTransferQr(document.querySelector('#scan'), document.querySelector('textarea'), new AbortController().signal));
  assert.equal(await page.locator('textarea').inputValue(), 'scanned public reply');
  assert.equal(await page.evaluate(() => stops === 1 && requests === 1 && changes === 1 && options.audio === false), true);
  // Permission resolving after the view disappears must stop the acquired track.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.allowCamera = () => resolve(makeStream()); });
    window.pending = module.scanTransferQr(document.querySelector('#scan'), document.querySelector('textarea'), new AbortController().signal);
  });
  await page.waitForFunction(() => !!window.allowCamera);
  await page.evaluate(async () => { document.querySelector('#scan').replaceChildren(); allowCamera(); await pending; });
  assert.equal(await page.evaluate(() => stops), 2);
  // Native detection can also resolve after cancellation. It must not fill input.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => makeStream();
    BarcodeDetector.prototype.detect = () => new Promise(resolve => { window.finishDetection = resolve; });
    window.abort = new AbortController();
    window.pending = module.scanTransferQr(document.querySelector('#scan'), document.querySelector('textarea'), abort.signal);
  });
  await page.waitForFunction(() => !!window.finishDetection);
  await page.evaluate(async () => { abort.abort(); finishDetection([{format: 'qr_code', rawValue: 'late'}]); await pending; });
  assert.equal(await page.locator('textarea').inputValue(), 'scanned public reply');
  assert.equal(await page.evaluate(() => stops), 3);
  await page.evaluate(async () => { window.BarcodeDetector = undefined; await module.scanTransferQr(document.querySelector('#scan'), document.querySelector('textarea')); });
  await page.getByRole('status').filter({hasText: 'unavailable'}).waitFor();
  assert.equal(await page.evaluate(() => requests), 1);
  console.log('PASS: generated QR independently decoded including macrons; message-size bound; camera request scope, track cleanup, late permission/detection refusal and unsupported-browser fallback. Camera/detector mocked; no physical scan claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true}); }
