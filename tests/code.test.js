import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const SOURCE = fs.readFileSync(new URL('../Code.js', import.meta.url), 'utf8');

/** Fake CacheService backed by a Map (per-instance). */
export function makeCache() {
  const store = new Map();
  return {
    _store: store,
    get(key) { return store.has(key) ? store.get(key) : null; },
    put(key, value /*, ttl */) { store.set(key, value); },
    putAll(values) { Object.keys(values).forEach(k => store.set(k, values[k])); },
    getAll(keys) {
      const out = {};
      keys.forEach(k => { if (store.has(k)) out[k] = store.get(k); });
      return out;
    },
    remove(key) { store.delete(key); },
  };
}

/**
 * Load Code.js into a fresh VM context with Apps Script stubs.
 * gzip/base64 are identity stubs in the string domain so cache chunks stay
 * plain strings and can be split/inspected in tests.
 */
export function makeContext(overrides = {}) {
  const cache = makeCache();
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheets: () => [],
        getSheetByName: () => null,
      }),
    },
    Utilities: {
      formatDate: () => '01/02/2024',
      newBlob: (data) => ({
        getBytes: () => data,
        getDataAsString: () => data,
      }),
      gzip: (blob) => blob,
      ungzip: (blob) => blob,
      base64Encode: (bytes) => bytes,
      base64Decode: (str) => str,
    },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    ContentService: {
      createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }),
      MimeType: { JSON: 'application/json' },
    },
    CacheService: { getScriptCache: () => cache },
    Logger: { log: () => {} },
    ...overrides,
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return { ctx, cache };
}

/** Cross-realm safe plain copy. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const fakeSheet = (rows) => ({
  getDataRange: () => ({ getValues: () => rows }),
});

test('name does not steal the user column', () => {
  const { ctx } = makeContext();
  const m = plain(ctx.buildColumnMap(['ชื่อผู้ใช้', 'ชื่อครุภัณฑ์', 'barcode']));
  assert.equal(m.name, 1);
  assert.equal(m.location, 0);
  assert.equal(m.barcode, 2);
});

test('date does not steal warranty-expiry column', () => {
  const { ctx } = makeContext();
  const m = plain(ctx.buildColumnMap(['วันหมดรับประกัน', 'วันที่ซื้อ']));
  assert.equal(m.warranty, 0);
  assert.equal(m.date, 1);
});

test('exact header beats substring', () => {
  const { ctx } = makeContext();
  assert.equal(plain(ctx.buildColumnMap(['username', 'name'])).name, 1);
});

test('empty cell stays empty (no fallback to other column)', () => {
  const { ctx } = makeContext();
  const headers = ['ชื่อครุภัณฑ์', 'ชื่ออื่น'];
  const item = plain(ctx.mapRow(['', 'WRONG'], ctx.buildColumnMap(headers), 'IT', 2));
  assert.equal(item.name, '');
  assert.equal(item.id, 'IT:2');
});

test('image column found by header and Drive URL converted', () => {
  const { ctx } = makeContext();
  const m = ctx.buildColumnMap(['name', 'รูปภาพ']);
  const item = plain(ctx.mapRow(['A', 'https://drive.google.com/file/d/abc_123/view'], m, 'IT', 2));
  assert.equal(item.image, 'https://drive.google.com/thumbnail?id=abc_123&sz=w400');
});

test('embedded English header row is skipped', () => {
  const { ctx } = makeContext();
  const sheet = fakeSheet([
    ['Barcode', 'ชื่อครุภัณฑ์'],
    ['DEC20010100001', 'Chair'],
    ['Barcode', 'Name'],
  ]);
  const items = plain(ctx.readSheet(sheet, 'IT'));
  assert.equal(items.length, 1);
  assert.equal(items[0].barcode, 'DEC20010100001');
});

test('doGet returns success:false JSON when the sheet throws', () => {
  const { ctx } = makeContext({
    SpreadsheetApp: {
      getActiveSpreadsheet() { throw new Error('boom'); },
    },
  });
  const out = plain(JSON.parse(ctx.doGet({ parameter: { action: 'getAll' } }).body));
  assert.equal(out.success, false);
  assert.match(out.error, /boom/);
});

// ── Task 3: cached items endpoint ───────────────────────────────────────────

/** Two-sheet fake spreadsheet that counts getDataRange() reads. */
function fakeBook(sheetDefs) {
  const state = { reads: 0 };
  const sheets = {};
  Object.keys(sheetDefs).forEach(name => {
    const rows = sheetDefs[name];
    sheets[name] = {
      getName: () => name,
      getDataRange: () => {
        state.reads++;
        return { getValues: () => rows };
      },
    };
  });
  return {
    state,
    book: {
      getSheetByName: (n) => sheets[n] || null,
      getSheets: () => Object.keys(sheets).map(n => sheets[n]),
    },
  };
}

const twoSheets = () => fakeBook({
  IT: [
    ['Barcode', 'Name'],
    ['DEC20010100001', 'Chair'],
    ['DEC20010100002', 'Table'],
  ],
  Sport: [
    ['Barcode', 'Name'],
    ['SP-01', 'Ball'],
    ['SP-02', 'Bike'],
  ],
});

test('splitChunks round-trips', () => {
  const { ctx } = makeContext();
  const s = 'x'.repeat(200001);
  const c = plain(ctx.splitChunks(s, 90000));
  assert.equal(c.length, 3);
  assert.equal(c.join(''), s);
});

test('items action returns flat array from all sheets', () => {
  const { book } = twoSheets();
  const { ctx } = makeContext({ SpreadsheetApp: { getActiveSpreadsheet: () => book } });
  const out = plain(JSON.parse(ctx.doGet({ parameter: { action: 'items' } }).body));
  assert.equal(out.success, true);
  assert.equal(out.items.length, 4);
  assert.ok(out.updatedAt);
  assert.equal(out.items[0].id, 'IT:2');
});

test('second call is served from cache (sheet not read again)', () => {
  const { book, state } = twoSheets();
  const { ctx } = makeContext({ SpreadsheetApp: { getActiveSpreadsheet: () => book } });
  ctx.doGet({ parameter: { action: 'items' } });
  assert.equal(state.reads, 2);
  ctx.doGet({ parameter: { action: 'items' } });
  assert.equal(state.reads, 2);
});

test('onEdit clears cache so next call re-reads', () => {
  const { book, state } = twoSheets();
  const { ctx } = makeContext({ SpreadsheetApp: { getActiveSpreadsheet: () => book } });
  ctx.doGet({ parameter: { action: 'items' } });
  assert.equal(state.reads, 2);
  ctx.onEdit({});
  ctx.doGet({ parameter: { action: 'items' } });
  assert.equal(state.reads, 4);
});

test('missing chunk falls back to rebuilding', () => {
  const big = { IT: [['Barcode', 'Name']] };
  for (let i = 0; i < 3000; i++) {
    big.IT.push(['DEC' + String(10000000000 + i), 'Item ' + i + ' ' + 'x'.repeat(120)]);
  }
  const { book, state } = fakeBook(big);
  const { ctx, cache } = makeContext({ SpreadsheetApp: { getActiveSpreadsheet: () => book } });

  const first = plain(JSON.parse(ctx.doGet({ parameter: { action: 'items' } }).body));
  assert.equal(first.items.length, 3000);
  assert.equal(state.reads, 1);

  const meta = JSON.parse(cache.get('items_v1_meta'));
  assert.ok(meta.chunks > 1, 'expected more than one cache chunk');
  cache.remove('items_v1_1');

  const second = plain(JSON.parse(ctx.doGet({ parameter: { action: 'items' } }).body));
  assert.equal(second.success, true);
  assert.equal(second.items.length, 3000);
  assert.equal(state.reads, 2, 'cache miss must re-read the sheets');
});

