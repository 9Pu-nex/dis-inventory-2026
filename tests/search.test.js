import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, statusKey, parseDate, escapeHTML, safeImageUrl, searchItems, countBy, sortItems,
} from '../js/search.js';
import { STRINGS, STATUS, CONDITION, SHEETS } from '../js/i18n.js';

test('normalize ignores case, spaces, dashes', () => {
  assert.equal(normalize(' MacBook-Air M2 '), 'macbookairm2');
});

test('statusKey', () => {
  assert.equal(statusKey('ใช้งาน '), 'using');
  assert.equal(statusKey('เลิกใช้งาน'), 'other');
  assert.equal(statusKey('ส่งซ่อม'), 'repair');
  assert.equal(statusKey('Stand-by'), 'standby');
  assert.equal(statusKey(''), 'none');
  assert.equal(statusKey('ปกติ'), 'using');
  assert.equal(statusKey('กำลังตามหา'), 'lost');
});

test('parseDate handles CE, BE, 2-digit, spaced', () => {
  const d = (y, m, dd) => Date.UTC(y, m - 1, dd);
  assert.equal(parseDate('19/03/2020'), d(2020, 3, 19));
  assert.equal(parseDate('01/08/2566'), d(2023, 8, 1));
  assert.equal(parseDate('24/5/24'), d(2024, 5, 24));
  assert.equal(parseDate('14 / 08 / 2566'), d(2023, 8, 14));
  assert.equal(parseDate('Date'), null);
  assert.equal(parseDate(''), null);
});

test('escapeHTML', () => {
  assert.equal(
    escapeHTML(`<img src=x onerror="a('&')">`),
    '&lt;img src=x onerror=&quot;a(&#39;&amp;&#39;)&quot;&gt;',
  );
});

test('safeImageUrl', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('http://x'), '');
  assert.equal(safeImageUrl(' https://a/b '), 'https://a/b');
});

const items = [
  { id: 'IT:2', sheet: 'IT', barcode: 'DIS-IT-0001', name: 'MACBOOK-AIR M2', brand: 'Apple', serial: 'C02XYZ', location: 'ครูสมชาย', status: 'ใช้งาน', category: '', reference: '', condition: '' },
  { id: 'IT:3', sheet: 'IT', barcode: 'DIS-IT-0002', name: 'Dell Monitor', brand: 'Dell', serial: 'SN555', location: 'ห้อง 3', status: 'ชำรุด', category: '', reference: '', condition: '' },
  { id: 'Sport:2', sheet: 'Sport', barcode: 'SP-01', name: 'ลูกฟุตบอล', brand: '', serial: '', location: 'ห้องพละ', status: 'เลิกใช้งาน', category: '', reference: '', condition: '' },
];

const ids = (r) => r.results.map(i => i.id);

test('multi-token across fields', () => {
  assert.deepEqual(ids(searchItems(items, { query: 'dell ห้อง3' })), ['IT:3']);
});

test('formatting-insensitive name', () => {
  assert.deepEqual(ids(searchItems(items, { query: 'macbook air' })), ['IT:2']);
});

test('serial is searchable', () => {
  assert.equal(searchItems(items, { query: 'c02x' }).results[0].id, 'IT:2');
});

test('partial barcode', () => {
  assert.equal(searchItems(items, { query: 'it-0002' }).results[0].id, 'IT:3');
});

test('exact barcode ignores case/dashes', () => {
  const r = searchItems(items, { query: 'dis it 0001' });
  assert.equal(r.exactBarcode, true);
  assert.deepEqual(ids(r), ['IT:2']);
});

test('browse with empty query + filters', () => {
  assert.equal(searchItems(items, { sheet: 'IT' }).results.length, 2);
  assert.deepEqual(ids(searchItems(items, { status: 'other' })), ['Sport:2']);
});

test('countBy', () => {
  assert.deepEqual(countBy(items, i => i.sheet), { IT: 2, Sport: 1 });
});

test('i18n parity', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.th).sort());
  for (const lang of ['en', 'th']) {
    assert.deepEqual(Object.keys(STRINGS.en.fields).sort(), Object.keys(STRINGS[lang].fields).sort());
  }
  assert.deepEqual(Object.keys(STATUS.using).sort(), ['en', 'th']);
  assert.deepEqual(Object.keys(CONDITION).length > 0, true);
  assert.equal(SHEETS.length, 9);
});

const sortable = [
  { id: 'old',  name: 'bbb', date: '19/03/2020', status: 'ชำรุด' },   // 2020-03-19, broken
  { id: 'new',  name: 'ccc', date: '01/08/2566', status: 'ใช้งาน' },  // 2023-08-01, using
  { id: 'none', name: 'aaa', date: '',           status: '' },        // no date, no status
];
const sortIds = (list) => list.map((i) => i.id);

test('name sort ascends and descends', () => {
  assert.deepEqual(sortIds(sortItems(sortable, 'name-asc')), ['none', 'old', 'new']);
  assert.deepEqual(sortIds(sortItems(sortable, 'name-desc')), ['new', 'old', 'none']);
});

test('date sort: desc = newest first, asc = oldest first, undated always last', () => {
  assert.deepEqual(sortIds(sortItems(sortable, 'date-desc')), ['new', 'old', 'none']);
  assert.deepEqual(sortIds(sortItems(sortable, 'date-asc')), ['old', 'new', 'none']);
});

test('status sort follows STATUS_ORDER forwards and backwards', () => {
  // STATUS_ORDER = using, broken, repair, lost, standby, other, none
  assert.deepEqual(sortIds(sortItems(sortable, 'status-asc')), ['new', 'old', 'none']);
  assert.deepEqual(sortIds(sortItems(sortable, 'status-desc')), ['none', 'old', 'new']);
});

test('empty mode leaves the incoming order untouched (relevance)', () => {
  assert.deepEqual(sortIds(sortItems(sortable, '')), ['old', 'new', 'none']);
  assert.equal(sortItems(sortable, 'name-asc').length, 3);
});

test('unknown mode falls back to the incoming order and never throws', () => {
  assert.deepEqual(sortIds(sortItems(sortable, 'bogus-xyz')), ['old', 'new', 'none']);
  assert.deepEqual(sortItems([], 'name-asc'), []);
});

test('sorting does not mutate the input array', () => {
  const before = sortIds(sortable);
  sortItems(sortable, 'name-desc');
  assert.deepEqual(sortIds(sortable), before);
});

test('status sort keeps same-key items alphabetical in both directions', () => {
  // 'ปกติ' and 'ใช้งาน' are both statusKey 'using'; the tie-break must not flip.
  const same = [
    { id: 'b', name: 'bbb', date: '', status: 'ใช้งาน' },
    { id: 'a', name: 'aaa', date: '', status: 'ปกติ' },
  ];
  assert.deepEqual(sortIds(sortItems(same, 'status-asc')), ['a', 'b']);
  assert.deepEqual(sortIds(sortItems(same, 'status-desc')), ['a', 'b']);
});
