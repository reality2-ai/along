// Published current-R2 vectors: TEST-VECTORS-L4 and TEST-VECTORS-FORMATS,
// standard 0.9.0 rev 006d57a43fb936039050b123da9e4663471a4b9c. Hex copied verbatim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {eventHash, normaliseName} from './names.mjs';
import {parseFrame, TYPE} from './frame.mjs';
import {verifyTag, wireHalf} from './group-protection.mjs';
import {cborFloat, decode, encode} from './cbor.mjs';
import {readAnnouncement} from './heartbeat.mjs';

const hex = s => Uint8Array.from(s.match(/../g), b => parseInt(b, 16));
const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const K = hex('000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F');

test('L4 7.1 name normalisation and FNV-1a vectors N1–N15', () => {
  const cases = [
    ['temperature', 0xE9F2A935], ['Temperature', 0xE9F2A935], ['  temperature  ', 0xE9F2A935],
    ['temperature\xa0', 0xE9F2A935], ['TEMPERATURE', 0xE9F2A935], ['TEMP\xc9RATURE', 0x69E6B960],
    ['Āwhina', 0x41C1B439], ['Ĺ', 0x8D90388B], ['Ÿ', 0x109DD2B7], ['A\xd7B', 0x6CAB18B4],
    ['temp erature', 0x4FB0089F], ['ΣΙΓΜΑ', 0x212315C3], ['temp\xa0erature', 0x88F20997],
    [' name　', 0x8D39BDE6], ['humidity', 0x25C5B9A0],
  ];
  for (const [name, hash] of cases) assert.equal(eventHash(name), hash, name);
  assert.equal(normaliseName('TEMP\xc9RATURE'), 'temp\xe9rature');
  assert.equal(normaliseName('Ÿ'), '\xff');
  assert.throws(() => eventHash('   '));
});

const good = {
  CV1: ['compact', '06561234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6'],
  CV4: ['compact', '04561234E9F2A935C0C1C2C3010A0B0C0D'],
  CV5: ['compact', '06569234E9F2A9350A0B0C0D01B0B1B2B3FBFF9F40FCDE669B'],
  CV6: ['compact', '1C5612350000000000000000010A0B0C0D821AE9F2A9351A25C5B9A0'],
  CV7: ['compact', '2056200100000000C0C1C2C3DEADBEEF'],
  CV8: ['compact', '2C56200200000000C0C1C2C3010A0B0C0D'],
  CV9: ['compact', '05561234E9F2A935C0C1C2C3010A0B0C0D'],
  CV3: ['compact', '04561234E9F2A935C0C1C2C3080A0B0C0DE0E0E001E0E0E002E0E0E003E0E0E004E0E0E005E0E0E006E0E0E007A16174FB4036800000000000'],
  EV1: ['extended', '065600001234E9F2A9350000000CA0A0A0A0B5B6B7B8011111111122222222A16174FB40368000000000002458EBDD5D2A30DD9229661E98338BF1859BDA5BF24741790B91032FCC990F8F'],
};

test('L4 4.2/4.3 frames parse; EV1, CV1 and CV5 tags verify under K', async () => {
  for (const [name, [tier, h]] of Object.entries(good)) {
    const frame = parseFrame(hex(h), tier);
    assert.ok(!frame.discard, name);
    assert.equal(frame.originless, false, name);
  }
  const ev1 = parseFrame(hex(good.EV1[1]));
  assert.equal(ev1.payload.length, 12);
  assert.equal(toHex(ev1.origin), '1111111122222222');
  assert.equal(ev1.msgId, 0x00001234);
  for (const name of ['EV1', 'CV1', 'CV5']) assert.ok(await verifyTag(parseFrame(hex(good[name][1]), good[name][0]), K), name);
  assert.equal(parseFrame(hex(good.CV3[1]), 'compact').route.length, 8);
  assert.equal(parseFrame(hex(good.CV6[1]), 'compact').type, TYPE.CAPABILITY);
  assert.deepEqual(parseFrame(hex(good.CV7[1]), 'compact').payload, hex('DEADBEEF'));
});

test('origin-less and malformed frames are dropped (EV2, EV3, CV2, BAD1–BAD5)', () => {
  assert.equal(parseFrame(hex('005600001234E9F2A9350000000CA0A0A0A0B5B6B7B8A16174FB4036800000000000')).originless, true);
  assert.equal(parseFrame(hex('045600001234E9F2A93500000000A0A0A0A0B5B6B7B800')).originless, true);
  assert.equal(parseFrame(hex('04561234E9F2A935C0C1C2C300A16174FB4036800000000000'), 'compact').originless, true);
  assert.equal(parseFrame(hex('045600001234E9F2A9350000000CA0A0A0A0B5B6B7B8011111111122222222A16174FB40368000000000')).discard, 'malformed');
  assert.equal(parseFrame(hex('04561234E9F2A935C0C1C2C3090A0B0C0DE0E0E001E0E0E002E0E0E003E0E0E004E0E0E005E0E0E006E0E0E007A16174FB4036800000000000'), 'compact').discard, 'malformed');
  assert.equal(parseFrame(hex('04561234E9F2A935C0C1C2C3080A0B0C0DE0E0E0'), 'compact').discard, 'malformed');
  assert.equal(parseFrame(hex('44561234E9F2A935C0C1C2C3010A0B0C0D'), 'compact').discard, 'version');
  assert.equal(parseFrame(hex('0C561234E9F2A935C0C1C2C3010A0B0C0D'), 'compact').discard, 'reserved-type');
});

test('L4 10.2 span: MF1–MF6 fail, MP1–MP4 still verify', async () => {
  const fail = ['1E561234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '06561235E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '06561234E9F2A935C0C1C2C3010A0B0C0CA16174FB4036800000000000615679067550A7B6',
    '06561234E9F2A934C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '06561234E9F2A935C0C1C2C2010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '06561234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000001615679067550A7B6'];
  for (const h of fail) assert.equal(await verifyTag(parseFrame(hex(h), 'compact'), K), false, h);
  const pass = ['06451234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '06461234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '06551234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '07561234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6',
    '06561234E9F2A935C0C1C2C3020A0B0C0DB0B1B2B3A16174FB4036800000000000615679067550A7B6',
    '06561234E9F2A935C0C1C2C3020A0B0C0DB0B1B2B2A16174FB4036800000000000615679067550A7B6'];
  for (const h of pass) assert.equal(await verifyTag(parseFrame(hex(h), 'compact'), K), true, h);
  // MP3: identical tag, but version 1 is discarded before verification.
  assert.equal(parseFrame(hex('46561234E9F2A935C0C1C2C3010A0B0C0DA16174FB4036800000000000615679067550A7B6'), 'compact').discard, 'version');
});

test('FORMATS 3.3 wire halves: FV-001 and the development group (FV-021)', async () => {
  assert.equal(toHex(await wireHalf(K)), '630dcd29');
  assert.equal(toHex(await wireHalf(hex('cc9527cecd948b5bb97b0c10e5838dd2ca0960694f317e34ebfda924a5333163'))), '0e6c3b8c');
});

test('FORMATS 4b CBOR: FV-005–FV-010, FV-022, FV-023', () => {
  const fv005 = encode(new Map([[1, 1], [2, 'two'], [10, Uint8Array.of(10)]]));
  assert.equal(toHex(fv005), 'a30101026374776f0a410a');
  assert.equal(toHex(encode({})), 'a0');
  assert.equal(decode(hex('a30101026374776f0a410a')).get(2), 'two');
  assert.throws(() => decode(hex('a30101026374776f180a410a')), /Non-canonical/);
  assert.throws(() => decode(hex('a2016161016162')), /Duplicate/);
  assert.throws(() => decode(hex('c06a323032362d30382d3032')), /tags/);
  assert.throws(() => decode(hex('818181818181818180')), /nesting/);
  assert.doesNotThrow(() => decode(hex('8181818181818180')));
  assert.equal(toHex(encode(1.5)), 'f93e00');
  assert.equal(toHex(encode(cborFloat(65536))), 'fa47800000');
  assert.equal(toHex(encode(0.1)), 'fb3fb999999999999a');
  assert.equal(toHex(encode(-0)), 'f98000');
  assert.equal(toHex(encode(cborFloat(0))), 'f90000');
  assert.throws(() => decode(hex('fb3ff8000000000000')), /float/);
  assert.throws(() => decode(hex('fb8000000000000000')), /float/);
  assert.ok(Object.is(decode(hex('f98000')), -0));
  assert.throws(() => decode(hex('a20201' + '0101')), /order/);
});

test('deployed host announcement decodes as a development-declared beacon', () => {
  // Received from wss://wairoa.mariko.org.nz/r2 on 25 September 2026.
  const a = readAnnouncement(hex('2c1000017de1000000000000000f00000000000000000145df536de0b15f9f01047f07b9fc0204e37dff21030101'));
  assert.equal(a.build, 'development');
  assert.equal(toHex(a.beaconId), '7f07b9fc');
  assert.equal(toHex(a.origin), '45df536de0b15f9f');
});
