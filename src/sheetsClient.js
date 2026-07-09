const { google } = require('googleapis');
require('dotenv').config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
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

// Đọc toàn bộ dữ liệu 1 sheet (trả về mảng 2 chiều, hàng đầu là tiêu đề)
async function docSheet(tenSheet) {
  const sheets = await laySheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: tenSheet
  });
  return res.data.values || [];
}

// Ghi thêm nhiều hàng vào cuối sheet
async function themHang(tenSheet, danhSachHang) {
  if (!danhSachHang.length) return;
  const sheets = await laySheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: tenSheet,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: danhSachHang }
  });
}

// Cập nhật 1 vùng cụ thể (vd: 1 ô hoặc 1 hàng), notation kiểu "Case_Summary!D5"
async function capNhatVung(pham_vi, values) {
  const sheets = await laySheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: pham_vi,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
}

module.exports = { laySheetsClient, docSheet, themHang, capNhatVung, SPREADSHEET_ID };
