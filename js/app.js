import { loadItems, readCache } from './data.js';
import { statusKey, safeImageUrl, countBy, searchItems, sortItems } from './search.js';
import { STRINGS, STATUS, STATUS_ORDER, CONDITION, SHEETS, sheetLabel } from './i18n.js';

const PAGE_SIZE = 60;
const DEBOUNCE_MS = 150;
const LS_LANG = 'dis-lang';
const LS_VIEW = 'dis-view';
const LS_THEME = 'dis-theme';

const state = {
  items: [],
  sorted: [],
  lang: 'en',
  sheet: 'all',
  status: 'all',
  query: '',
  page: 1,
  view: 'grid',
  sort: '',
  updatedAt: '',
  hasData: false,
  errorCode: '',
};

let debounceTimer = null;
let lastFocus = null;
let observer = null;
let toastTimer = null;

const $ = (id) => document.getElementById(id);

function t(key) {
  const table = STRINGS[state.lang] || STRINGS.en;
  return table[key] !== undefined ? table[key] : STRINGS.en[key];
}

function readLS(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    /* private mode — preference just will not persist */
  }
}

function safeSession() {
  try {
    return globalThis.sessionStorage;
  } catch (err) {
    return null;
  }
}

/* ── Status helpers ─────────────────────────────────────────────────────── */

function statusLabel(item) {
  const key = statusKey(item.status);
  if (key === 'other') {
    const raw = String(item.status || '').trim();
    return raw || STRINGS[state.lang].statusAll;
  }
  const entry = STATUS[key];
  return entry ? (entry[state.lang] || entry.en) : '';
}

function statusClass(item) {
  const key = statusKey(item.status);
  return key === 'other' ? 'other' : key;
}

function badgeClass(item) {
  const key = statusKey(item.status);
  return key === 'using' || key === 'broken' || key === 'repair' || key === 'lost' || key === 'standby'
    ? `badge badge-${key}`
    : 'badge';
}

function conditionLabel(item) {
  const raw = String(item.condition || '').trim();
  if (!raw) return '';
  const entry = CONDITION[raw];
  return entry ? (entry[state.lang] || entry.en) : raw;
}

/* ── Icons ──────────────────────────────────────────────────────────────── */

function getItemIcon(item) {
  const n = (item.name || '').toLowerCase();
  const s = (item.sheet || '').toLowerCase();
  if (s.includes('vehicle')) return '🚗';
  if (s.includes('health') || s.includes('medical')) return '🏥';
  if (s.includes('sport')) return '⚽';
  if (s.includes('kitchen')) return '🍳';
  if (s.includes('furniture')) return '🪑';
  if (s.includes('appliance')) return '📺';
  if (n.includes('laptop') || n.includes('notebook') || n.includes('macbook')) return '💻';
  if (n.includes('tablet')) return '📱';
  if (n.includes('phone')) return '📱';
  if (n.includes('printer') || n.includes('print')) return '🖨️';
  if (n.includes('monitor') || n.includes('display') || n.includes(' led')) return '🖥️';
  if (n.includes('camera') || n.includes('cctv')) return '📷';
  if (n.includes('mouse')) return '🖱️';
  if (n.includes('keyboard')) return '⌨️';
  if (n.includes('headphone') || n.includes('earphone')) return '🎧';
  if (n.includes('speaker') || n.includes('ลำโพง')) return '🔊';
  if (n.includes('air') || n.includes('แอร์')) return '❄️';
  if (n.includes('washing') || n.includes('ซักผ้า')) return '🧺';
  if (n.includes('fridge') || n.includes('ตู้เย็น')) return '🧊';
  if (n.includes('chair') || n.includes('เก้าอี้')) return '🪑';
  if (n.includes('table') || n.includes('โต๊ะ')) return '🪑';
  if (n.includes('board') || n.includes('กระดาน')) return '📋';
  return '📦';
}

function iconElement(item, extraClass) {
  const span = document.createElement('span');
  span.className = 'no-img' + (extraClass ? ` ${extraClass}` : '');
  span.textContent = getItemIcon(item);
  return span;
}

/* ── Static labels / language ───────────────────────────────────────────── */

function applyLang() {
  document.documentElement.lang = state.lang === 'th' ? 'th' : 'en';

  $('logo-text').textContent = t('logoText');
  $('logo-sub').textContent = t('logoSub');

  const input = $('search-input');
  input.placeholder = t('searchPlaceholder');
  input.setAttribute('aria-label', t('searchPlaceholder'));
  $('search-clear').setAttribute('aria-label', t('clearSearch'));

  document.querySelectorAll('.lang-btn').forEach(btn => {
    const active = btn.dataset.lang === state.lang;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  $('dashboard-title').textContent = t('dashboardTitle');
  $('dashboard-status').textContent = t('dashboardStatus');
  $('dashboard-sheets').textContent = t('dashboardSheets');
  $('sort-label').textContent = t('sortLabel');
  $('retry-btn').textContent = t('retry');
  $('empty-title').textContent = t('noResultsTitle');
  $('empty-sub').textContent = t('noResultsSub');
  $('stale-note').textContent = t('staleNote');
  $('detail-close').setAttribute('aria-label', t('close'));
  $('detail-img-btn').setAttribute('aria-label', t('zoomImage'));

  updateThemeLabel();
  updateViewLabel();
  $('refresh-btn').setAttribute('aria-label', t('refresh'));

  renderSortOptions();
  if (state.errorCode) $('error-text').textContent = errorMessage(state.errorCode);
  renderAll();
}

function updateThemeLabel() {
  const dark = document.documentElement.dataset.theme !== 'light';
  $('theme-toggle').setAttribute('aria-label', dark ? t('themeToLight') : t('themeToDark'));
}

function updateViewLabel() {
  $('view-toggle').setAttribute('aria-label', state.view === 'grid' ? t('viewList') : t('viewGrid'));
  $('view-toggle').setAttribute('title', state.view === 'grid' ? t('viewList') : t('viewGrid'));
}

/* ── Tabs / chips / dashboard ───────────────────────────────────────────── */

function countFor(patch) {
  return searchItems(state.items, {
    query: state.query,
    sheet: state.sheet,
    status: state.status,
    ...patch,
  }).results.length;
}

function renderTabs() {
  const bar = $('tabs-bar');
  bar.replaceChildren();

  const makeTab = (id, label, count) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab' + (state.sheet === id ? ' active' : '');
    btn.dataset.sheet = id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', state.sheet === id ? 'true' : 'false');
    btn.textContent = `${label} (${count})`;
    btn.addEventListener('click', () => {
      state.sheet = id;
      state.page = 1;
      renderAll();
    });
    return btn;
  };

  bar.appendChild(makeTab('all', state.lang === 'th' ? 'ทั้งหมด' : 'All', countFor({ sheet: 'all' })));
  SHEETS.forEach(sheet => {
    bar.appendChild(makeTab(sheet.id, sheet[state.lang] || sheet.en, countFor({ sheet: sheet.id })));
  });
}

function renderChips() {
  const wrap = $('filters-wrap');
  wrap.replaceChildren();

  const makeChip = (key, label, count) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (state.status === key ? ' active' : '') + (count === 0 ? ' count-0' : '');
    btn.dataset.key = key;
    btn.setAttribute('aria-pressed', state.status === key ? 'true' : 'false');
    btn.textContent = `${label} (${count})`;
    btn.addEventListener('click', () => {
      state.status = key;
      state.page = 1;
      renderAll();
    });
    return btn;
  };

  wrap.appendChild(makeChip('all', t('statusAll'), countFor({ status: 'all' })));
  STATUS_ORDER.forEach(key => {
    const count = countFor({ status: key });
    if (count === 0 && state.status !== key) return;
    wrap.appendChild(makeChip(key, STATUS[key][state.lang] || STATUS[key].en, count));
  });
}

function shouldShowDashboard() {
  return state.hasData && !state.query && state.sheet === 'all' && state.status === 'all';
}

function renderDashboard() {
  const statusWrap = $('dash-status');
  const sheetWrap = $('dash-sheets');
  statusWrap.replaceChildren();
  sheetWrap.replaceChildren();

  const statusCounts = countBy(state.items, item => statusKey(item.status));
  STATUS_ORDER.forEach(key => {
    const count = statusCounts[key] || 0;
    if (!count) return;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `dash-tile tile-${key}`;
    const num = document.createElement('span');
    num.className = 'dash-tile-num';
    num.textContent = String(count);
    const label = document.createElement('span');
    label.className = 'dash-tile-label';
    label.textContent = STATUS[key][state.lang] || STATUS[key].en;
    tile.append(num, label);
    tile.addEventListener('click', () => {
      state.status = key;
      state.page = 1;
      renderAll();
    });
    statusWrap.appendChild(tile);
  });

  const sheetCounts = countBy(state.items, item => item.sheet);
  SHEETS.forEach(sheet => {
    const count = sheetCounts[sheet.id] || 0;
    if (!count) return;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'dash-tile';
    const num = document.createElement('span');
    num.className = 'dash-tile-num';
    num.textContent = String(count);
    const label = document.createElement('span');
    label.className = 'dash-tile-label';
    label.textContent = sheet[state.lang] || sheet.en;
    tile.append(num, label);
    tile.addEventListener('click', () => {
      state.sheet = sheet.id;
      state.page = 1;
      renderAll();
    });
    sheetWrap.appendChild(tile);
  });

  const updated = $('updated-at');
  if (state.updatedAt) {
    const when = new Date(state.updatedAt);
    const text = Number.isNaN(when.getTime())
      ? state.updatedAt
      : when.toLocaleString(state.lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    updated.textContent = `${t('updatedPrefix')} ${text}`;
    updated.hidden = false;
  } else {
    updated.textContent = '';
    updated.hidden = true;
  }
}

/* ── Sorting ────────────────────────────────────────────────────────────── */

function renderSortOptions() {
  const select = $('sort-select');
  const options = [
    ['',            t('sortRelevance')],
    ['name-asc',    t('sortNameAsc')],
    ['name-desc',   t('sortNameDesc')],
    ['date-desc',   t('sortDateNewest')],
    ['date-asc',    t('sortDateOldest')],
    ['status-asc',  t('sortStatusAsc')],
    ['status-desc', t('sortStatusDesc')],
  ];
  select.replaceChildren();
  options.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = state.sort;
  select.setAttribute('aria-label', t('sortLabel'));
}

/* ── Highlighting ───────────────────────────────────────────────────────── */

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendHighlighted(element, text, words) {
  if (!words || !words.length) {
    element.textContent = text;
    return;
  }
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');
  let last = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match.index > last) element.appendChild(document.createTextNode(text.slice(last, match.index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    element.appendChild(mark);
    last = match.index + match[0].length;
    if (match[0] === '') pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
  if (last < text.length) element.appendChild(document.createTextNode(text.slice(last)));
}

function queryWords() {
  return state.query.trim().split(/\s+/).filter(Boolean);
}

/* ── Cards / list rows ──────────────────────────────────────────────────── */

function buildCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.id = item.id;

  const imgWrap = document.createElement('div');
  imgWrap.className = 'card-img';

  const url = safeImageUrl(item.image);
  if (url) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = url;
    img.addEventListener('error', () => {
      img.remove();
      imgWrap.prepend(iconElement(item));
    }, { once: true });
    imgWrap.appendChild(img);
  } else {
    imgWrap.appendChild(iconElement(item));
  }

  const dot = document.createElement('span');
  dot.className = `status-dot dot-${statusClass(item)}`;
  imgWrap.appendChild(dot);

  const tag = document.createElement('span');
  tag.className = 'sheet-tag';
  tag.textContent = sheetLabel(item.sheet, state.lang).replaceAll('_', ' ');
  imgWrap.appendChild(tag);

  const body = document.createElement('div');
  body.className = 'card-body';

  const name = document.createElement('div');
  name.className = 'card-name';
  appendHighlighted(name, item.name || t('noName'), queryWords());
  body.appendChild(name);

  if (state.view === 'list') {
    if (item.brand) {
      const brand = document.createElement('div');
      brand.className = 'card-sub';
      brand.textContent = item.brand;
      body.appendChild(brand);
    }
    if (item.barcode) {
      const code = document.createElement('div');
      code.className = 'row-barcode';
      code.textContent = item.barcode;
      body.appendChild(code);
    }
    const badge = document.createElement('span');
    badge.className = `${badgeClass(item)} row-badge`;
    badge.textContent = statusLabel(item) || STATUS.none[state.lang];
    card.append(imgWrap, body, badge);
    card.addEventListener('click', () => openDetail(item, card));
    return card;
  }

  if (item.brand) {
    const brand = document.createElement('div');
    brand.className = 'card-sub';
    brand.textContent = item.brand;
    body.appendChild(brand);
  }

  card.append(imgWrap, body);
  card.addEventListener('click', () => openDetail(item, card));
  return card;
}

/* ── Results rendering ──────────────────────────────────────────────────── */

function renderResults({ append = false } = {}) {
  const grid = $('card-grid');
  grid.classList.toggle('view-list', state.view === 'list');

  const { results } = searchItems(state.items, {
    query: state.query,
    sheet: state.sheet,
    status: state.status,
  });
  const sortMode = state.sort || (state.query ? '' : 'name-asc');
  state.sorted = sortItems(results, sortMode);

  $('result-count').textContent = state.hasData ? t('itemsFound')(state.sorted.length) : '';

  const dashboard = shouldShowDashboard();
  $('home-dashboard').hidden = !dashboard;
  if (dashboard) renderDashboard();

  if (!state.hasData) {
    $('empty-state').hidden = true;
    return;
  }

  if (!state.sorted.length) {
    grid.replaceChildren();
    $('empty-state').hidden = false;
    return;
  }

  $('empty-state').hidden = true;

  const limit = Math.min(PAGE_SIZE * state.page, state.sorted.length);
  if (!append) grid.replaceChildren();
  const start = append ? grid.childElementCount : 0;
  for (let i = start; i < limit; i += 1) {
    grid.appendChild(buildCard(state.sorted[i]));
  }
}

function renderAll() {
  renderTabs();
  renderChips();
  renderResults();
}

/* ── Detail dialog ──────────────────────────────────────────────────────── */

function fieldRow(label, value, options = {}) {
  const row = document.createElement('div');
  row.className = 'field-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'field-value' + (options.mono ? ' mono' : '');

  if (options.pill) {
    const pill = document.createElement('span');
    pill.className = 'sheet-pill';
    pill.textContent = value;
    valueEl.appendChild(pill);
  } else {
    const text = document.createElement('span');
    text.textContent = value;
    valueEl.appendChild(text);
  }

  if (options.copyable) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-btn';
    copy.textContent = t('copy');
    copy.addEventListener('click', () => copyText(value));
    valueEl.appendChild(copy);
  }

  row.appendChild(valueEl);
  return row;
}

function copyText(value) {
  const done = () => showToast(t('copied'));
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(done);
  } else {
    done();
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
}

function fillDetail(item) {
  const fields = STRINGS[state.lang].fields;

  $('detail-name').textContent = item.name || t('noName');
  $('detail-brand').textContent = item.brand || '';

  const badge = $('detail-status');
  badge.className = badgeClass(item);
  badge.textContent = statusLabel(item) || STATUS.none[state.lang];

  const url = safeImageUrl(item.image);
  const imgBtn = $('detail-img-btn');
  const img = $('detail-img');
  const placeholder = $('detail-img-placeholder');

  if (url) {
    img.src = url;
    img.alt = item.name || '';
    imgBtn.hidden = false;
    imgBtn.dataset.url = url;
    placeholder.hidden = true;
  } else {
    img.removeAttribute('src');
    img.alt = '';
    imgBtn.hidden = true;
    imgBtn.dataset.url = '';
    placeholder.hidden = false;
    placeholder.textContent = getItemIcon(item);
  }

  const wrap = $('detail-fields');
  wrap.replaceChildren();

  const rows = [
    ['barcode', item.barcode, { mono: true, copyable: true }],
    ['serial', item.serial, { mono: true, copyable: true }],
    ['price', item.price ? `฿${item.price}` : '', {}],
    ['date', item.date, {}],
    ['warranty', item.warranty, {}],
    ['status', statusLabel(item), {}],
    ['condition', conditionLabel(item), {}],
    ['reference', item.reference, { mono: true }],
    ['location', item.location, {}],
    ['category', item.category, {}],
    ['sheet', item.sheet ? sheetLabel(item.sheet, state.lang) : '', { pill: true }],
  ];

  rows.forEach(([key, value, options]) => {
    if (!value) return;
    wrap.appendChild(fieldRow(fields[key], value, options));
  });
}

function openDetail(item, opener) {
  lastFocus = opener || document.activeElement;
  if ($('detail-dialog').open) closeDetail({ restoreFocus: false });

  fillDetail(item);
  $('detail-dialog').show();     // non-modal, so the barcode gun keeps typing into the search box
  $('dialog-backdrop').hidden = false;
  $('dialog-backdrop').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeDetail({ restoreFocus = true } = {}) {
  const dialog = $('detail-dialog');
  if (dialog.open) dialog.close();
  const backdrop = $('dialog-backdrop');
  backdrop.classList.remove('show');
  backdrop.hidden = true;
  document.body.style.overflow = '';
  if (restoreFocus && lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') {
    lastFocus.focus({ preventScroll: true });
  }
}

/* ── Data loading ───────────────────────────────────────────────────────── */

function errorMessage(code) {
  const map = {
    timeout: 'errorTimeout',
    http: 'errorHttp',
    parse: 'errorParse',
    api: 'errorApi',
  };
  return t(map[code] || 'errorHttp');
}

function showError(code) {
  state.errorCode = code;
  $('error-text').textContent = errorMessage(code);
  $('error-banner').classList.add('show');
}

function hideError() {
  state.errorCode = '';
  $('error-banner').classList.remove('show');
}

function setStale(stale) {
  $('stale-note').classList.toggle('show', Boolean(stale));
}

function showSkeletons() {
  const grid = $('card-grid');
  grid.replaceChildren();
  for (let i = 0; i < 8; i += 1) {
    const card = document.createElement('div');
    card.className = 'skeleton';
    const image = document.createElement('div');
    image.className = 'skeleton-img';
    const line1 = document.createElement('div');
    line1.className = 'skeleton-line';
    const line2 = document.createElement('div');
    line2.className = 'skeleton-line short';
    card.append(image, line1, line2);
    grid.appendChild(card);
  }
}

function hideSkeletons() {
  document.querySelectorAll('#card-grid .skeleton').forEach(el => el.remove());
}

function adoptItems(items, updatedAt) {
  state.items = Array.isArray(items) ? items : [];
  state.updatedAt = updatedAt || '';
  state.hasData = true;
  hideSkeletons();
  renderAll();
}

async function refresh() {
  hideError();
  try {
    const result = await loadItems({ force: true });
    adoptItems(result.items, result.updatedAt);
    setStale(Boolean(result.stale));
  } catch (err) {
    hideSkeletons();
    if (state.hasData) {
      setStale(true);
    } else {
      showError((err && err.message) || 'http');
    }
  }
}

/* ── Events ─────────────────────────────────────────────────────────────── */

function clearSearch({ focus = true } = {}) {
  clearTimeout(debounceTimer);
  const input = $('search-input');
  input.value = '';
  $('search-clear').classList.remove('show');
  state.query = '';
  state.page = 1;
  renderAll();
  if (focus) input.focus();
}

function goHome() {
  clearSearch({ focus: false });
  state.sheet = 'all';
  state.status = 'all';
  state.sort = '';
  $('sort-select').value = '';
  if ($('detail-dialog').open) closeDetail();
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function runSearchNow(fromScan) {
  clearTimeout(debounceTimer);
  const input = $('search-input');
  state.query = input.value.trim();
  state.page = 1;
  $('search-clear').classList.toggle('show', Boolean(state.query));

  const { results, exactBarcode } = searchItems(state.items, {
    query: state.query,
    sheet: state.sheet,
    status: state.status,
  });
  renderAll();

  if (fromScan) {
    input.select();
    if (exactBarcode && results.length === 1) {
      openDetail(results[0], null);
      input.focus();
      input.select();
    }
  }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  writeLS(LS_THEME, next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f7f7f8' : '#0f0f0f');
  updateThemeLabel();
}

function toggleView() {
  state.view = state.view === 'grid' ? 'list' : 'grid';
  writeLS(LS_VIEW, state.view);
  updateViewLabel();
  renderResults();
}

function setLang(lang) {
  state.lang = lang === 'th' ? 'th' : 'en';
  writeLS(LS_LANG, state.lang);
  applyLang();
}

function bindEvents() {
  const input = $('search-input');

  input.addEventListener('input', () => {
    $('search-clear').classList.toggle('show', Boolean(input.value.trim()));
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = input.value.trim();
      state.page = 1;
      renderAll();
    }, DEBOUNCE_MS);
  });

  // Barcode gun: Enter is handled on the search field only.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runSearchNow(true);
  });

  $('search-clear').addEventListener('click', () => clearSearch());
  $('home-btn').addEventListener('click', goHome);
  $('refresh-btn').addEventListener('click', refresh);
  $('retry-btn').addEventListener('click', refresh);
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('view-toggle').addEventListener('click', toggleView);

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  $('sort-select').addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.page = 1;
    renderResults();
  });

  $('detail-close').addEventListener('click', () => closeDetail());
  $('dialog-backdrop').addEventListener('click', () => closeDetail());

  $('detail-img-btn').addEventListener('click', () => {
    const url = $('detail-img-btn').dataset.url;
    if (!url) return;
    $('image-dialog-img').src = url;
    $('image-dialog').showModal();
  });

  $('image-dialog').addEventListener('click', () => $('image-dialog').close());

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('image-dialog').open) {
      $('image-dialog').close();
      return;
    }
    if ($('detail-dialog').open) {
      closeDetail();
    }
  });

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        if (state.page * PAGE_SIZE >= state.sorted.length) return;
        state.page += 1;
        renderResults({ append: true });
      });
    }, { rootMargin: '400px 0px' });
    observer.observe($('sentinel'));
  }
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function boot() {
  const savedLang = readLS(LS_LANG);
  state.lang = savedLang === 'th' ? 'th' : 'en';

  const savedView = readLS(LS_VIEW);
  state.view = savedView === 'list' || savedView === 'grid'
    ? savedView
    : (window.innerWidth >= 600 ? 'grid' : 'list');

  bindEvents();
  applyLang();
  renderAll();

  // Debug hook (used by the manual/browser checks; harmless in production).
  globalThis.__disInv = { state, renderAll, adoptItems };

  const cached = readCache(safeSession());
  if (cached && Array.isArray(cached.items) && cached.items.length) {
    adoptItems(cached.items, cached.updatedAt);
  } else {
    showSkeletons();
  }

  refresh();
}

boot();
