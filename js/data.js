/**
 * Load-once data layer: fetch every item in one request, keep it in
 * sessionStorage for 5 minutes, and fall back to saved data when the
 * Apps Script endpoint is slow, broken or returns HTML.
 */

export const API_URL = 'https://script.google.com/macros/s/AKfycbzWO17Ys0l6DVBlb6saYm1i5krAVZjVjlPD1plCDEAqrKg4-h3nEXWqlWsOOUAdmxw/exec';
export const CACHE_KEY = 'dis-inv-items-v1';
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const MOCK_URL = 'tests/fixtures/items.json';

function defaultStorage() {
  try {
    return globalThis.sessionStorage;
  } catch (err) {
    return null;
  }
}

/** `?api=<url>` points the app at a staging backend or a local proxy. */
function apiOverrideFrom(search) {
  try {
    const value = new URLSearchParams(search).get('api');
    if (!value) return '';
    const trimmed = value.trim();
    if (!/^(https?:\/\/|\/)/.test(trimmed)) return '';
    return trimmed.includes('?') ? trimmed : `${trimmed}?action=items`;
  } catch (err) {
    return '';
  }
}

function resolveUrl(url) {
  if (url) return url;
  const loc = globalThis.location;
  const search = loc ? String(loc.search || '') : '';
  if (search.includes('mock=1')) return MOCK_URL;
  const override = apiOverrideFrom(search);
  if (override) return override;
  return `${API_URL}?action=items`;
}

/**
 * @param {Storage} storage
 * @returns {{savedAt:number, updatedAt:string, items:Array}|null}
 */
export function readCache(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function writeCache(storage, payload, savedAt) {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({
      savedAt: savedAt,
      updatedAt: payload.updatedAt || '',
      items: payload.items,
    }));
  } catch (err) {
    // Quota exceeded or private mode — caching is best effort.
  }
}

/**
 * Fetch with a hard timeout and normalized error codes.
 * @returns {Promise<{updatedAt:string, items:Array}>}
 */
async function fetchItems(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  let timer = null;

  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      fetchImpl(url, { signal: controller.signal, cache: 'no-store' }).then(resolve, reject);
    });

    if (!response || response.ok === false) throw new Error('http');

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error('parse');
    }

    if (!payload || payload.success !== true || !Array.isArray(payload.items)) {
      throw new Error('api');
    }

    return { updatedAt: payload.updatedAt || '', items: payload.items };
  } catch (err) {
    if (controller.signal.aborted) throw new Error('timeout');
    const code = err && err.message;
    if (code === 'http' || code === 'parse' || code === 'api' || code === 'timeout') throw err;
    throw new Error('http');
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * loadItems — cache-first, with background revalidation left to the caller.
 * @param {{force?:boolean, fetchImpl?:Function, storage?:Storage,
 *   now?:()=>number, url?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<{items:Array, updatedAt:string, fromCache:boolean, stale:boolean}>}
 */
export async function loadItems({
  force = false,
  fetchImpl = globalThis.fetch,
  storage = defaultStorage(),
  now = Date.now,
  url,
  timeoutMs = 20000,
} = {}) {
  const cached = readCache(storage);

  if (!force && cached && (now() - cached.savedAt) < CACHE_TTL_MS) {
    return { items: cached.items, updatedAt: cached.updatedAt, fromCache: true, stale: false };
  }

  try {
    const payload = await fetchItems(fetchImpl, resolveUrl(url), timeoutMs);
    writeCache(storage, payload, now());
    return { items: payload.items, updatedAt: payload.updatedAt, fromCache: false, stale: false };
  } catch (err) {
    if (cached) {
      return { items: cached.items, updatedAt: cached.updatedAt, fromCache: true, stale: true };
    }
    throw err;
  }
}
