/**
 * Pure search / formatting helpers. No DOM, no globals — unit tested with
 * `node --test` (see tests/search.test.js).
 *
 * @typedef {{ id:string, sheet:string, barcode:string, name:string, brand:string,
 *   serial:string, price:string, date:string, warranty:string, status:string,
 *   condition:string, reference:string, location:string, category:string,
 *   image:string }} Item
 */

/** Lowercase and strip spaces and punctuation so formatting never blocks a match. */
export function normalize(value) {
  return String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\-_/.,()#:]+/g, '');
}

/**
 * Collapse the many status wordings found in the sheet into one key.
 * @returns {'using'|'broken'|'repair'|'lost'|'standby'|'none'|'other'}
 */
export function statusKey(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'none';
  if (s === 'ใช้งาน' || s === 'ปกติ') return 'using';
  if (s.includes('ซ่อม')) return 'repair';
  if (s.includes('สูญหาย') || s.includes('ตามหา')) return 'lost';
  if (s.includes('ชำรุด')) return 'broken';
  if (normalize(s).includes('standby')) return 'standby';
  return 'other';
}

/**
 * Parse dd/MM/yyyy in CE, Buddhist Era or 2-digit-year form.
 * @returns {number|null} epoch ms (UTC midnight) or null when unparseable
 */
export function parseDate(value) {
  const s = String(value ?? '').replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;

  let year = Number(m[3]);
  if (m[3].length === 2) year = 2000 + year;
  else if (year > 2400) year -= 543;

  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return Date.UTC(year, month - 1, day);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text before it is placed inside an HTML string. */
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

/** Only https image URLs are allowed through. */
export function safeImageUrl(url) {
  const s = String(url ?? '').trim();
  return s.startsWith('https://') ? s : '';
}

const HAYSTACK_FIELDS = [
  'barcode', 'name', 'brand', 'serial', 'location',
  'category', 'reference', 'status', 'condition', 'sheet',
];

function haystackOf(item) {
  return HAYSTACK_FIELDS.map(f => normalize(item[f])).join('|');
}

function compareName(a, b) {
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'th');
}

function scoreOf(item, normalizedQuery, tokens) {
  const barcode = normalize(item.barcode);
  const name = normalize(item.name);
  if (barcode && normalizedQuery && barcode.startsWith(normalizedQuery)) return 80;
  if (name && tokens[0] && name.startsWith(tokens[0])) return 60;
  if (name && tokens.every(t => name.includes(t))) return 40;
  return 20;
}

/**
 * Filter + rank items in memory.
 * @param {Item[]} items
 * @param {{query?:string, sheet?:string, status?:string}} [opts]
 * @returns {{results: Item[], exactBarcode: boolean}}
 */
export function searchItems(items, { query = '', sheet = 'all', status = 'all' } = {}) {
  const list = (items || []).filter(item =>
    (sheet === 'all' || item.sheet === sheet) &&
    (status === 'all' || statusKey(item.status) === status));

  const text = String(query ?? '').trim();

  if (!text) {
    return { results: list.slice().sort(compareName), exactBarcode: false };
  }

  const normalizedQuery = normalize(text);

  // 1. Exact barcode wins outright (scanner path).
  const exact = list.filter(item => {
    const bc = normalize(item.barcode);
    return bc !== '' && bc === normalizedQuery;
  });
  if (exact.length) {
    return { results: exact, exactBarcode: true };
  }

  // 2. Every whitespace token must appear somewhere in the item.
  const tokens = text.split(/\s+/).map(normalize).filter(Boolean);
  const scored = [];
  list.forEach(item => {
    const hay = haystackOf(item);
    if (!tokens.every(token => hay.includes(token))) return;
    scored.push({ item, score: scoreOf(item, normalizedQuery, tokens) });
  });

  scored.sort((a, b) => (b.score - a.score) || compareName(a.item, b.item));
  return { results: scored.map(entry => entry.item), exactBarcode: false };
}

/** Count items per key. */
export function countBy(items, keyFn) {
  const out = {};
  (items || []).forEach(item => {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}
