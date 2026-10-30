/**
 * Every user-visible string, in both languages.
 * tests/search.test.js asserts that en and th expose exactly the same keys.
 */

export const STRINGS = {
  en: {
    logoText: 'DIS INVENTORY',
    logoSub: 'LIVE · GOOGLE SHEETS',

    searchPlaceholder: 'Search name, barcode, serial, user…',
    clearSearch: 'Clear search',

    initialTitle: 'Search or scan to find items',
    initialSub: 'Type a name, barcode, serial or person — or scan with the barcode gun.',
    scanBtnLabel: 'Scan Barcode',
    loadingText: 'Fetching data…',

    noResultsTitle: 'No items found',
    noResultsSub: 'Try a different search term or barcode',
    itemsFound: (n) => `${n} item${n === 1 ? '' : 's'}`,

    errorTimeout: 'The server took too long to answer. Check your connection and try again.',
    errorHttp: 'The server returned an error.',
    errorParse: 'The server sent an unexpected response.',
    errorApi: 'The server reported a problem.',
    retry: 'Retry',
    staleNote: 'Showing saved data — could not refresh.',
    updatedPrefix: 'Updated',
    refresh: 'Refresh data',

    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
    viewGrid: 'Grid view',
    viewList: 'List view',
    viewLabel: 'Change view',

    sortLabel: 'Sort',
    sortRelevance: 'Relevance',
    sortName: 'Name',
    sortDate: 'Date',
    sortStatus: 'Status',

    dashboardTitle: 'Browse everything',
    dashboardStatus: 'By status',
    dashboardSheets: 'By department',
    showAll: 'Show all',

    copy: 'Copy',
    copied: 'Copied',
    close: 'Close',
    noName: '(No name)',
    zoomImage: 'View full size',

    statusAll: 'All',
    sheetAll: 'All',

    fields: {
      barcode: 'Barcode',
      serial: 'Serial No.',
      price: 'Price',
      date: 'Purchase Date',
      warranty: 'Warranty',
      status: 'Status',
      condition: 'Condition',
      reference: 'Receipt Ref.',
      location: 'User / Location',
      category: 'Category',
      sheet: 'Department',
    },
  },

  th: {
    logoText: 'DIS ระบบครุภัณฑ์',
    logoSub: 'ข้อมูลสด · GOOGLE SHEETS',

    searchPlaceholder: 'ค้นหาชื่อ บาร์โค้ด ซีเรียล ผู้ใช้…',
    clearSearch: 'ล้างคำค้นหา',

    initialTitle: 'ค้นหาหรือสแกนเพื่อดูรายการ',
    initialSub: 'พิมพ์ชื่อ บาร์โค้ด ซีเรียล หรือชื่อผู้ใช้ — หรือใช้เครื่องสแกนบาร์โค้ด',
    scanBtnLabel: 'สแกนบาร์โค้ด',
    loadingText: 'กำลังโหลดข้อมูล…',

    noResultsTitle: 'ไม่พบรายการ',
    noResultsSub: 'ลองค้นหาด้วยคำอื่น หรือบาร์โค้ดอื่น',
    itemsFound: (n) => `พบ ${n} รายการ`,

    errorTimeout: 'เซิร์ฟเวอร์ตอบช้าเกินไป ตรวจสอบสัญญาณแล้วลองใหม่',
    errorHttp: 'เซิร์ฟเวอร์ตอบกลับผิดพลาด',
    errorParse: 'เซิร์ฟเวอร์ส่งข้อมูลในรูปแบบที่ไม่คาดคิด',
    errorApi: 'เซิร์ฟเวอร์แจ้งว่ามีปัญหา',
    retry: 'ลองใหม่',
    staleNote: 'กำลังแสดงข้อมูลที่บันทึกไว้ — รีเฟรชไม่สำเร็จ',
    updatedPrefix: 'อัปเดตเมื่อ',
    refresh: 'รีเฟรชข้อมูล',

    themeToLight: 'เปลี่ยนเป็นธีมสว่าง',
    themeToDark: 'เปลี่ยนเป็นธีมมืด',
    viewGrid: 'มุมมองตาราง',
    viewList: 'มุมมองรายการ',
    viewLabel: 'เปลี่ยนมุมมอง',

    sortLabel: 'เรียงตาม',
    sortRelevance: 'ความเกี่ยวข้อง',
    sortName: 'ชื่อ',
    sortDate: 'วันที่',
    sortStatus: 'สถานะ',

    dashboardTitle: 'ดูทั้งหมด',
    dashboardStatus: 'ตามสถานะ',
    dashboardSheets: 'ตามแผนก',
    showAll: 'แสดงทั้งหมด',

    copy: 'คัดลอก',
    copied: 'คัดลอกแล้ว',
    close: 'ปิด',
    noName: '(ไม่มีชื่อ)',
    zoomImage: 'ดูรูปขนาดเต็ม',

    statusAll: 'ทั้งหมด',
    sheetAll: 'ทั้งหมด',

    fields: {
      barcode: 'บาร์โค้ด',
      serial: 'หมายเลขซีเรียล',
      price: 'ราคา',
      date: 'วันที่บันทึก',
      warranty: 'การรับประกัน',
      status: 'สถานะ',
      condition: 'สภาพ',
      reference: 'อ้างอิงใบเสร็จ',
      location: 'ผู้ใช้ / สถานที่',
      category: 'ประเภท',
      sheet: 'แผนก',
    },
  },
};

/** Status buckets, keyed by statusKey(). `other` is shown with its raw text. */
export const STATUS = {
  using:   { en: 'In Use / Normal',     th: 'ใช้งาน / ปกติ' },
  broken:  { en: 'Broken',              th: 'ชำรุด' },
  repair:  { en: 'Under repair',        th: 'ส่งซ่อม' },
  lost:    { en: 'Lost / Searching',    th: 'สูญหาย / ตามหา' },
  standby: { en: 'Stand-by',            th: 'สแตนด์บาย' },
  none:    { en: 'No status',           th: 'ไม่ระบุสถานะ' },
  other:   { en: 'Other',               th: 'อื่น ๆ' },
};

/** Order used for chips, dashboard tiles and status sorting. */
export const STATUS_ORDER = ['using', 'broken', 'repair', 'lost', 'standby', 'other', 'none'];

/** Sheet condition values, verbatim from the spreadsheet. */
export const CONDITION = {
  'ปกติ':                        { en: 'Normal',           th: 'ปกติ' },
  'ชำรุด':                       { en: 'Damaged',          th: 'ชำรุด' },
  'ใกล้พัง ( ใช้งานเกินกำหนด )': { en: 'Near End of Life', th: 'ใกล้พัง' },
  'เลิกใช้งาน':                  { en: 'Discontinued',     th: 'เลิกใช้งาน' },
};

/** The nine sheet tabs, in spreadsheet order. */
export const SHEETS = [
  { id: 'IT',                            en: 'IT',              th: 'IT' },
  { id: 'DEC_Appliance',                 en: 'DEC Appliance',   th: 'เครื่องใช้ไฟฟ้า DEC' },
  { id: 'DIS_Appliance',                 en: 'DIS Appliance',   th: 'เครื่องใช้ไฟฟ้า DIS' },
  { id: 'Vehicle',                       en: 'Vehicle',         th: 'ยานพาหนะ' },
  { id: 'Health and Medical Equipment',  en: 'Health & Medical', th: 'สุขภาพและการแพทย์' },
  { id: 'Sport',                         en: 'Sport',           th: 'กีฬา' },
  { id: 'DIS_Kitchen',                   en: 'DIS Kitchen',     th: 'ครัว DIS' },
  { id: 'Furniture DEC',                 en: 'Furniture DEC',   th: 'เฟอร์นิเจอร์ DEC' },
  { id: 'Furniture DIS',                 en: 'Furniture DIS',   th: 'เฟอร์นิเจอร์ DIS' },
];

/** Sheet id -> localized label, falling back to the raw id. */
export function sheetLabel(id, lang) {
  const found = SHEETS.find(s => s.id === id);
  if (!found) return String(id ?? '');
  return found[lang] || found.en;
}
