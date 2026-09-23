import qrcode from './vendor/qrcode.mjs';
qrcode.stringToBytes = text => [...new TextEncoder().encode(text)];
export function renderTransferQr(container, text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 1800) throw new Error('Message too large for this QR view');
  const qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
  const document = container.ownerDocument, ns = 'http://www.w3.org/2000/svg', size = qr.getModuleCount();
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${size + 8} ${size + 8}`);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Device message QR code. Copyable text is also available.');
  svg.style.cssText = 'display:block;width:100%;max-width:36rem;margin:auto;background:white;image-rendering:pixelated';
  const path = document.createElementNS(ns, 'path'); let data = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (qr.isDark(y, x)) data += `M${x + 4},${y + 4}h1v1h-1z`;
  path.setAttribute('d', data); path.setAttribute('fill', 'black'); path.setAttribute('shape-rendering', 'crispEdges'); svg.append(path);
  container.replaceChildren(svg); return svg;
}
// Start only after a trusted scan-button action. Permission is requested at that
// moment. Frames remain local; decoded text still needs the normal review/check.
export async function scanTransferQr(container, input, signal) {
  const document = container.ownerDocument, window = document.defaultView;
  let stopped = false, stream, timer, frame, observer, resolveStopped;
  const finished = new Promise(resolve => { resolveStopped = resolve; });
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.setAttribute('aria-label', 'Camera preview'); video.style.width = '100%';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Stop scanning';
  container.replaceChildren(video, status, cancel);
  const stop = () => {
    if (stopped) return;
    stopped = true; resolveStopped(); clearTimeout(timer); clearTimeout(frame); stream?.getTracks().forEach(track => track.stop()); video.srcObject = null;
    video.hidden = true; cancel.hidden = true; observer?.disconnect();
    signal?.removeEventListener('abort', stop); document.removeEventListener('visibilitychange', hidden);
  };
  const live = () => !stopped && !signal?.aborted && container.isConnected && video.isConnected && document.visibilityState !== 'hidden';
  const hidden = () => { if (document.visibilityState === 'hidden') { stop(); status.textContent = 'Scanning stopped. You can paste a device message instead.'; } };
  cancel.addEventListener('click', () => { stop(); status.textContent = 'Scanning stopped.'; input.focus(); });
  signal?.addEventListener('abort', stop, {once: true}); document.addEventListener('visibilitychange', hidden);
  observer = new MutationObserver(() => { if (!container.isConnected || !video.isConnected) stop(); }); observer.observe(document, {childList: true, subtree: true});
  timer = setTimeout(() => { stop(); status.textContent = 'Scanning stopped. Try again or paste the device message.'; }, 60000);
  try {
    if (!live()) { stop(); return; }
    if (!window.BarcodeDetector || !(await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) throw new Error('Unsupported');
    if (!live()) { stop(); return; }
    status.textContent = 'Allow the camera to scan your other device. Images stay on this device.';
    const acquired = await window.navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}}});
    if (!live()) { acquired.getTracks().forEach(track => track.stop()); stop(); return; }
    stream = acquired; video.srcObject = stream; await video.play();
    const detector = new window.BarcodeDetector({formats: ['qr_code']});
    const read = async () => {
      if (!live()) { stop(); return; }
      try {
        const results = await detector.detect(video);
        if (!live()) { stop(); return; }
        const value = results.find(result => result.format === 'qr_code' && typeof result.rawValue === 'string' && result.rawValue.length > 0 && result.rawValue.length <= input.maxLength)?.rawValue;
        if (value) {
          stop(); input.value = value; input.dispatchEvent(new window.Event('input', {bubbles: true})); input.focus();
          status.textContent = 'Message scanned. Review or check it before continuing.'; return;
        }
        frame = setTimeout(read, 200);
      } catch { stop(); status.textContent = 'The code could not be read. Paste the device message instead.'; }
    };
    status.textContent = 'Point the camera at the QR code on your other device.'; cancel.focus(); await Promise.race([read(), finished]); await finished;
  } catch {
    if (live()) { stop(); status.textContent = 'Camera scanning is unavailable here. Paste the device message instead.'; input.focus(); }
    else stop();
  }
}
