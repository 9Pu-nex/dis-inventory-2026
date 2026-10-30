import test from 'node:test';
import assert from 'node:assert/strict';

import { loadItems, readCache, API_URL, CACHE_KEY, CACHE_TTL_MS } from '../js/data.js';

const NOW = Date.UTC(2026, 9, 30, 4, 0, 0);

const payload = {
  success: true,
  updatedAt: '2026-10-30T03:00:00.000Z',
  items: [{ id: 'IT:2', sheet: 'IT', barcode: 'DEC20010100001', name: 'Chair' }],
};

function fakeStorage(initial) {
  const map = new Map();
  if (initial !== undefined) map.set(CACHE_KEY, JSON.stringify(initial));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** fetch spy that resolves with a JSON payload and counts calls. */
function jsonFetch(body = payload) {
  const fn = async () => ({ ok: true, json: async () => body });
  fn.calls = 0;
  const wrapped = (...args) => { fn.calls++; return fn(...args); };
  wrapped.count = () => fn.calls;
  return wrapped;
}

const freshCache = () => ({ savedAt: NOW, updatedAt: '2026-10-29T00:00:00.000Z', items: [{ id: 'OLD:1' }] });

test('API_URL points at the production deployment', () => {
  assert.match(API_URL, /^https:\/\/script\.google\.com\/macros\/s\/AKfycbzWO17Ys0l6DVBlb6saYm1i5krAVZjVjlPD1plCDEAqrKg4-h3nEXWqlWsOOUAdmxw\/exec$/);
});

test('fresh cache is returned without fetching', async () => {
  const storage = fakeStorage(freshCache());
  const fetchImpl = jsonFetch();
  const out = await loadItems({ storage, fetchImpl, now: () => NOW });
  assert.equal(fetchImpl.count(), 0);
  assert.equal(out.fromCache, true);
  assert.equal(out.stale, false);
  assert.equal(out.items[0].id, 'OLD:1');
});

test('force bypasses fresh cache', async () => {
  const storage = fakeStorage(freshCache());
  const fetchImpl = jsonFetch();
  const out = await loadItems({ storage, fetchImpl, now: () => NOW, force: true });
  assert.equal(fetchImpl.count(), 1);
  assert.equal(out.fromCache, false);
  assert.equal(out.items[0].id, 'IT:2');
});

test('success writes cache', async () => {
  const storage = fakeStorage();
  await loadItems({ storage, fetchImpl: jsonFetch(), now: () => NOW });
  const cached = JSON.parse(storage.getItem(CACHE_KEY));
  assert.equal(cached.items.length, 1);
  assert.equal(cached.savedAt, NOW);
  assert.equal(cached.updatedAt, payload.updatedAt);
});

test('timeout rejects with message "timeout" when no cache', async () => {
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  await assert.rejects(
    loadItems({ storage: fakeStorage(), fetchImpl, now: () => NOW, timeoutMs: 10 }),
    (err) => err.message === 'timeout',
  );
});

test('html response rejects with "parse"', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => { throw new SyntaxError('Unexpected token <'); },
  });
  await assert.rejects(
    loadItems({ storage: fakeStorage(), fetchImpl, now: () => NOW }),
    (err) => err.message === 'parse',
  );
});

test('http error rejects with "http"', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(
    loadItems({ storage: fakeStorage(), fetchImpl, now: () => NOW }),
    (err) => err.message === 'http',
  );
});

test('success:false rejects with "api"', async () => {
  const fetchImpl = jsonFetch({ success: false, error: 'boom' });
  await assert.rejects(
    loadItems({ storage: fakeStorage(), fetchImpl, now: () => NOW }),
    (err) => err.message === 'api',
  );
});

test('failure with old cache returns stale', async () => {
  const oldCache = { savedAt: NOW - CACHE_TTL_MS - 1000, updatedAt: '2026-10-01T00:00:00.000Z', items: [{ id: 'OLD:1' }] };
  const storage = fakeStorage(oldCache);
  const fetchImpl = async () => { throw new Error('network down'); };
  const out = await loadItems({ storage, fetchImpl, now: () => NOW });
  assert.equal(out.stale, true);
  assert.equal(out.fromCache, true);
  assert.deepEqual(out.items, oldCache.items);
});

test('storage quota error does not throw', async () => {
  const storage = {
    getItem: () => null,
    setItem: () => { const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err; },
    removeItem: () => {},
  };
  const out = await loadItems({ storage, fetchImpl: jsonFetch(), now: () => NOW });
  assert.equal(out.fromCache, false);
  assert.equal(out.items.length, 1);
});

test('readCache tolerates garbage', () => {
  assert.equal(readCache(fakeStorage()), null);
  const broken = { getItem: () => 'not json', setItem: () => {}, removeItem: () => {} };
  assert.equal(readCache(broken), null);
});
