import {vehiclePosition} from '../../public/live-vehicles.js';
const mounted = new WeakMap();
const reportedTime = new Intl.DateTimeFormat('en-NZ', {timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});

// Owns only its vehicle marker, never the scheduled route or basemap. Dispose
// before removing the enclosing map. No tile layer or automatic polling is added.
export function showVehicleLivePosition(container, {client, run, map, leaflet, now = () => Date.now() / 1000}) {
  if (typeof client?.read !== 'function' || typeof client?.cancel !== 'function'
      || typeof map?.removeLayer !== 'function' || typeof leaflet?.circleMarker !== 'function') throw new Error('Vehicle map context unavailable');
  const selected = structuredClone(run);
  mounted.get(container)?.();
  const document = container.ownerDocument;
  let disposed = false, busy = false, marker, timer;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const panel = element('section', ''); panel.className = 'pairing-comparison';
  const button = element('button', 'Check this service’s current position'); button.type = 'button'; button.className = 'pairing-primary';
  const help = element('p', 'Optional online check for the selected departure. Your key goes directly to Auckland Transport; your route selection stays on this device. A reported position is not an arrival prediction.');
  const status = element('p', ''); status.setAttribute('role', 'status');
  panel.append(element('h2', 'This service’s position'), button, help, status); container.replaceChildren(panel);
  const clear = () => { clearTimeout(timer); if (marker) { map.removeLayer(marker); marker = undefined; } };
  const dispose = () => {
    if (disposed) return;
    disposed = true; client.cancel(); clear(); button.disabled = true;
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  mounted.set(container, dispose);
  button.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy) return;
    busy = true; button.disabled = true; clear(); status.textContent = 'Checking this service’s current position…';
    try {
      const feed = await client.read('vehicles', {requested: true});
      if (disposed) return;
      const position = vehiclePosition(feed, selected, {now: now()});
      if (!position.available) {
        status.textContent = 'No current position could be matched to this departure. The scheduled route is still shown.'; return;
      }
      const label = 'Vehicle position reported at ' + reportedTime.format(new Date(position.updated * 1000));
      marker = leaflet.circleMarker([position.lat, position.lon], {radius: 10, color: '#fff', weight: 3, fillColor: '#884400', fillOpacity: 1, interactive: false})
        .addTo(map).bindTooltip(label, {permanent: true, direction: 'top'});
      const nearby = (selected.stops || []).map(call => call.stop).filter(stop => stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lon))
        .map(stop => ({stop, distance: map.distance([position.lat, position.lon], [stop.lat, stop.lon])})).sort((a, b) => a.distance - b.distance)[0];
      status.textContent = label + '.' + (nearby ? ` About ${Math.round(nearby.distance)} metres in a straight line from ${nearby.stop.name}.` : '') + ' This is a reported location, not an arrival prediction.';
      map.fitBounds(map.getBounds().extend([position.lat, position.lon]), {animate: false, padding: [25, 25]});
      timer = setTimeout(() => {
        if (!disposed) { clear(); status.textContent = 'The vehicle position has expired. The scheduled route remains; check again when needed.'; }
      }, Math.max(0, (position.expires - now()) * 1000));
    } catch {
      if (!disposed) { clear(); status.textContent = 'The current position is unavailable. The scheduled route is still shown.'; }
    } finally { if (!disposed) { busy = false; button.disabled = false; } }
  });
  return Object.freeze({dispose});
}
