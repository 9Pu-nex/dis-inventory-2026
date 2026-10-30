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

// Image column index per sheet (A=0, B=1, ... N=13, O=14)
const IMAGE_COL = {
  'IT':                           14,  // Column O
  'DEC_Appliance':                13,  // Column N
  'DIS_Appliance':                13,  // Column N
  'Vehicle':                      13,  // Column N
  'Health and Medical Equipment': 13,  // Column N
  'Sport':                        13,  // Column N
  'DIS_Kitchen':                  13,  // Column N
  'Furniture DEC':                14,  // Column O
  'Furniture DIS':                13,  // Column N
};

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

function doGet(e) {
  const params = e.parameter;
  const action = params.action || 'getAll';
  const query = (params.query || '').trim();
  const sheet = params.sheet || 'all';

  let result;
  if (action === 'search') {
    result = searchItems(query, sheet);
  } else if (action === 'getSheets') {
    result = { sheets: SHEETS };
  } else {
    result = getAllItems(sheet);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
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

function readSheet(sheet, sheetName) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const imageColIdx = IMAGE_COL[sheetName] !== undefined ? IMAGE_COL[sheetName] : -1;
  const items = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(cell => cell === '' || cell === null || cell === undefined)) continue;
    const item = mapRow(headers, row, sheetName, imageColIdx);
    if (!item.barcode && !item.name) continue;
    items.push(item);
  }
  return items;
}

function mapRow(headers, row, sheetName, imageColIdx) {
  const get = (keys) => {
    for (const key of keys) {
      const idx = headers.findIndex(h => h.includes(key));
      if (idx !== -1 && row[idx] !== '' && row[idx] !== null && row[idx] !== undefined) {
        return String(row[idx]).trim();
      }
    }
    return '';
  };

  const formatDate = (val) => {
    if (!val) return '';
    if (val instanceof Date) {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    }
    if (typeof val === 'number' && val > 40000) {
      const date = new Date((val - 25569) * 86400 * 1000);
      return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    }
    return String(val).trim();
  };

  const dateRaw = (() => {
    const keys = ['วันที่', 'date', 'วัน'];
    for (const key of keys) {
      const idx = headers.findIndex(h => h.includes(key));
      if (idx !== -1 && row[idx] !== '' && row[idx] !== null) return row[idx];
    }
    return '';
  })();

  const priceRaw = (() => {
    const keys = ['ราคา', 'price'];
    for (const key of keys) {
      const idx = headers.findIndex(h => h.includes(key));
      if (idx !== -1 && row[idx] !== '' && row[idx] !== null) {
        const val = parseFloat(String(row[idx]).replace(/,/g, ''));
        return isNaN(val) ? '' : val.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      }
    }
    return '';
  })();

  // Read image from fixed column, convert any Drive URL format
  let imageUrl = '';
  if (imageColIdx >= 0 && imageColIdx < row.length) {
    const rawImg = row[imageColIdx];
    if (rawImg && typeof rawImg === 'string' && rawImg.trim() !== '') {
      imageUrl = convertDriveUrl(rawImg.trim());
    }
  }

  return {
    sheet:     sheetName,
    barcode:   get(['barcode', 'เลขครุภัณฑ์', 'เลขบาร์']),
    name:      get(['ชื่อครุภัณฑ์', 'name', 'ชื่อ']),
    brand:     get(['ยี่ห้อ', 'brand']),
    serial:    get(['serial', 'ซีเรียล']),
    price:     priceRaw,
    date:      formatDate(dateRaw),
    warranty:  get(['รับประกัน', 'warranty']),
    status:    get(['สถานะ', 'status']),
    condition: get(['สภาพ', 'condition']),
    reference: get(['อ้างอิง', 'reference']),
    location:  get(['สถานที่', 'location', 'ผู้ใช้']),
    image:     imageUrl,
    category:  get(['ประเภท', 'category', 'สังกัด']),
  };
}