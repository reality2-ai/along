// Optional local credential consent. The enclosing flow must establish the
// application owner first. Saving does not opt into a provider request or peer share.
const mounted = new WeakMap();
let serial = 0;
export function showCredentialSetup(container, {vault, focus = false, onBack = () => {}}) {
  if (typeof vault?.saveOwnerKey !== 'function') throw new Error('AT vault required');
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, busy = false, saved = false, resolve, reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
  void completed.catch(() => {});
  const element = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const panel = element('section'); panel.className = 'pairing-comparison credential-setup';
  const heading = element('h2', 'Add your AT key'); heading.tabIndex = -1;
  const intro = element('p', 'Optional live information can improve the timetable for the stop or journey you are viewing. Downloaded journey planning still works offline.');
  const disclosure = element('p', 'Save your personal AT key encrypted in this browser. When you choose to check live information, Along sends the key directly to Auckland Transport. Saving here does not share it with another device or contact AT.');
  const form = element('form');
  const label = element('label', 'Personal AT API key');
  const input = element('input'); input.type = 'password'; input.id = `along-at-key-${++serial}`;
  input.autocomplete = 'off'; input.spellcheck = false; input.autocapitalize = 'none'; input.required = true; input.maxLength = 512;
  label.htmlFor = input.id;
  const status = element('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
  const save = element('button', 'Save key on this device'); save.type = 'submit'; save.className = 'pairing-primary';
  const back = element('button', 'Back'); back.type = 'button';
  form.append(label, input, save); panel.append(heading, intro, disclosure, form, status, back);
  container.replaceChildren(panel); if (focus) heading.focus();
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); input.value = ''; input.disabled = true; save.disabled = true; back.disabled = true;
    reject(new Error('Credential setup closed'));
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  const leave = () => { if (disposed) return; dispose(); onBack(); };
  back.addEventListener('click', leave);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.isTrusted || disposed || busy || saved) return;
    if (!/^[\x21-\x7e]{1,512}$/.test(input.value)) {
      status.textContent = 'Enter your AT key without spaces or line breaks.';
      input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    input.removeAttribute('aria-invalid'); busy = true;
    const moveFocus = form.contains(document.activeElement);
    let value = input.value; input.value = ''; input.disabled = true; save.disabled = true;
    status.textContent = 'Saving on this device…';
    try {
      const receipt = await vault.saveOwnerKey(value, {signal: lifetime.signal});
      if (disposed) return;
      if (receipt?.status !== 'credential-saved') throw new Error('No saved receipt');
      saved = true; form.hidden = true; heading.textContent = 'AT key saved on this device';
      status.textContent = 'The key has not been checked with AT. Return to your stop or journey to choose live information.';
      resolve(receipt);
    } catch {
      if (!disposed) {
        // Do not imply rollback: another tab or a completed commit may have won.
        form.hidden = true;
        status.textContent = 'Saving could not be confirmed here. Go Back to check your live-information settings. Your downloaded journeys are still available.';
        reject(new Error('Credential save unconfirmed'));
      }
    } finally {
      value = undefined; busy = false;
      if (!disposed && moveFocus && (document.activeElement === document.body || form.contains(document.activeElement))) back.focus();
    }
  });
  return Object.freeze({completed, dispose});
}
