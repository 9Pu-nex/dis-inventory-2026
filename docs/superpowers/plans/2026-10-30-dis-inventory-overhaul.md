# DIS Inventory Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make items easy to find (load once, search client-side across all fields, browse without typing), add dark/light theme, modernize the UI, and fix the known bugs (init crash, XSS, barcode-gun append, double search).

**Architecture:** Apps Script (`Code.js`) gets a new cached `action=items` endpoint that returns every item as one flat array. The static frontend loads that array once, caches it in `sessionStorage`, and does all search/filter/sort in the browser. The frontend is split from one inline `<script>` into small ES modules so the pure logic (search, status, escaping, data loading) is unit-testable with Node's built-in test runner.

**Tech Stack:** Google Apps Script (V8) via `clasp`; vanilla HTML/CSS/JS ES modules (no framework, no build step); `node --test` for unit tests (Node ≥ 20, zero npm dependencies).

**Spec:** No separate spec file. Requirements come from the owner's priorities: (1) "หาของไม่ค่อยเจอ" (items are hard to find), (2) dark/light theme, (3) UI looks outdated; plus the audit findings listed under "Background" below.

## Background (audit findings this plan fixes)

Current files: `index.html` (UI + inline JS, calls `?action=search` on every keystroke), `Code.js` (Apps Script backend), `appsscript.json` (web app: `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`).

- `index.html:828` sets text on `#scanner-text`, which does not exist, so `applyLang()` throws. Init stops before `renderTabs()`/`renderFilterChips()`, and switching to TH half-fails.
- XSS: sheet values are interpolated into `innerHTML` unescaped (`index.html:975-983`, `1031-1066`).
- Server search (`Code.js:103-135`) matches barcode only by exact equality and substring-matches only `name`, `brand`, `location`. Serial, category, status, reference and partial barcode never match. It reads all 9 sheets twice per keystroke, with no cache.
- Tabs show nothing unless a query is typed (`index.html:849`), so you can't browse a category.
- Barcode gun: after a scan the barcode stays in the input, so the next scan appends to it. The Enter handler doesn't cancel the pending debounce, so every scan searches twice. `clearSearch()`/`goHome()` don't cancel the debounce either.
- Status dot uses fuzzy `includes` (so `เลิกใช้งาน` shows as "In Use") but the status filter uses exact equality, so the two disagree.
- `mapRow` (`Code.js:155-224`) finds columns with `header.includes(key)` and falls back to a different column when a cell is empty. `'ชื่อ'` can match "ชื่อผู้ใช้" and `'วัน'` can match "วันหมดประกัน". Image column indices are hard-coded (`IMAGE_COL`).
- `doGet` has no try/catch. Errors return an HTML page and the frontend fails to parse JSON.
- `.clasp.json` has `rootDir: ""` and `htmlExtensions: [".html"]`, so `clasp push` would upload `index.html` into the Apps Script project. `appsscript.json` is gitignored.
- Viewport blocks zoom (`user-scalable=no`). Cards are `div`s. The popup is not a dialog. `env(safe-area-inset-*)` is inert without `viewport-fit=cover`.
- Working tree shows a whole-file diff on `index.html` caused only by CRLF line endings.

## Live data findings (from `?action=getAll`, 2026-10-30)

The raw sheet headers were **not** visible to the planner; everything below is inferred from the mapped API output.

**Size**

| sheet | items |
|---|---|
| IT | 148 |
| DEC_Appliance | 25 |
| DIS_Appliance | 43 |
| Vehicle | 5 |
| Health and Medical Equipment | 2 |
| Sport | 2 |
| DIS_Kitchen | 157 |
| Furniture DEC | 138 |
| Furniture DIS | 762 |
| **total** | **1,282** |

The JSON payload is 433 KB. Every image is a Drive thumbnail URL.

**Data findings**

- **Furniture DIS (59% of all items) is mis-mapped.**
  - `name` is empty for all 762 rows.
  - `barcode` holds the item description (e.g. `"Wall mounted whiteboard 120x240cm"`), so 36 "barcodes" are duplicated.
  - Today these items show as "(No name)" and are only findable by location. This is the single biggest cause of "หาของไม่ค่อยเจอ".
- **Sport:** both rows have only `barcode` + `status`, so it is probably mis-mapped too.
- **Vehicle contains a second, English header row inside the data** (`Barcode, Name, Brand, Serial Number, Date, Warranty, Status, Reference Number, Location`). The API returns it as an item.
- **Status values differ per sheet.** Status is empty on 1,064 / 1,282 items.

  | sheets | status values |
  |---|---|
  | IT | `ใช้งาน`, `ชำรุด`, `สูญหาย`, `Stand-by`, empty |
  | Appliances / Vehicle / Health / Sport / Kitchen | `ปกติ`, `กำลังตามหา`, empty |
  | Furniture sheets | always empty |
- **Condition values:** `ปกติ`, `ชำรุด`, `เลิกใช้งาน`, `ใกล้พัง ( ใช้งานเกินกำหนด )`, empty.
- **`category`** is filled only on IT (`DIS` / `DEC`). It is really an affiliation ("สังกัด").
- **Dates are mixed.**
  - `dd/MM/yyyy` CE (684)
  - `dd/MM/yyyy` Buddhist Era, e.g. `01/08/2566` (192)
  - 2-digit years, e.g. `24/5/24` (~350)
  - spaced, e.g. `14 / 08 / 2566`
  - empty (58)
- **Barcode format:** `DEC`/`DIS` + digits, e.g. `DEC20010100001` (one is `DEC210314000001`, 15 chars). Excluding Furniture DIS, no duplicates were found.
- **Privacy:** `location` often holds a person's first name (e.g. `Stone`, `Ken`).

## Global Constraints

- No build step. Files are served as-is by a static host. Do not add npm runtime dependencies or a bundler. `package.json` exists only for `npm test` → `node --test`.
- Node ≥ 20 for tests. Browsers: current Chrome, Edge, Safari and iOS Safari ≥ 16 (`<dialog>`, ES modules and `color-mix()` are allowed).
- Apps Script: runtime V8, timezone `Asia/Bangkok`. The sheet is **read-only** for this project; never write to it.
- Production deployment ID (also the ID inside the frontend `API` URL): `AKfycbzWO17Ys0l6DVBlb6saYm1i5krAVZjVjlPD1plCDEAqrKg4-h3nEXWqlWsOOUAdmxw`. Redeploy only with `clasp deploy -i <that id>` so the URL never changes.
- Keep `action=search` and `action=getAll` working until the new frontend is live. The new frontend uses only `action=items`.
- Every user-visible string exists in both `en` and `th`.
- No sheet-derived value may reach `innerHTML` without `escapeHTML()`. Prefer `textContent`.
- Image URLs are rendered only if they start with `https://`.
- Fonts stay `IBM Plex Sans Thai` + `IBM Plex Mono`.
- **Human approval required before:** `clasp push`, `clasp deploy`, `git push`, and any change to `appsscript.json` `webapp.access`. Stop and ask; do not run these autonomously.
- Out of scope: real authentication (moving to `HtmlService` + `access: DOMAIN`). The owner has not decided yet. Do not change access settings.

## Review Focus

1. **Repeated barcode-gun scans while the detail dialog is open.** The second scan must replace the first, not append, and must open the new item. Test: Task 6 Step 6 (manual scan simulation).
2. **Sheet cells containing markup** (`<img src=x onerror=alert(1)>`, quotes, `&`) must render as literal text everywhere: card, list row, dialog, sheet pill, image `alt`. Test: Task 4 `escapeHTML` tests + Task 6 fixture item `XSS-1`.
3. **Apps Script slow, failing or returning HTML** (cold start, quota, deploy in progress). The app should show cached data if it has any, otherwise an error with a Retry button, and never hang forever. Test: Task 5 `loadItems` timeout / non-JSON / `success:false` tests.
4. **Thai and mixed-format queries**: `"MacBook Air"` must find `"MACBOOK-AIR M2"`, and a Thai query with different whitespace must still match. Barcode case and dashes are ignored. Test: Task 4 `normalize` / `searchItems` tests.
5. **Browsing "All" (1,282 items today, each with a Drive thumbnail)** must stay responsive. Render at most 60 cards at first and load more on scroll; images use `loading="lazy"`. Test: Task 6 Step 6 with a 3,000-item generated fixture.

Also highest-impact, owned by Task 2: **Furniture DIS rows must come back with a non-empty `name` and a real barcode (or empty), never the description in `barcode`.**

---

## File Structure

| File | Responsibility |
|---|---|
| `Code.js` (modify) | Apps Script: sheet reading, column mapping, `action=items` with chunked CacheService cache, `onEdit` cache invalidation, `logHeaders()` diagnostic |
| `.claspignore` (create) | Push only `Code.js` + `appsscript.json` |
| `.gitattributes` (create) | `* text=auto eol=lf` |
| `.gitignore` (modify) | Stop ignoring `appsscript.json` |
| `package.json` (create) | `"type": "module"`, `"test": "node --test"` |
| `index.html` (rewrite) | Markup + CSS only; theme bootstrap snippet in `<head>`; loads `js/app.js` as a module |
| `js/i18n.js` (create) | `STRINGS`, `STATUS`, `CONDITION`, `SHEETS` metadata (tab ids + EN/TH labels) |
| `js/search.js` (create) | Pure: `normalize`, `statusKey`, `escapeHTML`, `safeImageUrl`, `searchItems`, `countBy` |
| `js/data.js` (create) | `loadItems()` with fetch timeout + `sessionStorage` cache + mock mode |
| `js/app.js` (create) | State, rendering, events, scanner, dialog, theme toggle, view toggle |
| `tests/fixtures/items.json` (create) | ~12 hand-written items incl. XSS and Thai cases (used by `?mock=1`) |
| `tests/search.test.js`, `tests/data.test.js`, `tests/code.test.js` (create) | Unit tests |

Shared item shape (produced by `Code.js` `mapRow`, consumed everywhere):

```js
/** @typedef {{ id:string, sheet:string, barcode:string, name:string, brand:string, serial:string,
 *   price:string, date:string, warranty:string, status:string, condition:string,
 *   reference:string, location:string, category:string, image:string }} Item */
```

`id` = `` `${sheet}:${rowNumber}` `` (1-based sheet row).

---

### Task 1: Repo hygiene and test harness

**Files:**
- Create: `.claspignore`, `.gitattributes`, `package.json`, `tests/smoke.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm test` runs every `tests/*.test.js` with `node --test`.

- [ ] **Step 1:** Commit the pulled backend as a baseline before changing it: `git add Code.js && git commit -m "chore: add Apps Script source from clasp pull"`.
- [ ] **Step 2:** Create `.claspignore` with exactly:
  ```
  **/**
  !Code.js
  !appsscript.json
  ```
- [ ] **Step 3:** Remove the `appsscript.json` line from `.gitignore` (keep `.clasp.json` ignored).
- [ ] **Step 4:** Create `.gitattributes` containing `* text=auto eol=lf`, then run `git add --renormalize .`.
- [ ] **Step 5:** Create `package.json`: `{"name":"dis-inventory","private":true,"type":"module","scripts":{"test":"node --test"}}`.
- [ ] **Step 6:** Create `tests/smoke.test.js` with one test `assert.equal(1, 1)`. Run `npm test`. Expected: `# pass 1`.
- [ ] **Step 7:** Run `clasp status` (read-only). Expected: only `Code.js` and `appsscript.json` listed as tracked files, and **not** `index.html`.
- [ ] **Step 8:** Commit: `chore: clasp ignore, lf line endings, node test harness`.

---

### Task 2: Backend: safe column mapping, image column by header, error handling

**Files:**
- Modify: `Code.js` (`readSheet`, `mapRow`, `doGet`; remove `IMAGE_COL`; add `buildColumnMap`, `logHeaders`)
- Test: `tests/code.test.js`

**Interfaces:**
- Produces (global functions in `Code.js`):
  - `buildColumnMap(headers: string[]) -> {[field: string]: number}` (index or `-1`)
  - `mapRow(row: any[], colMap, sheetName: string, rowNumber: number) -> Item`
  - `readSheet(sheet, sheetName) -> Item[]` (signature unchanged)
  - `logHeaders() -> void` (logs each sheet's headers and its column map)
  - `doGet` wraps everything in try/catch and returns `{success:false, error:String(err)}` as JSON on failure.

**Column map algorithm (decided, implement exactly):** Fields are resolved in this priority order, and each field claims at most one column; a claimed column can't be used by a later field:

| field | keys (in order) |
|---|---|
| barcode | `barcode`, `เลขครุภัณฑ์`, `เลขบาร์` |
| serial | `serial`, `ซีเรียล` |
| warranty | `รับประกัน`, `warranty` |
| location | `สถานที่`, `location`, `ผู้ใช้` |
| name | `ชื่อครุภัณฑ์`, `name`, `ชื่อ` |
| brand | `ยี่ห้อ`, `brand` |
| price | `ราคา`, `price` |
| date | `วันที่`, `date`, `วัน` |
| status | `สถานะ`, `status` |
| condition | `สภาพ`, `condition` |
| reference | `อ้างอิง`, `reference` |
| category | `ประเภท`, `category`, `สังกัด` |
| image | `รูป`, `image`, `photo`, `picture` |

**BLOCKER: do Step 0 first.** The key table below was written without seeing the real headers. Known breakage: in Furniture DIS the `barcode` field picks up the description column and `name` matches nothing; Sport loses almost every field.

- [ ] **Step 0: HUMAN CHECKPOINT (before any code).** Ask the owner to run `inspectSheets()` in the Apps Script editor and paste the log. It needs no deploy: paste the function into the editor temporarily, run it, then delete it.

  ```js
  function inspectSheets() {
    SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(sh => {
      const rows = sh.getDataRange().getValues();
      Logger.log(JSON.stringify({ sheet: sh.getName(), rows: rows.length - 1,
        headers: rows[0], row2: rows[1] || null }));
    });
  }
  ```

  Then update the key table (add the real Furniture DIS / Sport header strings) and use those exact strings in the tests. If the owner cannot run it, continue with the table as written. In that case the Step 1 Furniture DIS test must still be written from the owner-provided header row.

For each field, try three passes over unclaimed headers (already `trim().toLowerCase()`): `header === key`, then `header.startsWith(key)`, then `header.includes(key)`. In each pass, keys are tried in table order. If the image field resolves to `-1`, fall back to the old fixed index (`IT` and `Furniture DEC` → 14, all other sheets → 13). That fallback needs `sheetName`, so `readSheet` applies it. `mapRow` reads exactly `row[colMap[field]]` and **never falls back to another column when a cell is empty**. Keep the existing `formatDate`, price formatting and `convertDriveUrl` behavior.

**Embedded header rows:** `readSheet` skips any data row where the normalized `barcode` equals the normalized `barcode` header, or where the value is literally `barcode` (case-insensitive). This removes the English header row found inside Vehicle.

- [ ] **Step 1: Write failing tests** in `tests/code.test.js`. Load `Code.js` into a `vm` context with stubs (`Utilities.formatDate` → `'01/02/2024'`, `Session.getScriptTimeZone` → `'Asia/Bangkok'`, `ContentService` returning `{createTextOutput: s => ({body: s, setMimeType(){return this}})}`, `ContentService.MimeType.JSON`, `SpreadsheetApp`, `CacheService` per test). Tests:
  ```js
  test('name does not steal the user column', () => {
    const m = ctx.buildColumnMap(['ชื่อผู้ใช้','ชื่อครุภัณฑ์','barcode']);
    assert.equal(m.name, 1); assert.equal(m.location, 0); assert.equal(m.barcode, 2);
  });
  test('date does not steal warranty-expiry column', () => {
    const m = ctx.buildColumnMap(['วันหมดรับประกัน','วันที่ซื้อ']);
    assert.equal(m.warranty, 0); assert.equal(m.date, 1);
  });
  test('exact header beats substring', () => {
    assert.equal(ctx.buildColumnMap(['username','name']).name, 1);
  });
  test('empty cell stays empty (no fallback to other column)', () => {
    const headers = ['ชื่อครุภัณฑ์','ชื่ออื่น'];
    const item = ctx.mapRow(['', 'WRONG'], ctx.buildColumnMap(headers), 'IT', 2);
    assert.equal(item.name, ''); assert.equal(item.id, 'IT:2');
  });
  test('image column found by header and Drive URL converted', () => {
    const m = ctx.buildColumnMap(['name','รูปภาพ']);
    const item = ctx.mapRow(['A','https://drive.google.com/file/d/abc_123/view'], m, 'IT', 2);
    assert.equal(item.image, 'https://drive.google.com/thumbnail?id=abc_123&sz=w400');
  });
  test('embedded English header row is skipped', () => { /* stub sheet: Thai header row, 1 data row, then row ['Barcode','Name',…]; readSheet returns 1 item */ });
  test('Furniture DIS real headers map name and barcode correctly', () => {
    /* headers + row2 copied verbatim from the Step 0 log for 'Furniture DIS';
       assert item.name === <description text>, item.barcode is '' or matches /^D(EC|IS)\d+$/ */
  });
  test('doGet returns success:false JSON when the sheet throws', () => {
    ctx.SpreadsheetApp = { getActiveSpreadsheet(){ throw new Error('boom'); } };
    const out = JSON.parse(ctx.doGet({ parameter: { action: 'getAll' } }).body);
    assert.equal(out.success, false); assert.match(out.error, /boom/);
  });
  ```
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL (`buildColumnMap is not a function`).
- [ ] **Step 3:** Implement `buildColumnMap`, the new `mapRow(row, colMap, sheetName, rowNumber)`, the image fallback in `readSheet` (call `buildColumnMap` once per sheet, not per row), the try/catch in `doGet`, and `logHeaders()`. Delete `IMAGE_COL`, keeping its two index values inline in the fallback.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5: HUMAN CHECKPOINT.** After the owner approves a `clasp push`, ask them to run `logHeaders` in the editor and paste the log. Expected: for every sheet, every field maps to the intended column; Furniture DIS and Sport have `name ≠ -1`. Fix any mismatch with a new test using the real header strings, then rerun `npm test`.
- [ ] **Step 6:** Commit: `fix(backend): deterministic column mapping, header-based image column, JSON errors`.

---

### Task 3: Backend: cached `action=items` endpoint

**Files:**
- Modify: `Code.js` (add functions + `doGet` branch + `onEdit`)
- Test: `tests/code.test.js`

**Interfaces:**
- Consumes: `readSheet` (Task 2).
- Produces:
  - HTTP `GET ?action=items` → `{ success: true, updatedAt: string /*ISO*/, items: Item[] }`
  - `splitChunks(str: string, size: number) -> string[]`
  - `getItemsCached() -> { updatedAt: string, items: Item[] }`
  - `clearItemsCache() -> void`
  - `onEdit(e) -> void` (simple trigger; calls `clearItemsCache()`)

**Cache design (decided):** Use `CacheService.getScriptCache()`. Build the payload JSON, compress it with `Utilities.gzip(Utilities.newBlob(json, 'application/json'))`, then encode with `Utilities.base64Encode(blob.getBytes())`. Split into 90,000-char chunks stored with `putAll` under keys `items_v1_0…n-1`. Write the meta key `items_v1_meta` = `JSON.stringify({chunks:n, updatedAt})` **last**. TTL is 1800 s for every key. On read, get the meta key, `getAll` the chunks, and if any chunk is missing treat it as a cache miss. Decode with `Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip')).getDataAsString('UTF-8')`. `clearItemsCache` removes only the meta key; orphan chunks expire on their own. `updatedAt` = `new Date().toISOString()` at build time.

- [ ] **Step 1: Write failing tests:**
  ```js
  test('splitChunks round-trips', () => {
    const s = 'x'.repeat(200001);
    const c = ctx.splitChunks(s, 90000);
    assert.equal(c.length, 3); assert.equal(c.join(''), s);
  });
  test('items action returns flat array from all sheets', () => { /* stub 2 sheets × 2 rows, in-memory CacheService, identity gzip/base64 stubs */
    const out = JSON.parse(ctx.doGet({ parameter: { action: 'items' } }).body);
    assert.equal(out.success, true); assert.equal(out.items.length, 4); assert.ok(out.updatedAt);
  });
  test('second call is served from cache (sheet not read again)', () => { /* count getDataRange calls: 2 after first call, still 2 after second */ });
  test('onEdit clears cache so next call re-reads', () => { /* after ctx.onEdit({}), getDataRange count increases */ });
  test('missing chunk falls back to rebuilding', () => { /* delete items_v1_1 from stub cache; call succeeds and re-reads */ });
  ```
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the functions and add `else if (action === 'items') result = Object.assign({ success: true }, getItemsCached());` to `doGet`. Leave the `search` and `getAll` branches unchanged.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(backend): cached items endpoint with onEdit invalidation`.
- [ ] **Step 6: HUMAN CHECKPOINT (deploy).** Ask the owner to approve, then run:
  `clasp push` → `clasp deploy -i AKfycbzWO17Ys0l6DVBlb6saYm1i5krAVZjVjlPD1plCDEAqrKg4-h3nEXWqlWsOOUAdmxw -d "items endpoint"`.
  Verify with `curl -sL "<API URL>?action=items" | head -c 300`. Expected: starts with `{"success":true,"updatedAt":`. Record the item count and the response size (`| wc -c`) in the commit/PR notes. Expected: about 1,280 items and about 430 KB. Gzipped and base64-encoded, that is about 2 cache chunks. If the size is over 4 MB, stop and report, because the sessionStorage strategy in Task 5 must be revisited. Also confirm that no item has `barcode === 'Barcode'`.

---

### Task 4: Frontend pure logic (`js/search.js`, `js/i18n.js`)

**Files:**
- Create: `js/search.js`, `js/i18n.js`, `tests/search.test.js`

**Interfaces:**
- Produces from `js/search.js`:
  - `normalize(s: unknown) -> string`: `String(s ?? '')`, then `.normalize('NFC').toLowerCase()`, then remove all chars matching `/[\s\-_/.,()#:]+/g`.
  - `statusKey(raw: string) -> 'using'|'broken'|'repair'|'lost'|'standby'|'none'|'other'`: trim the input.
    1. Empty → `none` (labels: "No status" / "ไม่ระบุสถานะ"; this is 83% of items today).
    2. Exact `ใช้งาน` or exact `ปกติ` → `using` (labels: "In Use / Normal" / "ใช้งาน / ปกติ").
    3. Otherwise check contains-rules in this order: `ซ่อม` → `repair`; `สูญหาย` or `ตามหา` → `lost`; `ชำรุด` → `broken`; normalized contains `standby` → `standby`.
    4. Anything else (including `เลิกใช้งาน`) → `other`, shown with its raw text.

    **The owner must confirm the `ปกติ` → using and `กำลังตามหา` → lost mappings** (ask in Task 4; if the owner rejects them, add separate keys instead).
  - `parseDate(s: string) -> number | null` (epoch ms, used for date sort):
    - Strip spaces, then match `d/m/y`.
    - A 2-digit year becomes `2000 + yy`; a year > 2400 becomes `year - 543` (Buddhist Era).
    - Anything unparseable returns `null`. Nulls sort last.
  - `escapeHTML(s: unknown) -> string`: escapes `& < > " '`.
  - `safeImageUrl(url: unknown) -> string`: returns the trimmed URL if it starts with `https://`, else `''`.
  - `searchItems(items: Item[], {query='', sheet='all', status='all'}) -> {results: Item[], exactBarcode: boolean}`
  - `countBy(items: Item[], keyFn: (Item)=>string) -> Record<string, number>`
- Produces from `js/i18n.js`: `STRINGS` (`{en:{…}, th:{…}}`, every key present in both), `STATUS` (`{using, broken, repair, lost, standby, none, other}`, each `{en, th}`), `CONDITION` (moved from `index.html:759-764`), `SHEETS` (`[{id:'IT', en:'IT', th:'IT'}, …]`, the 9 sheets with labels from `index.html:672-680`).

**`searchItems` rules (decided):**
1. Filter by `sheet` (unless `'all'`) and by `statusKey(item.status) === status` (unless `'all'`).
2. Empty query: return everything after filtering, sorted by `name` with `localeCompare(_, 'th')`, and `exactBarcode:false`.
3. If `normalize(query)` equals `normalize(item.barcode)` for at least one filtered item, return only those items with `exactBarcode:true`.
4. Otherwise split the query on whitespace into tokens and normalize each. An item matches when **every** token is a substring of its haystack, where haystack = the normalized values of `barcode, name, brand, serial, location, category, reference, status, condition, sheet`, joined with `'|'`.
5. Score each match. Normalized barcode starts with the full normalized query: 80. Normalized name starts with the first token: 60. Every token is in the normalized name: 40. Anything else: 20. Sort by score descending, then by name with `localeCompare(_, 'th')`.

- [ ] **Step 1: Write failing tests** (`tests/search.test.js`, importing from `../js/search.js`):
  ```js
  test('normalize ignores case, spaces, dashes', () => assert.equal(normalize(' MacBook-Air M2 '), 'macbookairm2'));
  test('statusKey', () => {
    assert.equal(statusKey('ใช้งาน '), 'using'); assert.equal(statusKey('เลิกใช้งาน'), 'other');
    assert.equal(statusKey('ส่งซ่อม'), 'repair'); assert.equal(statusKey('Stand-by'), 'standby');
    assert.equal(statusKey(''), 'none'); assert.equal(statusKey('ปกติ'), 'using');
    assert.equal(statusKey('กำลังตามหา'), 'lost');
  });
  test('parseDate handles CE, BE, 2-digit, spaced', () => {
    const d = (y,m,dd) => Date.UTC(y,m-1,dd);
    assert.equal(parseDate('19/03/2020'), d(2020,3,19));
    assert.equal(parseDate('01/08/2566'), d(2023,8,1));
    assert.equal(parseDate('24/5/24'), d(2024,5,24));
    assert.equal(parseDate('14 / 08 / 2566'), d(2023,8,14));
    assert.equal(parseDate('Date'), null); assert.equal(parseDate(''), null);
  });
  test('escapeHTML', () => assert.equal(escapeHTML(`<img src=x onerror="a('&')">`),
    '&lt;img src=x onerror=&quot;a(&#39;&amp;&#39;)&quot;&gt;'));
  test('safeImageUrl', () => { assert.equal(safeImageUrl('javascript:alert(1)'), ''); assert.equal(safeImageUrl('http://x'), '');
    assert.equal(safeImageUrl(' https://a/b '), 'https://a/b'); });
  const items = [
    {id:'IT:2', sheet:'IT', barcode:'DIS-IT-0001', name:'MACBOOK-AIR M2', brand:'Apple', serial:'C02XYZ', location:'ครูสมชาย', status:'ใช้งาน', category:'', reference:'', condition:''},
    {id:'IT:3', sheet:'IT', barcode:'DIS-IT-0002', name:'Dell Monitor', brand:'Dell', serial:'SN555', location:'ห้อง 3', status:'ชำรุด', category:'', reference:'', condition:''},
    {id:'Sport:2', sheet:'Sport', barcode:'SP-01', name:'ลูกฟุตบอล', brand:'', serial:'', location:'ห้องพละ', status:'เลิกใช้งาน', category:'', reference:'', condition:''},
  ];
  test('multi-token across fields', () => assert.deepEqual(searchItems(items,{query:'dell ห้อง3'}).results.map(i=>i.id), ['IT:3']));
  test('formatting-insensitive name', () => assert.deepEqual(searchItems(items,{query:'macbook air'}).results.map(i=>i.id), ['IT:2']));
  test('serial is searchable', () => assert.equal(searchItems(items,{query:'c02x'}).results[0].id, 'IT:2'));
  test('partial barcode', () => assert.equal(searchItems(items,{query:'it-0002'}).results[0].id, 'IT:3'));
  test('exact barcode ignores case/dashes', () => { const r = searchItems(items,{query:'dis it 0001'});
    assert.equal(r.exactBarcode, true); assert.deepEqual(r.results.map(i=>i.id), ['IT:2']); });
  test('browse with empty query + filters', () => {
    assert.equal(searchItems(items,{sheet:'IT'}).results.length, 2);
    assert.deepEqual(searchItems(items,{status:'other'}).results.map(i=>i.id), ['Sport:2']); });
  test('countBy', () => assert.deepEqual(countBy(items, i=>i.sheet), {IT:2, Sport:1}));
  test('i18n parity', () => assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.th).sort()));
  ```
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `js/search.js` and `js/i18n.js`. The `STRINGS` keys are whatever Task 6 and Task 8 render; add keys as those tasks need them, and the parity test keeps both languages in sync.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(frontend): client-side search, status, escaping helpers`.

---

### Task 5: Frontend data loading (`js/data.js`)

**Files:**
- Create: `js/data.js`, `tests/data.test.js`, `tests/fixtures/items.json`

**Interfaces:**
- Produces:
  - `export const API_URL` = `'https://script.google.com/macros/s/AKfycbzWO17Ys0l6DVBlb6saYm1i5krAVZjVjlPD1plCDEAqrKg4-h3nEXWqlWsOOUAdmxw/exec'`
  - `loadItems({ force=false, fetchImpl=fetch, storage=sessionStorage, now=Date.now, url, timeoutMs=20000 } = {}) -> Promise<{ items: Item[], updatedAt: string, fromCache: boolean, stale: boolean }>`
  - `readCache(storage) -> {savedAt:number, updatedAt:string, items:Item[]} | null`

**Behavior (decided):** The cache key is `dis-inv-items-v1`. If `url` is omitted, use `` `${API_URL}?action=items` ``. However, when `location.search` contains `mock=1` (only check this when `globalThis.location` exists), use `'tests/fixtures/items.json'` instead.

- `force=false` with a cache entry younger than 5 min: return the cache entry with `fromCache:true, stale:false` and do not fetch.
- Otherwise fetch with an `AbortController` timeout. A response that is not OK, is not JSON, or has `success !== true` throws `Error` whose `message` is one of `'timeout' | 'http' | 'parse' | 'api'`.
- On success: write the cache (wrap `setItem` in try/catch; quota errors are ignored) and return `fromCache:false`.
- On failure with any cache entry present (even an old one): return it with `fromCache:true, stale:true`.
- On failure with no cache entry: rethrow.

The app (Task 6) is responsible for background revalidation: show the cache first, then call `loadItems({force:true})`.

The fixture holds ~12 items in the `{success:true, updatedAt, items:[…]}` shape. It must include:
- one item per status value seen in live data (`ใช้งาน`, `ชำรุด`, `สูญหาย`, `Stand-by`, `ปกติ`, `กำลังตามหา`, empty) plus `เลิกใช้งาน`
- realistic barcodes (`DEC20010100001` style) and mixed date formats (`19/03/2020`, `01/08/2566`, `24/5/24`)
- a Thai-only name
- an item with an empty name
- item `id:'XSS-1'` whose name is `<img src=x onerror=alert(1)>` and whose location is `"quoted" & <b>bold</b>`
- an item with `image: 'javascript:alert(1)'`
- two items sharing barcode `DUP-001`

- [ ] **Step 1: Write failing tests** with a `Map`-backed fake storage (`getItem/setItem/removeItem`) and fake `fetchImpl`:
  - `fresh cache is returned without fetching` (fetchImpl spy not called)
  - `force bypasses fresh cache`
  - `success writes cache` (storage has key `dis-inv-items-v1`)
  - `timeout rejects with message "timeout" when no cache` (fetchImpl never resolves; `timeoutMs: 10`)
  - `html response rejects with "parse"` (`res.json()` throws)
  - `success:false rejects with "api"`
  - `failure with old cache returns stale` (`stale === true`, items equal the cached ones)
  - `storage quota error does not throw` (`setItem` throws `QuotaExceededError`)
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `js/data.js` and the fixture.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(frontend): load-once data layer with session cache`.

---

### Task 6: Frontend app rewrite (`js/app.js` + `index.html` markup)

**Files:**
- Create: `js/app.js`
- Modify: `index.html` (delete the inline `<script>` at `index.html:739-1153`; remove every inline `onclick`/`oninput`; add `<script type="module" src="js/app.js">`)

**Interfaces:**
- Consumes: Task 4 (`searchItems`, `statusKey`, `escapeHTML`, `safeImageUrl`, `countBy`, `STRINGS`, `STATUS`, `CONDITION`, `SHEETS`) and Task 5 (`loadItems`, `readCache`).
- Produces: DOM ids that Task 7 and Task 8 hook into: `#theme-toggle`, `#view-toggle`, `#refresh-btn`, `#updated-at`, `#home-dashboard`, `#card-grid`, `#detail-dialog`.

**Requirements (decided):**
- **Viewport:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- **State:** `{ items, lang, sheet:'all', status:'all', query:'', page:1, view }`. All rendering is derived from `searchItems(state.items, state)`.
- **Startup:**
  1. If `readCache()` has an entry, render from it immediately.
  2. Then call `loadItems({force:true})` and re-render on success.
  3. If there is no cache, show skeleton cards (Task 8 styles them; plain placeholders are fine here) while the first load runs.
  4. If the load fails and there is no data, show `#error-banner` with a localized message per error code (`timeout|http|parse|api`, which become new `STRINGS` keys) and a Retry button.
  5. If the load fails but cached data was shown, show a non-blocking "Showing saved data" note (`stale`).
- **Search input:** debounce 150 ms. `clearSearch()`/`goHome()`/Enter must all `clearTimeout` the pending debounce.
- **Browsing:** tabs and status chips always work without a query. An empty query lists everything in that tab/status.
- **Counts:** tab labels show `Label (n)`, where n = matches for the current query + status, ignoring the tab. Chips show counts for the current query + tab, ignoring the status.
- **Render limit:** render at most `60 * page` results. An `IntersectionObserver` sentinel after the grid increments `page` and appends more. Reset `page` to 1 on any filter or query change.
- **Cards:** each card is a `<button class="card" data-id>`. All text goes through `textContent` or `escapeHTML`. The image is used only if `safeImageUrl(item.image)` returns a URL; render it as `<img loading="lazy" decoding="async" alt="">`, and on error replace it with the icon. Keep `getItemIcon` (move it into `app.js`). Use `replaceAll('_',' ')` for sheet tags.
- **Detail view:** use a `<dialog id="detail-dialog">` opened with `showModal()`. Esc and backdrop click close it. Focus returns to the card that opened it.
- **Barcode gun:**
  - The `keydown` Enter handler is attached **to `#search-input` only**, not to the document.
  - On Enter: clear the debounce, run the search now, then `input.select()` so the next scan replaces the text.
  - If `exactBarcode && results.length === 1`, open the dialog. If the dialog is already open, close it first and then open the new item.
  - While the dialog is open, keystrokes from the gun must still land in the search input. When the dialog opens via a scan, call `input.focus()` after `showModal()`. If `<dialog>` steals focus in testing, open it with `show()` plus a manual backdrop instead, and note this in the commit.
- **Language:** `applyLang()` only touches elements that exist. Delete `scannerText`. Change copy that says "camera scanner" to "barcode scanner" / "เครื่องสแกนบาร์โค้ด". The selected language persists in `localStorage['dis-lang']`.
- **Removed:** the `CellImage` check, `renderCard`, and the `action=search` call.

- [ ] **Step 1:** Implement `js/app.js` and the `index.html` markup changes per the requirements above.
- [ ] **Step 2:** Serve it with `python3 -m http.server 8000` and open `http://localhost:8000/?mock=1`. Expected: the fixture loads and the browser console shows no errors.
- [ ] **Step 3:** XSS check: search `img`. Expected: the `XSS-1` card shows the literal text `<img src=x onerror=alert(1)>`, no alert fires, and the dialog location shows `"quoted" & <b>bold</b>` literally. The `javascript:` image item shows its icon.
- [ ] **Step 4:** Browse check: click a tab with an empty query. Expected: that sheet's items are listed, and tab/chip counts match the fixture.
- [ ] **Step 5:** Duplicate barcode check: type `dup-001` and press Enter. Expected: 2 cards and no auto-open.
- [ ] **Step 6:** Scanner and scale check (Review Focus 1 and 5):
  - In the console, simulate a scan: set the input to a fixture barcode, then dispatch Enter. Expected: the dialog opens.
  - Simulate a second scan with a different barcode, using the same steps. Expected: the input contains only the second barcode and the dialog shows the second item.
  - Then load a generated 3,000-item array (write a throwaway console snippet that repeats the fixture and sets unique ids/barcodes), select "All", and scroll. Expected: the first paint renders 60 cards and scrolling appends more without visible jank.
- [ ] **Step 7:** Switch to TH. Expected: all labels are Thai, including tabs, chips, placeholder, empty states and errors; no console errors appear; after a reload TH persists.
- [ ] **Step 8:** Run `npm test`. Expected: all PASS.
- [ ] **Step 9:** Commit: `feat(frontend): module app with client search, browse, safe rendering, scanner fixes`.

---

### Task 7: Dark / light theme

**Files:**
- Modify: `index.html` (CSS variables, `<head>` bootstrap snippet, toggle button), `js/app.js` (toggle handler)

**Interfaces:**
- Consumes: `#theme-toggle` (Task 6 adds the button; this task wires it).
- Produces: `document.documentElement.dataset.theme` ∈ `'dark'|'light'`; `localStorage['dis-theme']`.

**Decided values.** Keep the current `:root` as dark. Add a `[data-theme="light"]` block:
`--bg:#f7f7f8; --surface:#ffffff; --surface2:#f0f0f2; --border:#e4e4e7; --border2:#d4d4d8; --text:#18181b; --text2:#52525b; --text3:#a1a1aa; --accent:#16a34a; --accent2:#15803d; --red:#dc2626; --amber:#d97706; --blue:#2563eb; --purple:#7c3aed;`

Add the new tokens `--on-accent` (dark `#000`, light `#fff`) and `--overlay` (dark `rgba(0,0,0,.7)`, light `rgba(24,24,27,.4)`). Replace every hard-coded `#000` on an accent background with `var(--on-accent)`. Replace every `rgba(74,222,128,…)`/`rgba(248,113,113,…)`/etc. tint with `color-mix(in srgb, var(--accent) 12%, transparent)` and its equivalents, so tints follow the theme.

**Bootstrap (inline in `<head>`, before CSS paints):** read `localStorage['dis-theme']`. If it is unset, use `matchMedia('(prefers-color-scheme: light)')`. Set `data-theme` and update `<meta name="theme-color">`.

The toggle cycles light ↔ dark and persists the choice. The button gets `aria-label` from `STRINGS` (`themeToLight` / `themeToDark`).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run `grep -nE "#000|rgba\(" index.html`. Expected: matches only inside the two theme variable blocks.
- [ ] **Step 3:** With `?mock=1`, toggle the theme and reload. Expected: no flash of the wrong theme; badges, chips, dialog and error banner are all legible in both themes; text on accent buttons is readable.
- [ ] **Step 4:** Clear `localStorage` and emulate a light OS preference (DevTools → Rendering → prefers-color-scheme). Expected: the app opens in light.
- [ ] **Step 5:** Commit: `feat(ui): dark/light theme with system default`.

---

### Task 8: UI refresh

**Files:**
- Modify: `index.html` (markup/CSS), `js/app.js`, `js/i18n.js`

**Interfaces:**
- Consumes: Task 6 DOM ids, Task 4 `countBy`, `statusKey`.

**Requirements (decided; visual details are the implementer's call within these):**
- **Sticky top:** header, search, tabs and chips form a single sticky block. Only the results scroll.
- **Home dashboard** (`#home-dashboard`, shown when the query is empty, tab = all, status = all):
  - one tile per status with its count (`countBy(items, i => statusKey(i.status))`); clicking a tile sets that status filter
  - one tile per sheet with its count; clicking it sets the tab
  - the text "Updated <time>" from `updatedAt`, plus `#refresh-btn` (calls `loadItems({force:true})`)
- **View toggle** `#view-toggle`: switches between grid (current cards) and list (compact rows: icon/thumbnail, name, brand, barcode in mono, status badge). Persisted in `localStorage['dis-view']`; defaults to grid at ≥ 600 px width and list below.
- **Skeleton:** 8 shimmer placeholder cards during the first load, replacing the spinner. The shimmer is disabled under `prefers-reduced-motion`.
- **Dialog:**
  - Copy buttons next to barcode and serial use `navigator.clipboard.writeText` and show a 1.5 s "Copied" / "คัดลอกแล้ว" toast.
  - Tapping the image opens it at full size (a second `<dialog>` or an expanded state).
  - Status badge colors come from `statusKey`.
- **Search UX:** highlight matched query tokens in card names by wrapping them in `<mark>`. Build this from escaped text, never raw. A "Sort" select offers relevance (default when there is a query) / name / date (via `parseDate`, newest first, nulls last) / status; with an empty query, name is the default.
- **Polish:** use `transition` on hover/active states only, honor `prefers-reduced-motion`, give every button a visible `:focus-visible` ring, and keep tap targets ≥ 40 px.
- Every new string is added to `STRINGS` in both languages.

- [ ] **Step 1:** Implement the dashboard, view toggle and skeleton. Check with `?mock=1`. Expected: dashboard counts equal the fixture counts and tiles navigate correctly.
- [ ] **Step 2:** Implement the dialog copy, full-size image, highlight and sort. Check: copying a barcode puts it on the clipboard; searching `<img` highlights inside escaped text with no markup injection.
- [ ] **Step 3:** Use DevTools device mode at 360 px, 768 px and 1280 px in both themes and both languages. Expected: no horizontal scroll, Thai text not clipped, sticky block works.
- [ ] **Step 4:** Keyboard-only pass: Tab through header → tabs → chips → cards, then Enter opens the dialog, Esc closes it, and focus returns. Expected: a visible focus ring the whole way.
- [ ] **Step 5:** Run `npm test`. Expected: all PASS (the i18n parity test catches missing TH strings).
- [ ] **Step 6:** Commit: `feat(ui): dashboard, list view, skeletons, copy, highlight, sort`.

---

### Task 9: Final verification and release

**Files:** none new.

- [ ] **Step 1:** Run `npm test`. Expected: all PASS.
- [ ] **Step 2:** Point the frontend at the real API (no `?mock`) on `localhost`. Expected: items load, and the response is cached (the Network tab shows a single `action=items` request; a reload within 5 min shows data instantly).
- [ ] **Step 3:** Edit one cell in the Google Sheet (owner does this), wait 5 s, then click Refresh. Expected: the change appears, which proves `onEdit` invalidation.
- [ ] **Step 4:** Re-run Task 6 Steps 3–7 against real data.
- [ ] **Step 5: HUMAN CHECKPOINT.** Summarize the changes, the test results and the measured payload size to the owner. After approval, `git push` to the hosting branch. After the new frontend is confirmed live, open a follow-up note (do not do it now) on removing `action=search`/`getAll` from `Code.js`.

---

## Follow-ups (not in this plan)

- Real access control: serve the UI from Apps Script `HtmlService` with `access: DOMAIN`. This depends on the owner's decision.
- Typo-tolerant search (e.g. Fuse.js), only if token search still misses things in practice.
- In-cell images (`CellImage`) cannot be exported via `getValues()`. The owner should store Drive links in the image column instead.
