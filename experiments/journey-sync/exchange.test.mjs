import test from 'node:test';
import assert from 'node:assert/strict';
import {createJourneyExchange} from './exchange.mjs';
import {emptyState, changeJourney, projectJourney, journeyId, mergeStates, savedJourneys} from './state.mjs';
const group = 'a'.repeat(64), actor = '1'.repeat(64);
function populated() {
  let state = emptyState(group);
  for (let n = 0; n < 12; n++) {
    const value = projectJourney({from: {id: 'a', name: 'Tāmaki Makaurau', lat: -36, lon: 174},
      to: {id: String(n), name: 'Destination ' + n, lat: -37, lon: 175}, savedRoutes: [{mode: 'bus', route: '70'}]});
    state = changeJourney(state, actor, journeyId(value), value);
  }
  return state;
}
function pair({commit, transform = (_, bytes) => bytes, timeoutMs = 1000} = {}) {
  const endpoints = [], packets = [], errors = [];
  for (let index = 0; index < 2; index++) endpoints[index] = createJourneyExchange({group, timeoutMs,
    send: async bytes => {
      packets.push(bytes.slice());
      const packet = transform(index, bytes.slice());
      if (packet) queueMicrotask(() => { void endpoints[1 - index].receive(packet).catch(error => errors.push(error)); });
    }, commit: commit || (async () => ({status: 'journeys-saved'})),
    onClose: () => endpoints[1 - index]?.close()});
  return {a: endpoints[0], b: endpoints[1], packets, errors, close: () => endpoints.forEach(endpoint => endpoint.close())};
}
test('large snapshot is chunked below R2 limit; confirmation follows commit', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const received = new Promise(resolve => { entered = resolve; });
  let state;
  const link = pair({commit: async value => { state = value; entered(); await gate; return {status: 'journeys-saved'}; }});
  try {
    let confirmed = false;
    const sending = link.a.sendSnapshot(populated()).then(receipt => { confirmed = true; return receipt; });
    await received;
    assert.equal(confirmed, false);
    assert.equal(link.packets.some(packet => packet[0] === 4), false);
    release();
    assert.equal((await sending).status, 'peer-saved-snapshot');
    assert.deepEqual(state, populated());
    assert.ok(link.packets.filter(packet => packet[0] === 2).length > 1);
    assert.ok(link.packets.every(packet => packet.length <= 2048));
  } finally { link.close(); }
});
test('lost receipt leaves saved data; retry on a new channel converges', async () => {
  let state = emptyState(group);
  const commit = async snapshot => { state = mergeStates(state, snapshot); return {status: 'journeys-saved'}; };
  const lost = pair({commit, timeoutMs: 30, transform: (index, packet) => index === 1 && packet[0] === 4 ? null : packet});
  await assert.rejects(lost.a.sendSnapshot(populated())); lost.close();
  assert.equal(savedJourneys(state).length, 12);
  const retry = pair({commit});
  try { await retry.a.sendSnapshot(populated()); assert.deepEqual(state, populated()); }
  finally { retry.close(); }
});
test('changed bytes, wrong ordering and false commit receipts never confirm', async () => {
  for (const mode of ['changed', 'offset', 'uncommitted']) {
    let commits = 0;
    const link = pair({timeoutMs: 100, commit: async () => { commits++; return {status: 'not-saved'}; },
      transform: (index, packet) => {
        if (index === 0 && packet[0] === 2) {
          if (mode === 'changed') packet[packet.length - 1] ^= 1;
          if (mode === 'offset') new DataView(packet.buffer).setUint32(17, 7);
        }
        return packet;
      }});
    try {
      await assert.rejects(link.a.sendSnapshot(populated()));
      assert.equal(commits, mode === 'uncommitted' ? 1 : 0);
    } finally { link.close(); }
  }
});
test('oversized allocation and unsolicited receipts are refused', async () => {
  for (const type of [1, 4]) {
    const link = pair();
    const packet = new Uint8Array(53); packet[0] = type;
    new DataView(packet.buffer).setUint32(17, 2 * 1024 * 1024 + 1);
    try { await assert.rejects(link.b.receive(packet)); assert.equal(link.b.signal.aborted, true); }
    finally { link.close(); }
  }
});
test('both directions can transfer together; closure while committing gives no confirmation', async () => {
  const duplex = pair();
  try {
    const receipts = await Promise.all([duplex.a.sendSnapshot(populated()), duplex.b.sendSnapshot(emptyState(group))]);
    assert.ok(receipts.every(receipt => receipt.status === 'peer-saved-snapshot'));
  } finally { duplex.close(); }
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  const link = pair({commit: async () => { entered(); await gate; return {status: 'journeys-saved'}; }});
  const sending = assert.rejects(link.a.sendSnapshot(populated()));
  await reached; link.close(); release(); await sending;
  assert.equal(link.packets.some(packet => packet[0] === 4), false);
});
