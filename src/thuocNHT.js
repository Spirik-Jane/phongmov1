/**
 * Module Kiểm soát Thuốc Nghiện / Hướng Thần (N-HT)
 * 
 * - Quản lý danh mục thuốc N-HT
 * - Mở ống, ghi nhận sử dụng, hoàn trả dược
 * - Tổng kết ca trực (7h30 → 7h30)
 * - Xuất biên bản PDF/Excel qua Google Sheets
 */
const { docSheet, themHang, capNhatVung, SPREADSHEET_ID, laySheetsClient } = require('./sheetsClient');

const TAB_DANH_MUC = 'DanhMuc_ThuocNHT';
const TAB_LOG = 'Log_ThuocNHT';
const TAB_TONG_KET = 'TongKet_ThuocNHT';

// ============ HELPERS ============

/**
 * Xác định ngày làm việc theo ca trực 7h30 → 7h30.
 * Trước 7h30 sáng → thuộc ca hôm trước.
 */
function layNgayLamViec(thoiDiem) {
  const d = thoiDiem ? new Date(thoiDiem) : new Date();
  const gio = d.getHours();
  const phut = d.getMinutes();
  if (gio < 7 || (gio === 7 && phut < 30)) {
    d.setDate(d.getDate() - 1);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function layThoiGianHienTai() {
  return new Date().toLocaleString('vi-VN');
}

function normalizeStr(str) {
  return (str || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

// ============ DANH MỤC ============

async function layDanhMuc() {
  let data;
  try {
    data = await docSheet(TAB_DANH_MUC);
  } catch (err) {
    // Tab chưa tồn tại → trả rỗng
    return [];
  }
  if (!data || data.length <= 1) return [];
  // Headers: TenThuoc, HamLuong, DonViTinh, TongLieuOng, NhomThuoc, DuongDung, GhiChu
  return data.slice(1).map((row, idx) => ({
    stt: idx + 1,
    tenThuoc: String(row[0] || '').trim(),
    hamLuong: String(row[1] || '').trim(),
    donViTinh: String(row[2] || '').trim(),
    tongLieuOng: parseFloat(row[3]) || 0,
    nhomThuoc: String(row[4] || '').trim(),
    duongDung: String(row[5] || '').trim(),
    ghiChu: String(row[6] || '').trim()
  })).filter(t => t.tenThuoc);
}

async function themThuocVaoDanhMuc({ tenThuoc, hamLuong, donViTinh, tongLieuOng, nhomThuoc, duongDung, ghiChu }) {
  if (!tenThuoc) throw new Error('Thiếu tên thuốc');
  await themHang(TAB_DANH_MUC, [[
    tenThuoc, hamLuong || '', donViTinh || '', tongLieuOng || 0,
    nhomThuoc || '', duongDung || '', ghiChu || ''
  ]]);
  return { success: true, message: `Đã thêm thuốc "${tenThuoc}" vào danh mục.` };
}

async function suaDanhMuc(stt, data) {
  const rowIndex = stt + 1; // 1-indexed, skip header
  const range = `${TAB_DANH_MUC}!A${rowIndex}:G${rowIndex}`;
  await capNhatVung(range, [[
    data.tenThuoc || '', data.hamLuong || '', data.donViTinh || '',
    data.tongLieuOng || 0, data.nhomThuoc || '', data.duongDung || '', data.ghiChu || ''
  ]]);
  return { success: true, message: `Đã cập nhật thuốc STT ${stt}.` };
}

// ============ PHÂN QUYỀN KTV GÂY MÊ ============

async function kiemTraQuyenKTVGM(hoTen) {
  if (!hoTen) return false;
  try {
    const data = await docSheet('CSDL_NhanSu');
    if (!data || data.length <= 1) return false;
    // Headers: MaNV, TenDayDu, TenTrenLich, NhomNS_Chinh, ChuyenMon, ...
    const hoTenNorm = normalizeStr(hoTen);
    for (let i = 1; i < data.length; i++) {
      const tenDayDu = normalizeStr(data[i][1]);
      const tenTrenLich = normalizeStr(data[i][2]);
      if (tenDayDu === hoTenNorm || tenTrenLich === hoTenNorm || tenDayDu.includes(hoTenNorm) || hoTenNorm.includes(tenDayDu)) {
        const nhom = normalizeStr(data[i][3]);
        const chuyenMon = normalizeStr(data[i][4]);
        // Match: nhóm chứa "ktv" VÀ (nhóm hoặc chuyên môn chứa "gây mê" hoặc "gay me")
        const nhomNFD = nhom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
        const cmNFD = chuyenMon.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
        const isKTV = nhomNFD.includes('ktv');
        const isGM = nhomNFD.includes('gay me') || cmNFD.includes('gay me') || nhom.includes('gây mê') || chuyenMon.includes('gây mê');
        if (isKTV && isGM) return true;
      }
    }
  } catch (err) {
    console.error('Lỗi kiểm tra quyền KTV GM:', err);
  }
  return false;
}

// ============ MỞ ỐNG MỚI ============

async function taoMaOng(ngayLV, maPhong) {
  // Đếm số ống đã mở theo phòng trong ngày → tăng dần per phòng
  let logData;
  try {
    logData = await docSheet(TAB_LOG);
  } catch {
    logData = [];
  }

  const phongTag = maPhong ? `-${maPhong}` : '';
  const prefix = `NHT-${ngayLV.replace(/-/g, '')}${phongTag}-`;
  let maxSeq = 0;
  for (let i = 0; i < (logData || []).length; i++) {
    const maOng = String(logData[i][0] || '');
    if (maOng.startsWith(prefix)) {
      const seq = parseInt(maOng.substring(prefix.length)) || 0;
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

async function layDanhSachPhong() {
  try {
    // Đọc từ sheet Maping (nếu có) hoặc đọc từ cột 'phòng mổ' của sheet Đăng kí
    try {
      const data = await docSheet('Maping');
      if (data && data.length > 1) {
        // Lấy cột đầu tiên (mã phòng) và cột thứ hai (tên phòng) nếu có
        return data.slice(1)
          .map(row => ({
            ma: String(row[0] || '').trim(),
            ten: String(row[1] || row[0] || '').trim()
          }))
          .filter(p => p.ma);
      }
    } catch { /* sheet Maping chưa tồn tại → thử fallback */ }

    // Fallback: lấy danh sách phòng duy nhất từ sheet Đăng kí
    const data = await docSheet('Đăng kí').catch(() => docSheet('Đăng ký'));
    if (!data || data.length <= 1) return [];
    const tieuDe = data[0];
    const idxKhu = tieuDe.findIndex(h => String(h || '').toLowerCase().includes('phòng mổ') || String(h || '').toLowerCase().includes('phong mo'));
    if (idxKhu < 0) return [];
    const set = new Set();
    for (let i = 1; i < data.length; i++) {
      const val = String(data[i][idxKhu] || '').trim();
      if (val) set.add(val);
    }
    return [...set].sort().map(ten => ({ ma: ten, ten }));
  } catch (e) {
    console.error('layDanhSachPhong error:', e.message);
    return [];
  }
}

async function moOngMoi({ tenThuoc, soLo, hanDung, maPhong, nguoiGhi }) {
  if (!tenThuoc) throw new Error('Thiếu tên thuốc');

  // Tìm thông tin thuốc từ danh mục
  const danhMuc = await layDanhMuc();
  const thuoc = danhMuc.find(t => normalizeStr(t.tenThuoc) === normalizeStr(tenThuoc));
  if (!thuoc) throw new Error(`Không tìm thấy thuốc "${tenThuoc}" trong danh mục.`);

  const ngayLV = layNgayLamViec();
  const maOng = await taoMaOng(ngayLV, maPhong || '');
  const thoiGian = layThoiGianHienTai();

  // Ghi 1 dòng khởi tạo vào Log để ống vừa mở xuất hiện ngay trong danh sách.
  // MaBN để trống, liều dùng bằng 0 và trạng thái là MoOng.
  await themHang(TAB_LOG, [[
    maOng, thuoc.tenThuoc, thuoc.hamLuong, thuoc.tongLieuOng, thuoc.donViTinh,
    soLo || '', hanDung || '',
    '', '', 0, '', thoiGian,
    '', nguoiGhi || '',
    ngayLV, 'MoOng', '', '', maPhong || ''
  ]]);

  return {
    success: true,
    maOng,
    thuoc: {
      tenThuoc: thuoc.tenThuoc,
      hamLuong: thuoc.hamLuong,
      donViTinh: thuoc.donViTinh,
      tongLieuOng: thuoc.tongLieuOng,
      nhomThuoc: thuoc.nhomThuoc,
      duongDung: thuoc.duongDung
    },
    soLo: soLo || '',
    hanDung: hanDung || '',
    ngayLamViec: ngayLV,
    maPhong: maPhong || '',
    nguoiGhi: nguoiGhi || '',
    thoiGian
  };
}

// ============ GHI NHẬN SỬ DỤNG ============

async function layThongTinOng(maOng) {
  let logData;
  try {
    logData = await docSheet(TAB_LOG);
  } catch {
    logData = [];
  }
  if (!logData || logData.length === 0) return null;

  const dsSuDung = [];
  const dsHoanTra = [];
  let tongLieuOng = 0;
  let tenThuoc = '', hamLuong = '', donViTinh = '', soLo = '', hanDung = '';
  let ngayLamViecGoc = '';

  for (let i = 0; i < logData.length; i++) {
    const row = logData[i];
    const rowMaOng = String(row[0] || '').trim();
    if (!rowMaOng.startsWith('NHT-') || rowMaOng !== maOng) continue;

    tenThuoc = String(row[1] || '').trim();
    hamLuong = String(row[2] || '').trim();
    tongLieuOng = parseFloat(row[3]) || tongLieuOng;
    donViTinh = String(row[4] || '').trim();
    soLo = String(row[5] || '').trim() || soLo;
    hanDung = String(row[6] || '').trim() || hanDung;
    if (!ngayLamViecGoc) ngayLamViecGoc = String(row[14] || '').trim();

    const trangThai = String(row[15] || '').trim();
    const entry = {
      maBN: String(row[7] || '').trim(),
      hoTenBN: String(row[8] || '').trim(),
      lieuDung: parseFloat(row[9]) || 0,
      duongDung: String(row[10] || '').trim(),
      thoiGianDung: String(row[11] || '').trim(),
      nguoiThucHien: String(row[12] || '').trim(),
      nguoiGhi: String(row[13] || '').trim(),
      trangThai,
      lyDoHoanTra: String(row[16] || '').trim(),
      nguoiChungKien: String(row[17] || '').trim()
    };

    if (trangThai === 'SuDung') {
      dsSuDung.push(entry);
    } else if (trangThai === 'HoanTra' || trangThai === 'VoOng') {
      dsHoanTra.push(entry);
    }
  }

  if (!tenThuoc && dsSuDung.length === 0 && dsHoanTra.length === 0) return null;

  const tongDaDung = dsSuDung.reduce((sum, e) => sum + e.lieuDung, 0);
  const tongDaHoanTra = dsHoanTra.reduce((sum, e) => sum + e.lieuDung, 0);
  const conLai = Math.max(0, tongLieuOng - tongDaDung - tongDaHoanTra);
  const daDong = conLai === 0;

  return {
    maOng, tenThuoc, hamLuong, donViTinh, tongLieuOng, soLo, hanDung,
    tongDaDung, tongDaHoanTra, conLai, ngayLamViecGoc,
    trangThaiOng: daDong ? 'DaDong' : 'DangMo',
    dsSuDung, dsHoanTra
  };
}

async function ghiNhanSuDung({ maOng, tenThuoc, hamLuong, tongLieuOng, donViTinh, soLo, hanDung,
  maBN, hoTenBN, lieuDung, duongDung, nguoiThucHien, nguoiGhi }) {
  if (!maOng || !maBN || !lieuDung) throw new Error('Thiếu thông tin: maOng, maBN, lieuDung');

  // Validate liều
  const info = await layThongTinOng(maOng);
  if (info) {
    if (info.trangThaiOng === 'DaDong') {
      throw new Error(`Ống ${maOng} đã đóng, không thể ghi nhận thêm.`);
    }
    if (lieuDung > info.conLai + 0.01) {
      throw new Error(`Liều ${lieuDung} vượt phần còn lại (${info.conLai} ${info.donViTinh}).`);
    }
  }

  const ngayLV = info ? (info.ngayLamViecGoc || layNgayLamViec()) : layNgayLamViec();
  const thoiGian = layThoiGianHienTai();

  // Cột: MaOng, TenThuoc, HamLuong, TongLieuOng, DonViTinh, SoLo, HanDung,
  //       MaBN, HoTenBN, LieuDung, DuongDung, ThoiGianDung, NguoiThucHien, NguoiGhi,
  //       NgayLamViec, TrangThai, LyDoHoanTra, NguoiChungKien, GhiChu
  await themHang(TAB_LOG, [[
    maOng, tenThuoc || '', hamLuong || '', tongLieuOng || 0, donViTinh || '',
    soLo || '', hanDung || '',
    maBN, hoTenBN || '', lieuDung, duongDung || '', thoiGian,
    nguoiThucHien || '', nguoiGhi || '',
    ngayLV, 'SuDung', '', '', ''
  ]]);

  // Lấy lại thông tin ống sau khi ghi
  const updatedInfo = await layThongTinOng(maOng);

  return {
    success: true,
    message: `Đã ghi nhận: ${hoTenBN || maBN} dùng ${lieuDung} ${donViTinh || ''}`,
    ong: updatedInfo
  };
}

// ============ HOÀN TRẢ DƯỢC ============

async function ghiNhanHoanTra({ maOng, tenThuoc, hamLuong, tongLieuOng, donViTinh, soLo, hanDung,
  lieuHoanTra, lyDo, loai, nguoiChungKien, nguoiGhi }) {
  if (!maOng) throw new Error('Thiếu mã ống');

  const info = await layThongTinOng(maOng);
  if (!info) {
    throw new Error(`Không tìm thấy thông tin ống ${maOng}.`);
  }
  if (info.trangThaiOng === 'DaDong') {
    throw new Error(`Ống ${maOng} đã đóng (trạng thái: ${info.trangThaiOng}).`);
  }
  // Nếu không chỉ định lieuHoanTra → lấy phần còn lại
  if (!lieuHoanTra && lieuHoanTra !== 0) {
    lieuHoanTra = info.conLai;
  }
  if (lieuHoanTra > info.conLai + 0.01) {
    throw new Error(`Liều hoàn trả (${lieuHoanTra}) vượt phần còn lại (${info.conLai}).`);
  }

  const ngayLV = info.ngayLamViecGoc || layNgayLamViec();
  const thoiGian = layThoiGianHienTai();
  const trangThai = loai === 'VoOng' ? 'VoOng' : 'HoanTra';

  await themHang(TAB_LOG, [[
    maOng, tenThuoc || (info && info.tenThuoc) || '', hamLuong || (info && info.hamLuong) || '',
    tongLieuOng || (info && info.tongLieuOng) || 0, donViTinh || (info && info.donViTinh) || '',
    soLo || (info && info.soLo) || '', hanDung || (info && info.hanDung) || '',
    '', '', // MaBN, HoTenBN rỗng
    lieuHoanTra, '', thoiGian,
    '', nguoiGhi || '',
    ngayLV, trangThai, lyDo || '', nguoiChungKien || '', ''
  ]]);

  const updatedInfo = await layThongTinOng(maOng);
  return {
    success: true,
    message: `Đã hoàn trả ${lieuHoanTra} ${donViTinh || (info && info.donViTinh) || ''} về khoa dược.`,
    ong: updatedInfo
  };
}

// ============ DANH SÁCH ỐNG ĐANG MỞ ============

async function layDanhSachOngDangMo(ngayLV) {
  if (!ngayLV) ngayLV = layNgayLamViec();
  let logData;
  try {
    logData = await docSheet(TAB_LOG);
  } catch {
    return [];
  }
  if (!logData || logData.length === 0) return [];

  // Nhóm theo MaOng trong ngày
  const ongMap = {};
  for (let i = 0; i < logData.length; i++) {
    const row = logData[i];
    const maOng = String(row[0] || '').trim();
    const ngay = String(row[14] || '').trim();
    if (!maOng.startsWith('NHT-') || ngay !== ngayLV) continue;

    if (!ongMap[maOng]) {
      ongMap[maOng] = {
        maOng,
        tenThuoc: String(row[1] || '').trim(),
        hamLuong: String(row[2] || '').trim(),
        tongLieuOng: parseFloat(row[3]) || 0,
        donViTinh: String(row[4] || '').trim(),
        soLo: String(row[5] || '').trim(),
        hanDung: String(row[6] || '').trim(),
        tongDaDung: 0,
        tongDaHoanTra: 0,
        dsSuDung: [],
        dsHoanTra: [],
        coHoanTra: false
      };
    }

    const tt = String(row[15] || '').trim();
    const lieu = parseFloat(row[9]) || 0;
    if (tt === 'SuDung') {
      ongMap[maOng].tongDaDung += lieu;
      ongMap[maOng].dsSuDung.push({
        maBN: String(row[7] || '').trim(),
        hoTenBN: String(row[8] || '').trim(),
        lieuDung: lieu,
        duongDung: String(row[10] || '').trim(),
        thoiGianDung: String(row[11] || '').trim(),
        nguoiThucHien: String(row[12] || '').trim()
      });
    } else if (tt === 'HoanTra' || tt === 'VoOng') {
      ongMap[maOng].tongDaHoanTra += lieu;
      ongMap[maOng].coHoanTra = true;
      ongMap[maOng].dsHoanTra.push({
        lieuDung: lieu,
        lyDo: String(row[16] || '').trim(),
        nguoiChungKien: String(row[17] || '').trim(),
        thoiGianDung: String(row[11] || '').trim(),
        trangThai: tt
      });
    }
  }

  return Object.values(ongMap).map(o => ({
    ...o,
    conLai: Math.max(0, o.tongLieuOng - o.tongDaDung - o.tongDaHoanTra),
    trangThaiOng: (o.tongLieuOng - o.tongDaDung - o.tongDaHoanTra <= 0) ? 'DaDong' : 'DangMo'
  }));
}

// ============ LOG THEO NGÀY ============

async function layLogTheoNgay(ngayLV) {
  if (!ngayLV) ngayLV = layNgayLamViec();
  return layDanhSachOngDangMo(ngayLV); // Cùng logic, trả tất cả ống (mở + đóng)
}

// ============ TỔNG KẾT CA TRỰC ============

async function tongKetCaTruc(ngayLV, nguoiTongKet) {
  if (!ngayLV) ngayLV = layNgayLamViec();

  const dsOng = await layDanhSachOngDangMo(ngayLV);
  
  // Lọc chỉ ống đang mở
  const dsDangMo = dsOng.filter(o => o.trangThaiOng === 'DangMo' && o.conLai > 0);

  // NẾU CÓ ỐNG CHƯA XỬ LÝ -> CHẶN KHÔNG CHO TỔNG KẾT
  if (dsDangMo.length > 0) {
    return {
      success: false,
      message: `Không thể tổng kết ca. Đang còn ${dsDangMo.length} ống tồn dư chưa hoàn trả/hủy bỏ.`,
      dsOng,
      canhBao: dsDangMo
    };
  }

  const tongKetRows = [];
  const thoiGian = layThoiGianHienTai();

  for (const ong of dsOng) {
    const chiTiet = ong.dsSuDung.map(s => `${s.hoTenBN || s.maBN}: ${s.lieuDung}${ong.donViTinh}`).join(', ');
    const xuLyTonDu = ong.conLai === 0 ? (ong.coHoanTra ? 'DaHoanTra' : 'DaDungHet') : 'ChuaXuLy';
    const nguoiCK = ong.dsHoanTra.length > 0 ? ong.dsHoanTra[0].nguoiChungKien : '';

    tongKetRows.push([
      ngayLV, ong.maOng, ong.tenThuoc, ong.hamLuong,
      ong.soLo, ong.hanDung, ong.tongLieuOng, ong.donViTinh,
      chiTiet, ong.tongDaDung, ong.conLai + ong.tongDaHoanTra,
      xuLyTonDu, nguoiCK, nguoiTongKet || '', thoiGian,
      'HoanTat'
    ]);
  }

  // Ghi thêm vào tổng kết
  try {
    const existing = await docSheet(TAB_TONG_KET);
  } catch { /* tab chưa tồn tại */ }

  if (tongKetRows.length > 0) {
    await themHang(TAB_TONG_KET, tongKetRows);
  }

  return {
    success: true,
    message: 'Tổng kết hoàn tất. ✅ Tất cả ống đã được xử lý và chốt.',
    dsOng,
    canhBao: []
  };
}

// ============ ĐỌC TỔNG KẾT ============

async function layTongKet(ngayLV) {
  let data;
  try {
    data = await docSheet(TAB_TONG_KET);
  } catch {
    return [];
  }
  if (!data || data.length <= 1) return [];

  return data.slice(1)
    .filter(row => String(row[0] || '').trim() === ngayLV)
    .map(row => ({
      ngayLamViec: String(row[0] || ''),
      maOng: String(row[1] || ''),
      tenThuoc: String(row[2] || ''),
      hamLuong: String(row[3] || ''),
      soLo: String(row[4] || ''),
      hanDung: String(row[5] || ''),
      tongLieuOng: parseFloat(row[6]) || 0,
      donViTinh: String(row[7] || ''),
      chiTietSuDung: String(row[8] || ''),
      tongDaDung: parseFloat(row[9]) || 0,
      lieuTonDu: parseFloat(row[10]) || 0,
      xuLyTonDu: String(row[11] || ''),
      nguoiChungKien: String(row[12] || ''),
      nguoiTongKet: String(row[13] || ''),
      thoiGianTongKet: String(row[14] || ''),
      trangThai: String(row[15] || '')
    }));
}

// ============ BÁO CÁO ============

async function layBaoCao(tuNgay, denNgay) {
  let data;
  try {
    data = await docSheet(TAB_LOG);
  } catch {
    return [];
  }
  if (!data || data.length <= 1) return [];

  return data.slice(1)
    .filter(row => {
      const ngay = String(row[14] || '').trim();
      return ngay >= tuNgay && ngay <= denNgay;
    })
    .map(row => ({
      maOng: String(row[0] || ''),
      tenThuoc: String(row[1] || ''),
      hamLuong: String(row[2] || ''),
      tongLieuOng: parseFloat(row[3]) || 0,
      donViTinh: String(row[4] || ''),
      soLo: String(row[5] || ''),
      hanDung: String(row[6] || ''),
      maBN: String(row[7] || ''),
      hoTenBN: String(row[8] || ''),
      lieuDung: parseFloat(row[9]) || 0,
      duongDung: String(row[10] || ''),
      thoiGianDung: String(row[11] || ''),
      nguoiThucHien: String(row[12] || ''),
      nguoiGhi: String(row[13] || ''),
      ngayLamViec: String(row[14] || ''),
      trangThai: String(row[15] || ''),
      lyDoHoanTra: String(row[16] || ''),
      nguoiChungKien: String(row[17] || '')
    }));
}

// ============ TỔNG QUAN QUẢN LÝ THEO NGÀY / THÁNG ============

/**
 * Tổng hợp dữ liệu chỉ-đọc cho màn hình quản lý lịch sử N-HT.
 * Hàm này không thay đổi log hoặc số liệu đã chốt; toàn bộ chỉ số đều được
 * tính trực tiếp từ Log_ThuocNHT trong khoảng ngày được yêu cầu.
 */
async function layTongQuanQuanLy(tuNgay, denNgay) {
  const isNgayHopLe = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  if (!isNgayHopLe(tuNgay) || !isNgayHopLe(denNgay) || tuNgay > denNgay) {
    throw new Error('Khoảng ngày không hợp lệ. Vui lòng chọn ngày bắt đầu không muộn hơn ngày kết thúc.');
  }

  // Bỏ qua mọi dòng trống / dữ liệu không thuộc nhật ký N-HT để một dòng
  // nhập dở dang trong Google Sheet không làm sai các chỉ số tổng hợp.
  const logs = (await layBaoCao(tuNgay, denNgay))
    .filter(log => String(log.maOng || '').trim().startsWith('NHT-'));
  const ongMap = new Map();
  const ngayMap = new Map();
  const thuocMap = new Map();
  const benhNhan = new Set();

  const getNgay = ngay => {
    if (!ngayMap.has(ngay)) {
      ngayMap.set(ngay, { ngayLamViec: ngay, maOngSet: new Set(), soLanSuDung: 0, soBenhNhan: new Set(), tongDaDung: 0, tongHoanTra: 0 });
    }
    return ngayMap.get(ngay);
  };
  const getThuoc = (tenThuoc, donViTinh) => {
    const key = `${tenThuoc}||${donViTinh}`;
    if (!thuocMap.has(key)) {
      thuocMap.set(key, { tenThuoc, donViTinh, maOngSet: new Set(), soLanSuDung: 0, soBenhNhan: new Set(), tongDaDung: 0, tongHoanTra: 0 });
    }
    return thuocMap.get(key);
  };

  for (const log of logs) {
    let ong = ongMap.get(log.maOng);
    if (!ong) {
      ong = {
        maOng: log.maOng,
        ngayLamViec: log.ngayLamViec,
        tenThuoc: log.tenThuoc || '',
        hamLuong: log.hamLuong || '',
        donViTinh: log.donViTinh || '',
        tongLieuOng: Number(log.tongLieuOng) || 0,
        soLo: log.soLo || '',
        hanDung: log.hanDung || '',
        tongDaDung: 0,
        tongHoanTra: 0,
        soLanSuDung: 0,
        benhNhan: new Set(),
        lanCapNhatCuoi: ''
      };
      ongMap.set(log.maOng, ong);
    }
    // Các dòng Sử dụng/Hoàn trả cũ có thể chỉ lưu mã ống. Bổ sung lại thông
    // tin từ dòng Mở ống cùng mã thay vì tạo một nhóm "Chưa xác định".
    if (log.tenThuoc) ong.tenThuoc = log.tenThuoc;
    if (log.hamLuong) ong.hamLuong = log.hamLuong;
    if (log.donViTinh) ong.donViTinh = log.donViTinh;
    if (Number(log.tongLieuOng)) ong.tongLieuOng = Number(log.tongLieuOng);
    if (log.soLo) ong.soLo = log.soLo;
    if (log.hanDung) ong.hanDung = log.hanDung;
    ong.lanCapNhatCuoi = log.thoiGianDung || ong.lanCapNhatCuoi;

    if (log.trangThai === 'SuDung') {
      const lieu = Number(log.lieuDung) || 0;
      ong.tongDaDung += lieu;
      ong.soLanSuDung += 1;
      if (log.maBN) {
        ong.benhNhan.add(log.maBN);
      }
    } else if (log.trangThai === 'HoanTra' || log.trangThai === 'VoOng') {
      const lieu = Number(log.lieuDung) || 0;
      ong.tongHoanTra += lieu;
    }
  }

  const canhBao = [];
  for (const ong of ongMap.values()) {
    const tenThuoc = ong.tenThuoc || 'Chưa xác định';
    const day = getNgay(ong.ngayLamViec);
    const drug = getThuoc(tenThuoc, ong.donViTinh);
    day.maOngSet.add(ong.maOng);
    day.soLanSuDung += ong.soLanSuDung;
    day.tongDaDung += ong.tongDaDung;
    day.tongHoanTra += ong.tongHoanTra;
    drug.maOngSet.add(ong.maOng);
    drug.soLanSuDung += ong.soLanSuDung;
    drug.tongDaDung += ong.tongDaDung;
    drug.tongHoanTra += ong.tongHoanTra;
    for (const maBN of ong.benhNhan) {
      benhNhan.add(maBN);
      day.soBenhNhan.add(maBN);
      drug.soBenhNhan.add(maBN);
    }
    ong.conLai = Math.max(0, ong.tongLieuOng - ong.tongDaDung - ong.tongHoanTra);
    ong.trangThaiOng = ong.conLai <= 0 ? 'Đã đóng' : 'Chưa xử lý tồn dư';
    ong.soBenhNhan = ong.benhNhan.size;
    delete ong.benhNhan;
    if (ong.conLai > 0) canhBao.push(ong);
  }

  const theoNgay = [...ngayMap.values()].map(item => {
    const result = {
      ngayLamViec: item.ngayLamViec,
      soOng: item.maOngSet.size,
      soLanSuDung: item.soLanSuDung,
      soBenhNhan: item.soBenhNhan.size,
      tongDaDung: item.tongDaDung,
      tongHoanTra: item.tongHoanTra,
      soOngChuaXuLy: canhBao.filter(o => o.ngayLamViec === item.ngayLamViec).length
    };
    return result;
  }).sort((a, b) => b.ngayLamViec.localeCompare(a.ngayLamViec));

  const theoThuoc = [...thuocMap.values()].map(item => ({
    tenThuoc: item.tenThuoc,
    donViTinh: item.donViTinh,
    soOng: item.maOngSet.size,
    soLanSuDung: item.soLanSuDung,
    soBenhNhan: item.soBenhNhan.size,
    tongDaDung: item.tongDaDung,
    tongHoanTra: item.tongHoanTra,
    soOngChuaXuLy: canhBao.filter(o => o.tenThuoc === item.tenThuoc && o.donViTinh === item.donViTinh).length
  })).sort((a, b) => b.soLanSuDung - a.soLanSuDung || a.tenThuoc.localeCompare(b.tenThuoc, 'vi'));

  return {
    tuNgay,
    denNgay,
    tongQuan: {
      soOng: ongMap.size,
      soLanSuDung: [...ongMap.values()].reduce((sum, ong) => sum + ong.soLanSuDung, 0),
      soBenhNhan: benhNhan.size,
      soOngChuaXuLy: canhBao.length
    },
    theoNgay,
    theoThuoc,
    canhBao: canhBao.sort((a, b) => a.ngayLamViec.localeCompare(b.ngayLamViec) || a.tenThuoc.localeCompare(b.tenThuoc, 'vi')),
    chiTietOng: [...ongMap.values()].sort((a, b) => b.ngayLamViec.localeCompare(a.ngayLamViec) || a.tenThuoc.localeCompare(b.tenThuoc, 'vi'))
  };
}

// ============ KIỂM TRA ỐNG CHƯA XỬ LÝ ============

async function kiemTraOngChuaXuLy(ngayLV) {
  if (!ngayLV) ngayLV = layNgayLamViec();
  const dsOng = await layDanhSachOngDangMo(ngayLV);
  return dsOng.filter(o => o.trangThaiOng === 'DangMo' && o.conLai > 0);
}

// ============ XUẤT BIÊN BẢN (Pattern giống vatTu.js) ============

async function _taoBienBanSheetNangCao(tieuDe, headerRow, dataRows, rowTypes, signatureRow, tenFile) {
  const sheets = await laySheetsClient();
  if (!SPREADSHEET_ID) throw new Error('Chưa cấu hình GOOGLE_SHEET_ID');

  const tenSheetTam = 'Export_NHT_' + Date.now();
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tenSheetTam } } }] }
  });
  const sheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  const numCols = headerRow.length;
  const now = new Date();
  const timeStr = `Ngày xuất báo cáo: ${now.toLocaleString('vi-VN')}`;
  
  const firstRow = ['BỆNH VIỆN ĐA KHOA GIA ĐỊNH'];
  while (firstRow.length < numCols - 1) firstRow.push('');
  firstRow.push(timeStr);

  const allHeaderRows = [
    firstRow,
    ['Khoa PT - Gây mê hồi sức'],
    [''],
    [tieuDe],
    [''],
    headerRow
  ];

  const signatureGap = [[''], [''], ['']];
  const allData = [...allHeaderRows, ...dataRows, ...signatureGap, signatureRow];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tenSheetTam}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: allData }
  });

  // Tạo Format Requests
  const formatRequests = [];
  const dataStartRow = 6;
  
  // Font cơ bản toàn trang
  formatRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: allData.length, startColumnIndex: 0, endColumnIndex: numCols },
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10 }, verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(textFormat,verticalAlignment)'
    }
  });
  
  // Header 2 dòng đầu (BV, Khoa)
  formatRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: numCols },
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true } } },
      fields: 'userEnteredFormat(textFormat)'
    }
  });

  // Tiêu đề chính
  formatRequests.push({
    mergeCells: { range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: numCols }, mergeType: 'MERGE_ALL' }
  });
  formatRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: numCols },
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 13, bold: true }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(textFormat,horizontalAlignment,wrapStrategy)'
    }
  });

  // Header Bảng (dòng 6)
  formatRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: numCols },
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
  });

  // Định dạng các dòng dữ liệu (Dựa trên rowTypes)
  for (let i = 0; i < dataRows.length; i++) {
    const rowIdx = dataStartRow + i;
    const type = rowTypes[i];

    if (type === 'DRUG') {
      // Header nhóm thuốc (màu xanh dương nhạt)
      formatRequests.push({
        mergeCells: { range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: numCols }, mergeType: 'MERGE_ALL' }
      });
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: numCols },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.898, green: 0.949, blue: 1 }, // #E5F2FF
              textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true },
              borders: {
                top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
                bottom: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
                left: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
                right: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } }
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,borders)'
        }
      });
    } else if (type === 'AMPOULE') {
      // Header nhóm ống (màu xám nhạt)
      formatRequests.push({
        mergeCells: { range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: numCols }, mergeType: 'MERGE_ALL' }
      });
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: numCols },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.945, green: 0.945, blue: 0.945 }, // #F1F1F1
              textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true, italic: true },
              borders: {
                top: { style: 'SOLID', color: { red: 0.565, green: 0.643, blue: 0.682 } },
                bottom: { style: 'SOLID', color: { red: 0.565, green: 0.643, blue: 0.682 } },
                left: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
                right: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } }
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,borders)'
        }
      });
    } else {
      // Dòng dữ liệu bình thường
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: numCols },
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
      });
    }
  }

  // Chỉnh độ rộng cột
  formatRequests.push({
    updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' }
  });
  if (numCols === 8) {
    formatRequests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });
  }

  // Dòng ký tên
  const sigRowIdx = dataStartRow + dataRows.length + 3;
  if (sigRowIdx < allData.length) {
    formatRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: sigRowIdx, endRowIndex: sigRowIdx + 1, startColumnIndex: 0, endColumnIndex: numCols },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Lexend', fontSize: 10, bold: true }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)'
      }
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: formatRequests }
  });

  // Tắt gridlines mặc định của Sheets để xóa các viền thừa xung quanh
  const pdfUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=pdf&gid=${sheetId}&size=A4&portrait=false&fitw=true&gridlines=false`;
  const excelUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx&gid=${sheetId}`;

  return { pdfUrl, excelUrl, sheetId, tenSheetTam };
}

async function xoaSheetTam(sheetId) {
  if (!SPREADSHEET_ID) return;
  const sheets = await laySheetsClient();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ deleteSheet: { sheetId } }] }
    });
  } catch (e) {
    console.error('Lỗi xóa sheet tạm NHT:', e.message);
  }
}

async function xuatBienBanSuDung(ngayLV) {
  if (!ngayLV) ngayLV = layNgayLamViec();
  const dsOng = await layLogTheoNgay(ngayLV);

  const headerRow = ['STT', 'BỆNH NHÂN', 'PID', 'LIỀU DÙNG', 'ĐV', 'ĐƯỜNG DÙNG', 'GIỜ THỰC HIỆN', 'NGƯỜI TH'];
  const dataRows = [];
  const rowTypes = [];

  // Nhóm theo Thuốc
  const groups = {};
  for (const ong of dsOng) {
    if (!groups[ong.tenThuoc]) groups[ong.tenThuoc] = [];
    groups[ong.tenThuoc].push(ong);
  }

  for (const [tenThuoc, ongList] of Object.entries(groups)) {
    dataRows.push([`THUỐC: ${tenThuoc.toUpperCase()} (${ongList[0]?.hamLuong || ''})`, '', '', '', '', '', '', '']);
    rowTypes.push('DRUG');

    for (const ong of ongList) {
      dataRows.push([`MÃ ỐNG: ${ong.maOng}   |   SỐ LÔ: ${ong.soLo || '---'}   |   HSD: ${ong.hanDung || '---'}`, '', '', '', '', '', '', '']);
      rowTypes.push('AMPOULE');

      if (ong.dsSuDung && ong.dsSuDung.length > 0) {
        let stt = 0;
        for (const sd of ong.dsSuDung) {
          stt++;
          dataRows.push([
            stt, sd.hoTenBN, sd.maBN, sd.lieuDung, ong.donViTinh, sd.duongDung,
            sd.thoiGianDung, sd.nguoiThucHien
          ]);
          rowTypes.push('DATA');
        }
      } else {
         dataRows.push(['', 'Chưa ghi nhận sử dụng', '', '', '', '', '', '']);
         rowTypes.push('DATA');
      }
    }
  }

  const tieuDe = `BIÊN BẢN SỬ DỤNG THUỐC GÂY NGHIỆN / HƯỚNG THẦN\n(Ca trực ngày: ${ngayLV})`;
  const signatureRow = ['TRƯỞNG KHOA', '', 'KHOA DƯỢC', '', 'KTV GÂY MÊ', '', '', 'NGƯỜI LẬP'];

  return _taoBienBanSheetNangCao(tieuDe, headerRow, dataRows, rowTypes, signatureRow, `BienBan_SuDung_NHT_${ngayLV}`);
}

async function xuatBienBanHoanTra(ngayLV) {
  if (!ngayLV) ngayLV = layNgayLamViec();
  const dsOng = await layLogTheoNgay(ngayLV);

  const headerRow = ['STT', 'LIỀU HOÀN TRẢ', 'ĐV', 'LÝ DO', 'NGƯỜI CHỨNG KIẾN'];
  const dataRows = [];
  const rowTypes = [];

  const groups = {};
  for (const ong of dsOng) {
    if (!groups[ong.tenThuoc]) groups[ong.tenThuoc] = [];
    groups[ong.tenThuoc].push(ong);
  }

  for (const [tenThuoc, ongList] of Object.entries(groups)) {
    const hasHoanTra = ongList.some(o => o.dsHoanTra && o.dsHoanTra.length > 0);
    if (!hasHoanTra) continue;

    dataRows.push([`THUỐC: ${tenThuoc.toUpperCase()} (${ongList[0]?.hamLuong || ''})`, '', '', '', '']);
    rowTypes.push('DRUG');

    for (const ong of ongList) {
      if (!ong.dsHoanTra || ong.dsHoanTra.length === 0) continue;

      dataRows.push([`MÃ ỐNG: ${ong.maOng}   |   SỐ LÔ: ${ong.soLo || '---'}   |   HSD: ${ong.hanDung || '---'}`, '', '', '', '']);
      rowTypes.push('AMPOULE');

      let stt = 0;
      for (const ht of ong.dsHoanTra) {
        stt++;
        dataRows.push([
          stt, ht.lieuDung, ong.donViTinh, ht.lyDo, ht.nguoiChungKien
        ]);
        rowTypes.push('DATA');
      }
    }
  }

  if (dataRows.length === 0) {
    dataRows.push(['', 'Không có thuốc hoàn trả trong ca này', '', '', '']);
    rowTypes.push('DATA');
  }

  const tieuDe = `BIÊN BẢN HOÀN TRẢ THUỐC GÂY NGHIỆN / HƯỚNG THẦN\n(Ca trực ngày: ${ngayLV})`;
  const signatureRow = ['NGƯỜI HOÀN TRẢ', '', 'DƯỢC NHẬN', '', 'TRƯỞNG KHOA'];

  return _taoBienBanSheetNangCao(tieuDe, headerRow, dataRows, rowTypes, signatureRow, `BienBan_HoanTra_NHT_${ngayLV}`);
}

// ============ EXPORTS ============

module.exports = {
  layNgayLamViec,
  layDanhMuc,
  themThuocVaoDanhMuc,
  suaDanhMuc,
  kiemTraQuyenKTVGM,
  taoMaOng,
  moOngMoi,
  ghiNhanSuDung,
  layThongTinOng,
  ghiNhanHoanTra,
  layDanhSachOngDangMo,
  layLogTheoNgay,
  tongKetCaTruc,
  layTongKet,
  layBaoCao,
  layTongQuanQuanLy,
  kiemTraOngChuaXuLy,
  layDanhSachPhong,
  xuatBienBanSuDung,
  xuatBienBanHoanTra,
  xoaSheetTam
};
