const { docSheetVatTu, capNhatVungVatTu, themHangVatTu } = require('./sheetsClient');
const { guiThongBaoVatTu } = require('./zaloNotify');

// Helper chuẩn hóa chuỗi để so khớp
function normalizeStr(str) {
  return (str || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(str) {
  return normalizeStr(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function laChiDinh(muc) {
  return normalizeForMatch(muc.nhom).includes('chi dinh');
}

function laySoLuongYeuCau(muc) {
  const soLuong = Number.parseInt(muc.sl, 10);
  return Number.isFinite(soLuong) && soLuong > 0 ? soLuong : 1;
}

// 1. Lấy tổng quan (Dashboard Vật Tư)
async function layTongQuan() {
  const db = await docSheetVatTu('DB_VatTu');
  const result = {
    tongDungCu: 0,
    dangHoatDong: 0,
    sapHet: 0,
    daHet: 0,
    huHong: 0,
    danhSachCanhBao: []
  };

  for (let i = 1; i < db.length; i++) {
    const maQL = String(db[i][0] || '').trim();
    if (!maQL) continue;
    
    result.tongDungCu++;
    
    const tenVT = String(db[i][2] || '').trim();
    const gioiHan = parseInt(db[i][3]) || 0;
    const daDung = parseInt(db[i][4]) || 0;
    const trangThai = String(db[i][5] || '');

    if (trangThai.includes('Hỏng')) {
      result.huHong++;
    } else if (trangThai.includes('Hết')) {
      result.daHet++;
      result.danhSachCanhBao.push({ maQL, tenVT, daDung, gioiHan, trangThai: 'Đã hết' });
    } else if (trangThai.includes('Sẵn sàng')) {
      // Mọi dụng cụ có trạng thái Sẵn sàng đều đang dùng được, kể cả dụng cụ mới (Đã dùng = 0).
      result.dangHoatDong++;
      
      const conLai = gioiHan - daDung;
      if (conLai <= 2) {
        result.sapHet++;
        result.danhSachCanhBao.push({ maQL, tenVT, daDung, gioiHan, trangThai: 'Sắp hết' });
      }
    }
  }

  return result;
}

// 2. Lấy tồn kho chi tiết
async function layTonKho() {
  const db = await docSheetVatTu('DB_VatTu');
  const tonKho = {};

  for (let i = 1; i < db.length; i++) {
    const maQL = String(db[i][0] || '').trim();
    if (!maQL) continue;

    const maBC = String(db[i][1] || '').trim();
    const tenVT = String(db[i][2] || '').trim();
    const gioiHan = parseInt(db[i][3]) || 0;
    const daDung = parseInt(db[i][4]) || 0;
    const trangThai = String(db[i][5] || '');
    const thongBao = String(db[i][7] || '');
    const ngayNhap = String(db[i][6] || '');

    if (!tonKho[tenVT]) {
      tonKho[tenVT] = { tenVT, danhSach: [] };
    }

    tonKho[tenVT].danhSach.push({
      maQL, maBC, gioiHan, daDung, conLai: gioiHan - daDung, trangThai, thongBao, ngayNhap
    });
  }

  return Object.values(tonKho);
}

async function layAnhXaChiDinh() {
  const khopData = await docSheetVatTu('KhopChiDinh');
  const dsAnhXa = [];
  for (let i = 1; i < (khopData || []).length; i++) {
    const keyword = normalizeForMatch(khopData[i][0]);
    const tenVatTu = String(khopData[i][1] || '').trim();
    if (keyword && tenVatTu) dsAnhXa.push({ keyword, tenVatTu });
  }
  return dsAnhXa;
}

// Khớp chỉ định của dữ liệu vừa upload hoặc Data_Log với vật tư cần dùng.
// soLuongCanDung được giữ lại để bắt buộc chọn đủ số cây trước khi chốt.
async function goiYChiDinhTuDanhSachMuc(danhSachMuc) {
  const dsAnhXa = await layAnhXaChiDinh();
  const soLuongTheoVatTu = new Map();

  for (const muc of danhSachMuc || []) {
    if (!laChiDinh(muc)) continue;
    const tenChiDinh = normalizeForMatch(muc.tenMuc);
    if (!tenChiDinh) continue;
    for (const anhXa of dsAnhXa) {
      if (tenChiDinh.includes(anhXa.keyword) || anhXa.keyword.includes(tenChiDinh)) {
        soLuongTheoVatTu.set(
          anhXa.tenVatTu,
          (soLuongTheoVatTu.get(anhXa.tenVatTu) || 0) + laySoLuongYeuCau(muc)
        );
      }
    }
  }

  if (soLuongTheoVatTu.size === 0) return [];

  const db = await docSheetVatTu('DB_VatTu');
  const danhSachGoiY = [];
  for (const [tenVT, soLuongCanDung] of soLuongTheoVatTu) {
    const cacCaySanSang = [];
    for (let i = 1; i < db.length; i++) {
      const dbTenVT = String(db[i][2] || '').trim();
      const trangThai = String(db[i][5] || '');
      if (dbTenVT === tenVT && trangThai.includes('Sẵn sàng')) {
        cacCaySanSang.push({
          maQL: String(db[i][0] || '').trim(),
          maBC: String(db[i][1] || '').trim(),
          tenVT: dbTenVT,
          daDung: parseInt(db[i][4]) || 0,
          gioiHan: parseInt(db[i][3]) || 0,
          dongTrongDB: i + 1
        });
      }
    }
    cacCaySanSang.sort((a, b) => b.daDung - a.daDung);
    danhSachGoiY.push({ tenVatTuYeuCau: tenVT, soLuongCanDung, danhSachCay: cacCaySanSang });
  }
  return danhSachGoiY;
}

// 3. Khớp chỉ định đã lưu (dùng khi chốt lại từ Dashboard)
async function goiYChiDinh(maBN, ngayMo) {
  const { docSheet } = require('./sheetsClient');
  const dataLog = await docSheet('Data_Log');

  let maxLanUpload = 0;
  for (let i = 1; i < dataLog.length; i++) {
    if (String(dataLog[i][0] || '').trim() === maBN && String(dataLog[i][2] || '').trim() === ngayMo) {
      maxLanUpload = Math.max(maxLanUpload, Number(dataLog[i][11]) || 0);
    }
  }

  if (maxLanUpload === 0) return [];

  const danhSachMuc = [];
  for (let i = 1; i < dataLog.length; i++) {
    if (String(dataLog[i][0] || '').trim() === maBN &&
        String(dataLog[i][2] || '').trim() === ngayMo &&
        Number(dataLog[i][11]) === maxLanUpload) {
      danhSachMuc.push({ nhom: dataLog[i][3], tenMuc: dataLog[i][5], sl: dataLog[i][7] });
    }
  }
  return goiYChiDinhTuDanhSachMuc(danhSachMuc);
}

function kiemTraLuaChonVatTu(danhSachVatTuChon, danhSachGoiY) {
  const daChon = (danhSachVatTuChon || []).map(ma => String(ma || '').trim()).filter(Boolean);
  if (new Set(daChon).size !== daChon.length) return { hopLe: false, message: 'Một cây vật tư chỉ được chọn một lần.' };

  const tatCaMaDuocPhep = new Set();
  for (const nhom of danhSachGoiY || []) {
    const maTheoNhom = new Set((nhom.danhSachCay || []).map(cay => cay.maQL));
    maTheoNhom.forEach(ma => tatCaMaDuocPhep.add(ma));
    const soDaChon = daChon.filter(ma => maTheoNhom.has(ma)).length;
    if (soDaChon !== nhom.soLuongCanDung) {
      return {
        hopLe: false,
        message: `Vật tư "${nhom.tenVatTuYeuCau}" cần chọn đúng ${nhom.soLuongCanDung} cây sẵn sàng (đang chọn ${soDaChon}).`
      };
    }
  }
  if (daChon.some(ma => !tatCaMaDuocPhep.has(ma))) return { hopLe: false, message: 'Có cây vật tư không thuộc danh sách được đề xuất.' };
  return { hopLe: true };
}

// 4. Xử lý ghi nhận sử dụng (Sau khi user chọn các cây cụ thể)
async function xuLyKhiChot(maBN, ngayMo, infoCa, danhSachVatTuChon) {
  if (!danhSachVatTuChon || danhSachVatTuChon.length === 0) return;

  const db = await docSheetVatTu('DB_VatTu');
  const thoiGianGhi = new Date().toLocaleString('vi-VN');
  const logsToInsert = [];

  for (const maQLChon of danhSachVatTuChon) {
    // Tìm dòng tương ứng trong DB_VatTu
    let dongTimThay = -1;
    let tenVT = '';
    let gioiHan = 0;
    let daDung = 0;

    for (let i = 1; i < db.length; i++) {
      if (String(db[i][0] || '').trim() === maQLChon) {
        dongTimThay = i + 1;
        tenVT = String(db[i][2] || '').trim();
        gioiHan = parseInt(db[i][3]) || 0;
        daDung = parseInt(db[i][4]) || 0;
        break;
      }
    }

    if (dongTimThay > -1) {
      const daDungMoi = daDung + 1;
      let trangThaiMoi = "🟢 Sẵn sàng";
      let guiZalo = null;

      if (daDungMoi >= gioiHan) {
        trangThaiMoi = "🔴 Hết";
        guiZalo = "HẾT HẠN";
      }

      // Cập nhật cell DB_VatTu
      await capNhatVungVatTu(`DB_VatTu!E${dongTimThay}:F${dongTimThay}`, [[daDungMoi, trangThaiMoi]]);

      // Lưu trữ log để insert bulk
      // Log_SuDung: ThoiGian, MaBN, HoTenBN, ChanDoan, PPPT, PTV, MaQL_VatTu, LanDungThu
      logsToInsert.push([
        thoiGianGhi, maBN, infoCa.hoTenBN || '', infoCa.chanDoan || '', infoCa.pppt || '', infoCa.ptv || '', maQLChon, daDungMoi
      ]);

      // Gửi Zalo nếu cần (asynchronous chạy ngầm)
      if (guiZalo) {
        guiThongBaoVatTu(tenVT, maQLChon, gioiHan, daDungMoi, guiZalo).catch(err => console.error("Lỗi gửi Zalo ngầm:", err));
      }
    }
  }

  if (logsToInsert.length > 0) {
    await themHangVatTu('Log_SuDung', logsToInsert);
  }
}

// 5. Báo hỏng
async function baoHongVatTu(maQL, lyDo) {
  const db = await docSheetVatTu('DB_VatTu');
  let dongTimThay = -1;
  let tenVT = '';
  let gioiHan = 0;
  let daDung = 0;

  for (let i = 1; i < db.length; i++) {
    if (String(db[i][0] || '').trim() === maQL) {
      dongTimThay = i + 1;
      tenVT = String(db[i][2] || '').trim();
      gioiHan = parseInt(db[i][3]) || 0;
      daDung = parseInt(db[i][4]) || 0;
      break;
    }
  }

  if (dongTimThay === -1) throw new Error('Không tìm thấy mã vật tư này.');

  const trangThaiMoi = `🔴 Hỏng - ${lyDo}`;
  await capNhatVungVatTu(`DB_VatTu!F${dongTimThay}:F${dongTimThay}`, [[trangThaiMoi]]);

  // Gửi Zalo báo hỏng
  guiThongBaoVatTu(tenVT, maQL, gioiHan, daDung, "HỎNG").catch(err => console.error(err));
  
  return { success: true };
}

// 6. Nhập vật tư mới
async function nhapVatTuMoi(data) {
  const { code, tenVatTu, soLuong, gioiHan, nguoiNhap } = data;
  
  const db = await docSheetVatTu('DB_VatTu');
  let maxSuffix = 0;
  const prefix = tenVatTu.trim();

  // Tìm index lớn nhất hiện tại (VD: Dao Harmonic-005 thì max = 5)
  for (let i = 1; i < db.length; i++) {
    const maQL = String(db[i][0] || '').trim();
    if (maQL.startsWith(prefix)) {
      const parts = maQL.split('-');
      const suffix = parseInt(parts[parts.length - 1]);
      if (!isNaN(suffix) && suffix > maxSuffix) {
        maxSuffix = suffix;
      }
    }
  }

  const rows = [];
  const tg = new Date().toLocaleString('vi-VN');
  const ngayNhap = `${tg} - ${nguoiNhap || 'Khong ro'}`;
  
  for (let i = 1; i <= soLuong; i++) {
    const n = (maxSuffix + i).toString().padStart(3, '0');
    const maQLMoi = `${prefix}-${n}`;
    // DB_VatTu cols: MaQL, MaBC, TenVatTu, GioiHan, DaDung, TrangThai, NgayNhap, ThongBao
    rows.push([maQLMoi, code, prefix, gioiHan, 0, '🟢 Sẵn sàng', ngayNhap, '']);
  }

  if (rows.length > 0) {
    await themHangVatTu('DB_VatTu', rows);
  }
  
  return { success: true, message: `Đã nhập ${soLuong} cây ${prefix}` };
}

// 7. Lấy lịch sử sử dụng của 1 vật tư (phục vụ xuất báo cáo)
async function layLichSuVatTu(maQL) {
  const { docSheetVatTu } = require('./sheetsClient');
  // Đọc sheet Log_SuDung: ThoiGian, MaBN, HoTenBN, ChanDoan, PPPT, PTV, MaQL_VatTu, LanDungThu
  const dataLog = await docSheetVatTu('Log_SuDung');
  const lichSu = [];

  if (dataLog && dataLog.length > 0) {
    for (let i = 1; i < dataLog.length; i++) {
      const logMaQL = String(dataLog[i][6] || '').trim();
      if (logMaQL === maQL) {
        lichSu.push({
          thoiGian: String(dataLog[i][0] || ''),
          maBN: String(dataLog[i][1] || ''),
          hoTenBN: String(dataLog[i][2] || ''),
          chanDoan: String(dataLog[i][3] || ''),
          pppt: String(dataLog[i][4] || ''),
          ptv: String(dataLog[i][5] || ''),
          lanDungThu: String(dataLog[i][7] || '')
        });
      }
    }
  }

  // Lấy thêm thông tin chung của cây vật tư từ DB_VatTu
  const db = await docSheetVatTu('DB_VatTu');
  let info = null;
  if (db && db.length > 0) {
    for (let i = 1; i < db.length; i++) {
      if (String(db[i][0] || '').trim() === maQL) {
        info = {
          maQL,
          maBC: String(db[i][1] || ''),
          tenVT: String(db[i][2] || ''),
          gioiHan: parseInt(db[i][3]) || 0,
          daDung: parseInt(db[i][4]) || 0,
          trangThai: String(db[i][5] || '')
        };
        break;
      }
    }
  }

  return { info, lichSu };
}

// 8. Lấy danh mục vật tư
async function layDanhMucVatTu() {
  const { docSheetVatTu } = require('./sheetsClient');
  const db = await docSheetVatTu('DanhMucVatTu');
  const danhMuc = [];
  if (db && db.length > 0) {
    for (let i = 1; i < db.length; i++) {
      const tenVT = String(db[i][1] || '').trim();
      if (tenVT) {
        danhMuc.push({
          tenVT,
          maBC: String(db[i][2] || '').trim(),
          gioiHan: parseInt(db[i][3]) || 0
        });
      }
    }
  }
  return danhMuc;
}

// 9. Xuất báo cáo qua Google Sheets (giống coreGenerateReport trong GAS cũ)
async function xuatBaoCao(maQL) {
  const { laySheetsClient, SPREADSHEET_ID_VATTU } = require('./sheetsClient');
  if (!SPREADSHEET_ID_VATTU) throw new Error('Chưa cấu hình GOOGLE_SHEET_ID_VATTU');

  const sheets = await laySheetsClient();

  // 1. Lấy dữ liệu lịch sử + info từ layLichSuVatTu
  const { info, lichSu } = await layLichSuVatTu(maQL);
  if (!info) throw new Error('Không tìm thấy vật tư: ' + maQL);

  // 2. Tạo sheet tạm
  const tenSheetTam = 'Export_BaoCao_TAMP_' + Date.now();
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID_VATTU,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tenSheetTam } } }]
    }
  });
  const sheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  // 3. Ghi header + data
  const headerRows = [
    ['BỆNH VIỆN ĐA KHOA GIA ĐỊNH'],
    ['Khoa PT - Gây mê hồi sức'],
    [''],
    ['CHI TIẾT SỬ DỤNG: ' + maQL],
    [`(${info.tenVT} | Mã KT: ${info.maBC} | Đã dùng: ${info.daDung}/${info.gioiHan})`],
    [''],
    ['STT', 'TÊN BỆNH NHÂN', 'MÃ HS', 'CHẨN ĐOÁN', 'PPPT', 'PTV', 'THỜI GIAN', 'LẦN DÙNG']
  ];

  const dataRows = lichSu.map((l, idx) => [
    idx + 1,
    l.hoTenBN || '',
    l.maBN || '',
    l.chanDoan || '',
    l.pppt || '',
    l.ptv || '',
    l.thoiGian || '',
    l.lanDungThu || ''
  ]);

  // Dòng ký tên (cách 3 dòng trống)
  const signatureGap = [[''], [''], ['']];
  const signatureRow = [['TRƯỞNG KHOA', '', 'PHÒNG TCKT', '', 'KHOA DƯỢC', '', 'NGƯỜI LẬP', '']];

  const allData = [...headerRows, ...dataRows, ...signatureGap, ...signatureRow];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID_VATTU,
    range: `${tenSheetTam}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: allData }
  });

  // 4. Format: font Lexend, header đậm, màu sắc, merge, border
  const numDataRows = dataRows.length;
  const headerRowIdx = 6; // row 7 (0-indexed = 6)
  const dataStartRow = 7;
  const dataEndRow = dataStartRow + numDataRows;
  const signatureRowIdx = dataEndRow + 3;

  const formatRequests = [
    // Font Lexend toàn bộ
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: allData.length, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10 }, verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)'
      }
    },
    // Dòng 1: Tên BV, đậm
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true } } },
        fields: 'userEnteredFormat(textFormat)'
      }
    },
    // Dòng 2: Khoa, đậm
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true } } },
        fields: 'userEnteredFormat(textFormat)'
      }
    },
    // Dòng 4: Tiêu đề chính, merge, center, bold, 14pt
    {
      mergeCells: { range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 14, bold: true }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)'
      }
    },
    // Dòng 5: Phụ đề, merge, center, italic
    {
      mergeCells: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10, italic: true }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)'
      }
    },
    // Dòng 7 (header bảng): background #455a64, font trắng, bold, center, border
    {
      repeatCell: {
        range: { sheetId, startRowIndex: headerRowIdx, endRowIndex: headerRowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.271, green: 0.353, blue: 0.392 },
            textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER',
            borders: {
              top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
              bottom: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
              left: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
              right: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } }
            }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,borders)'
      }
    },
    // Border cho data rows
    {
      repeatCell: {
        range: { sheetId, startRowIndex: dataStartRow, endRowIndex: dataEndRow, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            borders: {
              top: { style: 'SOLID', color: { red: 0.565, green: 0.643, blue: 0.682 } },
              bottom: { style: 'SOLID', color: { red: 0.565, green: 0.643, blue: 0.682 } },
              left: { style: 'SOLID', color: { red: 0.565, green: 0.643, blue: 0.682 } },
              right: { style: 'SOLID', color: { red: 0.565, green: 0.643, blue: 0.682 } }
            }
          }
        },
        fields: 'userEnteredFormat(borders)'
      }
    },
    // Cột B (Tên BN) rộng hơn
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } },
    // Cột D (Chẩn đoán) rộng
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
    // Cột E (PPPT) rộng
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
  ];

  // Highlight dòng cuối (hết hạn) nếu daDung >= gioiHan
  if (info.daDung >= info.gioiHan && numDataRows > 0) {
    formatRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataEndRow - 1, endRowIndex: dataEndRow, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1, green: 0.922, blue: 0.933 },
            textFormat: { foregroundColor: { red: 0.827, green: 0.184, blue: 0.184 }, fontFamily: 'Lexend', fontSize: 10 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    });
  }

  // Dòng ký tên: bold, center
  if (signatureRowIdx < allData.length) {
    formatRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: signatureRowIdx, endRowIndex: signatureRowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)'
      }
    });
    // Merge signature cells
    formatRequests.push(
      { mergeCells: { range: { sheetId, startRowIndex: signatureRowIdx, endRowIndex: signatureRowIdx + 1, startColumnIndex: 0, endColumnIndex: 2 }, mergeType: 'MERGE_ALL' } },
      { mergeCells: { range: { sheetId, startRowIndex: signatureRowIdx, endRowIndex: signatureRowIdx + 1, startColumnIndex: 2, endColumnIndex: 4 }, mergeType: 'MERGE_ALL' } },
      { mergeCells: { range: { sheetId, startRowIndex: signatureRowIdx, endRowIndex: signatureRowIdx + 1, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
      { mergeCells: { range: { sheetId, startRowIndex: signatureRowIdx, endRowIndex: signatureRowIdx + 1, startColumnIndex: 6, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' } }
    );
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID_VATTU,
    requestBody: { requests: formatRequests }
  });

  // 5. Trả URLs
  const pdfUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID_VATTU}/export?format=pdf&gid=${sheetId}&size=A4&portrait=false&fitw=true&gridlines=true`;
  const excelUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID_VATTU}/export?format=xlsx&gid=${sheetId}`;

  return { pdfUrl, excelUrl, sheetId, tenSheetTam };
}

// 10. Xóa sheet tạm sau khi export
async function xoaSheetTam(sheetId) {
  const { laySheetsClient, SPREADSHEET_ID_VATTU } = require('./sheetsClient');
  if (!SPREADSHEET_ID_VATTU) return;
  const sheets = await laySheetsClient();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID_VATTU,
      requestBody: {
        requests: [{ deleteSheet: { sheetId } }]
      }
    });
  } catch (e) {
    console.error('Lỗi xóa sheet tạm:', e.message);
  }
}

module.exports = {
  layTongQuan,
  layTonKho,
  goiYChiDinh,
  goiYChiDinhTuDanhSachMuc,
  kiemTraLuaChonVatTu,
  xuLyKhiChot,
  baoHongVatTu,
  nhapVatTuMoi,
  layLichSuVatTu,
  layDanhMucVatTu,
  xuatBaoCao,
  xoaSheetTam
};
