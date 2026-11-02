const SHEETS = [
  'IT',
  'DEC_Appliance',
  'DIS_Appliance',
  'Vehicle',
  'Health and Medical Equipment',
  'Sport',
  'DIS_Kitchen',
  'Furniture DEC',
  'Furniture DIS'
];

// Fallback image column index per sheet (A=0, B=1, ... N=13, O=14).
// Only used when no header resolves to the image field.
const IMAGE_COL_FALLBACK = {
  'IT': 14,             // Column O
  'Furniture DEC': 14,  // Column O
};
const IMAGE_COL_FALLBACK_DEFAULT = 13; // Column N

// Column mapping table: field -> candidate header keys, in priority order.
// Each field claims at most one column and never reuses a claimed one.
const FIELD_KEYS = [
  ['barcode',   ['barcode', 'เลขครุภัณฑ์', 'เลขบาร์']],
  ['serial',    ['serial', 'ซีเรียล']],
  ['warranty',  ['รับประกัน', 'warranty']],
  ['location',  ['สถานที่', 'location', 'ผู้ใช้']],
  ['name',      ['ชื่อครุภัณฑ์', 'name', 'ชื่อ']],
  ['brand',     ['ยี่ห้อ', 'brand']],
  ['price',     ['ราคา', 'price']],
  ['date',      ['วันที่', 'date', 'วัน']],
  ['status',    ['สถานะ', 'status']],
  ['condition', ['สภาพ', 'condition']],
  ['reference', ['อ้างอิง', 'reference']],
  ['category',  ['ประเภท', 'category', 'สังกัด']],
  ['image',     ['รูป', 'image', 'photo', 'picture']],
];

// Convert ANY Google Drive URL format to a direct image URL
function convertDriveUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  if (!url.startsWith('http')) return '';

  let fileId = '';

  // Format 1: /file/d/FILE_ID/view  (most common share link)
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) fileId = m[1];

  // Format 2: open?id=FILE_ID
  if (!fileId) {
    m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) fileId = m[1];
  }

  // Format 3: uc?export=view&id=FILE_ID  (already correct)
  if (!fileId) {
    m = url.match(/uc\?.*id=([a-zA-Z0-9_-]+)/);
    if (m) fileId = m[1];
  }

  // Format 4: /d/FILE_ID/  (short links)
  if (!fileId) {
    m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) fileId = m[1];
  }

  // Format 5: thumbnail?id=FILE_ID
  if (!fileId) {
    m = url.match(/thumbnail\?.*id=([a-zA-Z0-9_-]+)/);
    if (m) fileId = m[1];
  }

  // If we found a file ID → convert to direct view URL
  if (fileId) {
    return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
  }

  // Not a Google Drive URL — return as-is (works for Imgur, etc.)
  return url;
}

/**
 * Resolve every field to exactly one header index (or -1).
 * Three passes over unclaimed headers: exact match, then startsWith, then
 * includes. In each pass the candidate keys are tried in FIELD_KEYS order.
 * @param {Array} headers raw header row
 * @return {Object<string, number>} field -> column index (-1 when unmapped)
 */
function buildColumnMap(headers) {
  const norm = headers.map(h => String(h === null || h === undefined ? '' : h).trim().toLowerCase());
  const claimed = {};
  const map = {};

  const match = (pass, key) => {
    for (let i = 0; i < norm.length; i++) {
      if (claimed[i]) continue;
      const h = norm[i];
      if (!h) continue;
      if (pass === 0 && h === key) return i;
      if (pass === 1 && h.startsWith(key)) return i;
      if (pass === 2 && h.includes(key)) return i;
    }
    return -1;
  };

  FIELD_KEYS.forEach(entry => {
    const field = entry[0];
    const keys = entry[1];
    let idx = -1;
    for (let pass = 0; pass < 3 && idx === -1; pass++) {
      for (let k = 0; k < keys.length; k++) {
        idx = match(pass, keys[k].toLowerCase());
        if (idx !== -1) break;
      }
    }
    if (idx !== -1) claimed[idx] = true;
    map[field] = idx;
  });

  return map;
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'getAll';
    const query = (params.query || '').trim();
    const sheet = params.sheet || 'all';

    let result;
    if (action === 'search') {
      result = searchItems(query, sheet);
    } else if (action === 'items') {
      result = Object.assign({ success: true }, getItemsCached());
    } else if (action === 'getSheets') {
      result = { sheets: SHEETS };
    } else {
      result = getAllItems(sheet);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getAllItems(sheetFilter) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = {};
  const sheetsToRead = sheetFilter === 'all' ? SHEETS : SHEETS.filter(s => s === sheetFilter);
  sheetsToRead.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    data[sheetName] = readSheet(sheet, sheetName);
  });
  return { success: true, data };
}

function searchItems(query, sheetFilter) {
  if (!query) return { success: true, results: [], exactMatch: false };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const queryLower = query.toLowerCase();
  const sheetsToSearch = sheetFilter === 'all' ? SHEETS : SHEETS.filter(s => s === sheetFilter);

  // First pass — exact barcode match
  for (const sheetName of sheetsToSearch) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    const items = readSheet(sheet, sheetName);
    const exactMatch = items.find(item =>
      item.barcode && item.barcode.toLowerCase() === queryLower
    );
    if (exactMatch) {
      return { success: true, results: [exactMatch], exactMatch: true };
    }
  }

  // Second pass — name, brand, location only (no serial)
  const results = [];
  for (const sheetName of sheetsToSearch) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    const items = readSheet(sheet, sheetName);
    items.forEach(item => {
      const searchable = [item.name, item.brand, item.location].join(' ').toLowerCase();
      if (searchable.includes(queryLower)) results.push(item);
    });
  }

  return { success: true, results, exactMatch: false };
}

/**
 * Decide whether a data row should be skipped before mapping.
 * @return {'ok'|'blank'|'header'}
 */
function classifyRow(row, colMap, headerBarcode) {
  if (row.every(cell => cell === '' || cell === null || cell === undefined)) return 'blank';

  const barcodeCol = colMap ? colMap.barcode : -1;
  if (barcodeCol >= 0 && barcodeCol < row.length) {
    const raw = row[barcodeCol];
    const cellBarcode = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    if (cellBarcode && cellBarcode === 'barcode') return 'header';
    if (cellBarcode && headerBarcode && cellBarcode === headerBarcode) return 'header';
  }
  return 'ok';
}

function readSheet(sheet, sheetName) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];

  const colMap = buildColumnMap(rows[0]);
  if (!colMap.image || colMap.image === -1) {
    colMap.image = IMAGE_COL_FALLBACK[sheetName] !== undefined
      ? IMAGE_COL_FALLBACK[sheetName]
      : IMAGE_COL_FALLBACK_DEFAULT;
  }

  const barcodeCol = colMap.barcode;
  const headerBarcode = (barcodeCol >= 0 && barcodeCol < rows[0].length)
    ? String(rows[0][barcodeCol] === null || rows[0][barcodeCol] === undefined ? '' : rows[0][barcodeCol]).trim().toLowerCase()
    : '';

  const items = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (classifyRow(row, colMap, headerBarcode) !== 'ok') continue;

    const item = mapRow(row, colMap, sheetName, i + 1);
    if (!item.barcode && !item.name) continue;
    items.push(item);
  }
  return items;
}

function formatDateValue(val) {
  if (val === '' || val === null || val === undefined) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  if (typeof val === 'number' && val > 40000) {
    const date = new Date((val - 25569) * 86400 * 1000);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(val).trim();
}

function formatPriceValue(val) {
  if (val === '' || val === null || val === undefined) return '';
  const num = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return '';
  return num.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Map one sheet row to an Item. Reads exactly row[colMap[field]] and never
 * falls back to another column when a cell is empty.
 */
function mapRow(row, colMap, sheetName, rowNumber) {
  const raw = (field) => {
    const idx = colMap ? colMap[field] : -1;
    if (idx === undefined || idx === null || idx < 0 || idx >= row.length) return '';
    return row[idx];
  };
  const text = (field) => {
    const val = raw(field);
    if (val === '' || val === null || val === undefined) return '';
    return String(val).trim();
  };

  const rawImage = text('image');

  return {
    id:        sheetName + ':' + rowNumber,
    sheet:     sheetName,
    barcode:   text('barcode'),
    name:      text('name'),
    brand:     text('brand'),
    serial:    text('serial'),
    price:     formatPriceValue(raw('price')),
    date:      formatDateValue(raw('date')),
    warranty:  text('warranty'),
    status:    text('status'),
    condition: text('condition'),
    reference: text('reference'),
    location:  text('location'),
    category:  text('category'),
    image:     rawImage ? convertDriveUrl(rawImage) : '',
  };
}

/** Diagnostic helper: log every sheet's headers and its resolved column map. */
function logHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(sheet => {
    const rows = sheet.getDataRange().getValues();
    const headers = rows.length ? rows[0] : [];
    Logger.log(JSON.stringify({
      sheet: sheet.getName(),
      rows: Math.max(rows.length - 1, 0),
      headers: headers.map(h => String(h === null || h === undefined ? '' : h).trim()),
      map: buildColumnMap(headers),
    }));
  });
}

/**
 * Diagnostic helper: why rows are missing from the app.
 * Logs, per configured sheet: kept rows, skipped rows (with reason and a sample),
 * and any sheet in the file that the app does not read at all.
 * Run from the Apps Script editor — no deploy needed.
 */
function auditSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  SHEETS.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(JSON.stringify({ sheet: sheetName, missing: true }));
      return;
    }

    const rows = sheet.getDataRange().getValues();
    const colMap = buildColumnMap(rows[0] || []);
    const barcodeCol = colMap.barcode;
    const headerBarcode = (barcodeCol >= 0 && barcodeCol < (rows[0] || []).length)
      ? String(rows[0][barcodeCol] === null || rows[0][barcodeCol] === undefined ? '' : rows[0][barcodeCol]).trim().toLowerCase()
      : '';

    let kept = 0;
    const skipped = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const verdict = classifyRow(row, colMap, headerBarcode);
      if (verdict !== 'ok') {
        skipped.push({ row: i + 1, why: verdict });
        continue;
      }
      const item = mapRow(row, colMap, sheetName, i + 1);
      if (!item.barcode && !item.name) {
        skipped.push({
          row: i + 1,
          why: 'no barcode and no name',
          sample: row.slice(0, 6).map(v => String(v === null || v === undefined ? '' : v).slice(0, 24)),
        });
        continue;
      }
      if (!item.name) {
        skipped.push({ row: i + 1, why: 'empty name (kept, shows as No name)', barcode: item.barcode });
        kept++;
        continue;
      }
      kept++;
    }

    Logger.log(JSON.stringify({
      sheet: sheetName,
      dataRows: Math.max(rows.length - 1, 0),
      kept: kept,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 15),
    }));
  });

  const extras = ss.getSheets()
    .map(s => ({ name: s.getName(), rows: Math.max(s.getDataRange().getValues().length - 1, 0) }))
    .filter(s => SHEETS.indexOf(s.name) === -1);
  Logger.log(JSON.stringify({ notReadByApp: extras }));
}


// ── Cached flat item list (`?action=items`) ─────────────────────────────────
// The payload is gzipped, base64-encoded and split into <90k-char chunks
// because a script cache entry holds at most 100 KB.

const ITEMS_CACHE_PREFIX = 'items_v1';
const ITEMS_CACHE_META = 'items_v1_meta';
const ITEMS_CACHE_TTL = 1800;        // seconds
const ITEMS_CACHE_CHUNK = 90000;     // chars per cache entry

function splitChunks(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) {
    out.push(str.slice(i, i + size));
  }
  return out.length ? out : [''];
}

function getItemsCached() {
  const cache = CacheService.getScriptCache();
  const metaRaw = cache.get(ITEMS_CACHE_META);

  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw);
      const count = meta.chunks || 0;
      const keys = [];
      for (let i = 0; i < count; i++) keys.push(ITEMS_CACHE_PREFIX + '_' + i);
      const parts = keys.length ? cache.getAll(keys) : {};

      let complete = count > 0;
      const pieces = [];
      for (let i = 0; i < count; i++) {
        const piece = parts[keys[i]];
        if (piece === undefined || piece === null || piece === '') {
          complete = false;
          break;
        }
        pieces.push(piece);
      }

      if (complete) {
        const gzBlob = Utilities.newBlob(Utilities.base64Decode(pieces.join('')), 'application/x-gzip');
        const payload = JSON.parse(Utilities.ungzip(gzBlob).getDataAsString('UTF-8'));
        if (payload && payload.items) {
          return { updatedAt: payload.updatedAt, items: payload.items };
        }
      }
    } catch (err) {
      // Corrupt or unreadable cache — fall through and rebuild.
    }
  }

  return buildItemsCache();
}

function buildItemsCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const items = [];

  SHEETS.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    readSheet(sheet, sheetName).forEach(item => items.push(item));
  });

  const updatedAt = new Date().toISOString();
  const json = JSON.stringify({ updatedAt: updatedAt, items: items });

  const cache = CacheService.getScriptCache();
  const gzBlob = Utilities.gzip(Utilities.newBlob(json, 'application/json'));
  const encoded = Utilities.base64Encode(gzBlob.getBytes());
  const chunks = splitChunks(encoded, ITEMS_CACHE_CHUNK);

  const values = {};
  for (let i = 0; i < chunks.length; i++) {
    values[ITEMS_CACHE_PREFIX + '_' + i] = chunks[i];
  }
  cache.putAll(values, ITEMS_CACHE_TTL);
  // Meta is written last so a half-written cache is never read.
  cache.put(ITEMS_CACHE_META, JSON.stringify({ chunks: chunks.length, updatedAt: updatedAt }), ITEMS_CACHE_TTL);

  return { updatedAt: updatedAt, items: items };
}

/** Drop the meta key; orphaned chunks expire on their own. */
function clearItemsCache() {
  CacheService.getScriptCache().remove(ITEMS_CACHE_META);
}

/** Simple installable/simple trigger: a sheet edit invalidates the cache. */
function onEdit(e) {
  clearItemsCache();
}

