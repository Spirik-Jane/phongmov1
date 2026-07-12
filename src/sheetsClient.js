const { google } = require('googleapis');
require('dotenv').config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SPREADSHEET_ID_VATTU = process.env.GOOGLE_SHEET_ID_VATTU;
const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './credentials/service-account.json';

let _sheetsClient = null;

async function laySheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const authClient = await auth.getClient();
  _sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  return _sheetsClient;
}

// ============ HÀM CHUNG (nhận spreadsheetId) ============

async function _docSheetChung(sheetId, tenSheet) {
  const sheets = await laySheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: tenSheet
  });
  return res.data.values || [];
}

async function _themHangChung(sheetId, tenSheet, danhSachHang) {
  if (!danhSachHang.length) return;
  const sheets = await laySheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: tenSheet,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: danhSachHang }
  });
}

async function _capNhatVungChung(sheetId, pham_vi, values) {
  const sheets = await laySheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: pham_vi,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
}

// ============ SHEET CA MỔ (giữ nguyên API cũ) ============

async function docSheet(tenSheet) {
  return _docSheetChung(SPREADSHEET_ID, tenSheet);
}

async function themHang(tenSheet, danhSachHang) {
  return _themHangChung(SPREADSHEET_ID, tenSheet, danhSachHang);
}

async function capNhatVung(pham_vi, values) {
  return _capNhatVungChung(SPREADSHEET_ID, pham_vi, values);
}

// ============ SHEET VẬT TƯ TIÊU HAO ============

async function docSheetVatTu(tenSheet) {
  if (!SPREADSHEET_ID_VATTU) throw new Error('Chưa cấu hình GOOGLE_SHEET_ID_VATTU trong .env');
  return _docSheetChung(SPREADSHEET_ID_VATTU, tenSheet);
}

async function themHangVatTu(tenSheet, danhSachHang) {
  if (!SPREADSHEET_ID_VATTU) throw new Error('Chưa cấu hình GOOGLE_SHEET_ID_VATTU trong .env');
  return _themHangChung(SPREADSHEET_ID_VATTU, tenSheet, danhSachHang);
}

async function capNhatVungVatTu(pham_vi, values) {
  if (!SPREADSHEET_ID_VATTU) throw new Error('Chưa cấu hình GOOGLE_SHEET_ID_VATTU trong .env');
  return _capNhatVungChung(SPREADSHEET_ID_VATTU, pham_vi, values);
}

module.exports = {
  laySheetsClient,
  docSheet, themHang, capNhatVung, SPREADSHEET_ID,
  docSheetVatTu, themHangVatTu, capNhatVungVatTu, SPREADSHEET_ID_VATTU
};
