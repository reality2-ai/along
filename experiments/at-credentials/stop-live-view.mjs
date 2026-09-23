import {departurePrediction} from '../../public/live-predictions.js';
import {contextualAlerts} from '../../public/live-context.js';
import {stopAlertContexts, aucklandWallEpoch} from '../../public/live-time.js';
const mounted = new WeakMap();
const time = new Intl.DateTimeFormat('en-NZ', {timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

// Supplemental stop information: the enclosing screen retains its scheduled
// departure board. Supply its verified GTFS rows and a dedicated saved-key client
// or authenticated policy-session controller. No route/location goes to read().
export function showStopLiveUpdates(container, {client, place, rows, at, now = () => Date.now() / 1000}) {
  if (typeof client?.read !== 'function' || typeof client?.cancel !== 'function' || !Array.isArray(rows)) throw new Error('Stop context unavailable');
  const context = structuredClone({place, rows, at});
  context.rows = context.rows.filter(row => row.stop?.id === context.place?.id);
  const contexts = stopAlertContexts(context.place, context.rows, context.at);
  mounted.get(container)?.();
  const document = container.ownerDocument;
  let disposed = false, busy = false, timer;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const button = element('button', 'Check live times and alerts'); button.type = 'button'; button.className = 'pairing-primary';
  const help = element('p', 'Optional online check for this stop. Your saved key goes directly to Auckland Transport; the stop and journey details stay on this device. Scheduled times remain available.');
  const status = element('p', ''); status.setAttribute('role', 'status');
  const results = element('div', '');
  panel.append(element('h2', 'Live updates for this stop'), button, help, status, results); container.replaceChildren(panel);
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(timer); client.cancel(); button.disabled = true; results.replaceChildren();
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  button.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy) return;
    busy = true; button.disabled = true; clearTimeout(timer); results.replaceChildren();
    status.textContent = 'Checking live information for this stop…';
    try {
      const read = kind => Promise.resolve().then(() => client.read(kind, {requested: true})).catch(() => ({available: false}));
      const [predictions, alerts] = await Promise.all([read('predictions'), read('alerts')]);
      if (disposed) return;
      const checkedAt = now();
      let matches = 0, expires = Infinity;
      for (const row of context.rows) {
        const prediction = departurePrediction(predictions, row, {now: checkedAt});
        if (prediction.status === 'scheduled') continue;
        let label = prediction.status === 'cancelled' ? 'Cancelled' : prediction.status === 'skipped' ? 'Not stopping here' : '';
        if (prediction.status === 'predicted') {
          const scheduled = aucklandWallEpoch(context.at.date, row.departure);
          const epoch = prediction.epoch ?? (scheduled === null ? null : scheduled + prediction.delay);
          if (epoch === null || !Number.isFinite(epoch)) continue;
          label = 'Expected ' + time.format(new Date(epoch * 1000));
          // Include the date to avoid misrepresenting an overnight prediction.
          const date = new Intl.DateTimeFormat('en-NZ', {timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short'}).format(new Date(epoch * 1000));
          label += ' on ' + date;
        }
        const scheduled = aucklandWallEpoch(context.at.date, row.departure);
        const item = element('p', `${row.route} to ${row.headsign}: ${label}. Scheduled ${scheduled === null ? 'time unavailable' : time.format(new Date(scheduled * 1000))}.`);
        results.append(item); matches++;
        expires = Math.min(expires, Number(prediction.updated) + 180);
      }
      const relevant = contextualAlerts(alerts, contexts, {now: checkedAt});
      if (relevant.length) {
        results.append(element('h3', 'Service updates for this stop'));
        for (const alert of relevant) {
          const article = element('article', ''); article.append(element('h4', alert.title), element('p', alert.description)); results.append(article);
        }
        expires = Math.min(expires, Number(alerts.updated) + 180);
      }
      status.textContent = matches || relevant.length
        ? `${matches} matching departure update${matches === 1 ? '' : 's'} and ${relevant.length} service update${relevant.length === 1 ? '' : 's'}. Other departures remain scheduled.`
        : 'No matching live information is available. Scheduled times remain unchanged.';
      if (Number.isFinite(expires)) timer = setTimeout(() => {
        if (!disposed) { results.replaceChildren(); status.textContent = 'Live information has expired. Scheduled times remain available; check again when needed.'; }
      }, Math.max(0, (expires - now()) * 1000));
    } catch {
      if (!disposed) { results.replaceChildren(); status.textContent = 'Live information is unavailable. Scheduled times remain unchanged.'; }
    } finally { if (!disposed) { busy = false; button.disabled = false; } }
  });
  return Object.freeze({dispose});
}
